import { NextRequest, NextResponse } from 'next/server'
import { subDays, startOfDay, endOfDay, differenceInDays } from 'date-fns'

export const dynamic = 'force-dynamic'

const VEEQO_BASE = 'https://api.veeqo.com'

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

async function veeqoFetch(path: string, retries = 4): Promise<any> {
  const key = process.env.VEEQO_API_KEY
  if (!key) throw new Error('VEEQO_API_KEY not set')
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${VEEQO_BASE}${path}`, {
      headers: { 'x-api-key': key },
      cache: 'no-store'
    })
    if (res.status === 429) {
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s — total ~31s worst case.
      // Veeqo's bucket refills slowly under sustained load.
      await delay(1000 * Math.pow(2, attempt))
      continue
    }
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Veeqo ${res.status}: ${body.slice(0, 200)}`)
    }
    return res.json()
  }
  throw new Error('Veeqo rate limited after retries')
}

// Stream pages in batches of 3, calling onPage for each. Pages are dropped
// after processing so peak memory stays bounded by batch size, not by total
// dataset size. This is the key change for staying under Render's 512MB.
async function veeqoStreamPages(
  basePath: string,
  onPage: (page: any[]) => void,
  maxPages = 50
): Promise<void> {
  const sep = basePath.includes('?') ? '&' : '?'
  // BATCH=2 keeps in-stream concurrency low so Veeqo's rate limit isn't
  // exhausted when the route runs multiple streams sequentially.
  const BATCH = 2
  for (let start = 1; start <= maxPages; start += BATCH) {
    const batch: Promise<any[]>[] = []
    for (let p = start; p < start + BATCH && p <= maxPages; p++) {
      batch.push(
        veeqoFetch(`${basePath}${sep}page_size=100&page=${p}`)
          .then(d => (Array.isArray(d) ? d : []))
      )
    }
    const results = await Promise.all(batch)
    let done = false
    for (const page of results) {
      if (page.length === 0) { done = true; break }
      onPage(page)
      if (page.length < 100) { done = true; break }
    }
    if (done) break
  }
}

// Cache the small aggregated stock summary, not the raw products. Raw Veeqo
// product objects with nested sellables/stock_entries are huge (~50–100MB
// for a few thousand products) and were a primary OOM culprit.
type StockSummary = {
  critical: number
  low: number
  healthy: number
  totalSKUs: number
  lowStockItems: { name: string; qty: number }[]
  stockByWarehouse: { name: string; value: number; units: number }[]
  totalStockValue: number
}

let stockCache: { data: StockSummary; fetchedAt: number } | null = null
const STOCK_CACHE_TTL = 5 * 60 * 1000

async function getStockSummary(): Promise<StockSummary> {
  if (stockCache && Date.now() - stockCache.fetchedAt < STOCK_CACHE_TTL) {
    return stockCache.data
  }

  let critical = 0, low = 0, healthy = 0, totalSKUs = 0
  const lowStockItems: { name: string; qty: number }[] = []
  const warehouseValueMap: Record<string, { name: string; value: number; units: number }> = {}

  await veeqoStreamPages('/products', (products) => {
    for (const p of products) {
      const sellables = p.sellables || p.variants || [p]
      for (const v of sellables) {
        const costPrice = parseFloat(v.cost_price || 0) || 0
        const stockEntries = v.stock_entries || v.warehouses || []
        let totalQty = 0
        for (const se of stockEntries) {
          const phys = se.physical_stock_level ?? 0
          totalQty += phys
          const wh = se.warehouse || {}
          const whName = wh.name || `Warehouse ${wh.id || '?'}`
          if (!warehouseValueMap[whName]) warehouseValueMap[whName] = { name: whName, value: 0, units: 0 }
          const entryValue = (se.sellable_on_hand_value && se.sellable_on_hand_value > 0)
            ? se.sellable_on_hand_value
            : costPrice * phys
          warehouseValueMap[whName].value += entryValue
          warehouseValueMap[whName].units += phys
        }
        totalSKUs++
        if (totalQty < 10) {
          critical++
          if (totalQty > 0 && lowStockItems.length < 10) {
            lowStockItems.push({ name: v.product_title || p.title || v.sku_code || 'Unknown', qty: totalQty })
          }
        } else if (totalQty < 50) {
          low++
          if (lowStockItems.length < 10) {
            lowStockItems.push({ name: v.product_title || p.title || v.sku_code || 'Unknown', qty: totalQty })
          }
        } else {
          healthy++
        }
      }
    }
  })

  const stockByWarehouse = Object.values(warehouseValueMap)
    .filter(w => w.units > 0 || w.value > 0)
    .sort((a, b) => b.value - a.value)
  const totalStockValue = stockByWarehouse.reduce((s, w) => s + w.value, 0)

  const summary: StockSummary = {
    critical, low, healthy, totalSKUs,
    lowStockItems, stockByWarehouse, totalStockValue
  }
  stockCache = { data: summary, fetchedAt: Date.now() }
  return summary
}

type OrderAggregator = {
  total: number
  revenue: number
  shipped: number
  readyToShip: number
  hourly: Record<number, number>
  channelMap: Record<string, { orders: number; revenue: number }>
  skuMap: Record<string, { name: string; sku: string; qty: number; revenue: number }>
  skuByChannel: Record<string, Record<string, { name: string; sku: string; qty: number; revenue: number }>>
}

const FBA_TYPES = new Set(['amazon_fba'])
const EXCLUDED_STATUSES = new Set(['shipped', 'cancelled'])

function newOrderAggregator(): OrderAggregator {
  return {
    total: 0, revenue: 0, shipped: 0, readyToShip: 0,
    hourly: {}, channelMap: {}, skuMap: {}, skuByChannel: {}
  }
}

function processOrder(agg: OrderAggregator, o: any) {
  agg.total++
  const price = parseFloat(o.total_price || 0)
  agg.revenue += price
  const isShipped = o.status === 'shipped' || o.fulfillment_status === 'fulfilled'
  if (isShipped) agg.shipped++
  if (!FBA_TYPES.has(o.channel?.type_code) && !EXCLUDED_STATUSES.has(o.status)) {
    agg.readyToShip++
  }
  const h = new Date(o.created_at).getHours()
  agg.hourly[h] = (agg.hourly[h] || 0) + 1

  const chName = o.channel?.name || 'Unknown'
  if (!agg.channelMap[chName]) agg.channelMap[chName] = { orders: 0, revenue: 0 }
  agg.channelMap[chName].orders++
  agg.channelMap[chName].revenue += price

  if (!agg.skuByChannel[chName]) agg.skuByChannel[chName] = {}
  const items = Array.isArray(o.line_items) ? o.line_items : []
  for (const li of items) {
    const s = li.sellable || {}
    const sku = s.sku_code || 'Unknown'
    const name = s.product_title || s.title || sku
    const qty = li.quantity || 1
    const rev = parseFloat(li.price_per_unit || 0) * qty
    if (!agg.skuMap[sku]) agg.skuMap[sku] = { name, sku, qty: 0, revenue: 0 }
    agg.skuMap[sku].qty += qty
    agg.skuMap[sku].revenue += rev
    if (!agg.skuByChannel[chName][sku]) agg.skuByChannel[chName][sku] = { name, sku, qty: 0, revenue: 0 }
    agg.skuByChannel[chName][sku].qty += qty
    agg.skuByChannel[chName][sku].revenue += rev
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const range = searchParams.get('range') || 'today'
  const customSince = searchParams.get('since')
  const customUntil = searchParams.get('until')

  try {
    const now = new Date()
    let since: Date, until: Date

    if (customSince && customUntil) {
      since = startOfDay(new Date(customSince))
      until = endOfDay(new Date(customUntil))
    } else {
      switch (range) {
        case 'yesterday':
          since = startOfDay(subDays(now, 1))
          until = endOfDay(subDays(now, 1))
          break
        case '7days':
          since = startOfDay(subDays(now, 7))
          until = endOfDay(now)
          break
        case '30days':
          since = startOfDay(subDays(now, 30))
          until = endOfDay(now)
          break
        default:
          since = startOfDay(now)
          until = endOfDay(now)
      }
    }

    const periodDays = Math.max(1, differenceInDays(until, since) + 1)
    const prevSince = startOfDay(subDays(since, periodDays))
    const prevUntil = endOfDay(subDays(since, 1))

    const sinceISO = encodeURIComponent(since.toISOString())
    const untilISO = encodeURIComponent(until.toISOString())
    const prevSinceISO = encodeURIComponent(prevSince.toISOString())
    const prevUntilISO = encodeURIComponent(prevUntil.toISOString())

    const orderAgg = newOrderAggregator()
    const prevAgg = { total: 0, revenue: 0 }
    let pickItems = 0
    let packItems = 0
    let pickListCount = 0

    // Veeqo's /orders endpoint silently ignores `created_at_max`, so we
    // can't ask for a historical window directly. Instead, fetch from
    // prevSince forward and bucket each order in JS. This also halves
    // the number of API calls (one stream covers both periods).
    const sinceMs = since.getTime()
    const untilMs = until.getTime()
    const prevSinceMs = prevSince.getTime()
    const prevUntilMs = prevUntil.getTime()

    // 80 pages × 100/page = 8000 order capacity. At ~200/day volume that
    // covers ~40 days — full current period for ranges up to 30d, partial
    // prev period for the 30d range (a Veeqo API limitation: it ignores
    // created_at_max so we can't fetch a historical window directly).
    // Anything more pages takes longer than the dashboard tolerates.
    await veeqoStreamPages(
      `/orders?created_at_min=${prevSinceISO}`,
      page => {
        for (const o of page) {
          const t = new Date(o.created_at).getTime()
          if (t >= sinceMs && t <= untilMs) {
            processOrder(orderAgg, o)
          } else if (t >= prevSinceMs && t <= prevUntilMs) {
            prevAgg.total++
            prevAgg.revenue += parseFloat(o.total_price || 0)
          }
        }
      },
      80
    )

    const stock = await getStockSummary()
    await veeqoStreamPages(
      `/pick_lists?created_at_min=${sinceISO}`,
      page => {
        for (const pl of page) {
          pickListCount++
          pickItems += pl.total_items || 0
          if (pl.status === 'complete') packItems += pl.total_items || 0
        }
      }
    ).catch(() => { /* pick lists optional */ })

    const channels = Object.entries(orderAgg.channelMap)
      .map(([name, data]) => ({ name, orders: data.orders, revenue: data.revenue }))
      .sort((a, b) => b.revenue - a.revenue)

    const topSkus = Object.values(orderAgg.skuMap).sort((a, b) => b.qty - a.qty).slice(0, 10)
    const topSkusByRevenue = Object.values(orderAgg.skuMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10)
    const totalUnitsSold = Object.values(orderAgg.skuMap).reduce((s, sk) => s + sk.qty, 0)
    const topSkusByChannel: Record<string, { name: string; sku: string; qty: number; revenue: number }[]> = {}
    for (const [ch, map] of Object.entries(orderAgg.skuByChannel)) {
      topSkusByChannel[ch] = Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 5)
    }

    return NextResponse.json({
      ok: true,
      orders: {
        total: orderAgg.total,
        shipped: orderAgg.shipped,
        pending: orderAgg.total - orderAgg.shipped,
        revenue: orderAgg.revenue,
        hourly: orderAgg.hourly,
        readyToShip: orderAgg.readyToShip
      },
      prevOrders: { total: prevAgg.total, revenue: prevAgg.revenue },
      stock: {
        critical: stock.critical,
        low: stock.low,
        healthy: stock.healthy,
        total: stock.totalSKUs,
        lowItems: stock.lowStockItems
      },
      shift: { picks: pickItems, packs: packItems, lists: pickListCount, errors: 0 },
      channels,
      topSkus,
      topSkusByRevenue,
      totalUnitsSold,
      topSkusByChannel,
      stockByWarehouse: stock.stockByWarehouse,
      totalStockValue: stock.totalStockValue
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
