import { NextRequest, NextResponse } from 'next/server'
import { subDays, startOfDay, endOfDay } from 'date-fns'

export const dynamic = 'force-dynamic'

const VEEQO_BASE = 'https://api.veeqo.com'

async function veeqoFetch(path: string) {
  const key = process.env.VEEQO_API_KEY
  if (!key) throw new Error('VEEQO_API_KEY not set')
  const res = await fetch(`${VEEQO_BASE}${path}`, {
    headers: { 'x-api-key': key },
    cache: 'no-store'
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Veeqo ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function veeqoFetchAll(basePath: string, maxPages = 20): Promise<any[]> {
  const sep = basePath.includes('?') ? '&' : '?'
  let all: any[] = []
  for (let page = 1; page <= maxPages; page++) {
    const data = await veeqoFetch(`${basePath}${sep}page_size=100&page=${page}`)
    if (!Array.isArray(data) || data.length === 0) break
    all = all.concat(data)
    if (data.length < 100) break
  }
  return all
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

    const sinceISO = encodeURIComponent(since.toISOString())
    const untilISO = encodeURIComponent(until.toISOString())

    // Fetch all pages of orders, products, and pick lists in parallel
    const [orders, products, pickLists] = await Promise.all([
      veeqoFetchAll(`/orders?created_at_min=${sinceISO}&created_at_max=${untilISO}`),
      veeqoFetchAll(`/products`),
      veeqoFetchAll(`/pick_lists?created_at_min=${sinceISO}`).catch(() => [])
    ])

    // Orders metrics
    const totalOrders = orders.length
    const totalRevenue = orders.reduce((s: number, o: any) => s + parseFloat(o.total_price || 0), 0)
    const shipped = orders.filter((o: any) =>
      o.status === 'shipped' || o.fulfillment_status === 'fulfilled'
    ).length

    // Hourly breakdown (for sparkline)
    const hourly: Record<number, number> = {}
    orders.forEach((o: any) => {
      const h = new Date(o.created_at).getHours()
      hourly[h] = (hourly[h] || 0) + 1
    })

    // Channel breakdown (revenue + orders by channel)
    const channelMap: Record<string, { orders: number; revenue: number }> = {}
    orders.forEach((o: any) => {
      const chName = o.channel?.name || 'Unknown'
      if (!channelMap[chName]) channelMap[chName] = { orders: 0, revenue: 0 }
      channelMap[chName].orders++
      channelMap[chName].revenue += parseFloat(o.total_price || 0)
    })
    const channels = Object.entries(channelMap)
      .map(([name, data]) => ({ name, orders: data.orders, revenue: data.revenue }))
      .sort((a, b) => b.revenue - a.revenue)

    // SKU breakdown (overall + by channel)
    const skuMap: Record<string, { name: string; sku: string; qty: number; revenue: number }> = {}
    const skuByChannel: Record<string, Record<string, { name: string; sku: string; qty: number; revenue: number }>> = {}
    orders.forEach((o: any) => {
      const chName = o.channel?.name || 'Unknown'
      if (!skuByChannel[chName]) skuByChannel[chName] = {}
      const items = o.line_items || []
      items.forEach((li: any) => {
        const s = li.sellable || {}
        const sku = s.sku_code || 'Unknown'
        const name = s.product_title || s.title || sku
        const qty = li.quantity || 1
        const rev = parseFloat(li.price_per_unit || 0) * qty
        // Overall
        if (!skuMap[sku]) skuMap[sku] = { name, sku, qty: 0, revenue: 0 }
        skuMap[sku].qty += qty
        skuMap[sku].revenue += rev
        // By channel
        if (!skuByChannel[chName][sku]) skuByChannel[chName][sku] = { name, sku, qty: 0, revenue: 0 }
        skuByChannel[chName][sku].qty += qty
        skuByChannel[chName][sku].revenue += rev
      })
    })
    const topSkus = Object.values(skuMap).sort((a, b) => b.qty - a.qty).slice(0, 10)
    const topSkusByChannel: Record<string, { name: string; sku: string; qty: number; revenue: number }[]> = {}
    for (const [ch, map] of Object.entries(skuByChannel)) {
      topSkusByChannel[ch] = Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 5)
    }

    // Stock levels + stock value by warehouse
    let critical = 0, low = 0, healthy = 0, totalSKUs = 0
    const lowStockItems: { name: string; qty: number }[] = []
    const warehouseValueMap: Record<string, { name: string; value: number; units: number }> = {}

    products.forEach((p: any) => {
      const sellables = p.sellables || p.variants || [p]
      sellables.forEach((v: any) => {
        const costPrice = parseFloat(v.cost_price || 0) || 0
        const stockEntries = v.stock_entries || v.warehouses || []

        // Aggregate stock across all warehouses for this variant
        let totalQty = 0
        stockEntries.forEach((se: any) => {
          const phys = se.physical_stock_level ?? 0
          totalQty += phys
          // Warehouse value tracking
          const wh = se.warehouse || {}
          const whName = wh.name || `Warehouse ${wh.id || '?'}`
          if (!warehouseValueMap[whName]) warehouseValueMap[whName] = { name: whName, value: 0, units: 0 }
          // Use sellable_on_hand_value if available, otherwise cost_price * qty
          const entryValue = (se.sellable_on_hand_value && se.sellable_on_hand_value > 0)
            ? se.sellable_on_hand_value
            : costPrice * phys
          warehouseValueMap[whName].value += entryValue
          warehouseValueMap[whName].units += phys
        })

        totalSKUs++
        if (totalQty < 10) {
          critical++
          if (totalQty > 0) lowStockItems.push({ name: v.product_title || p.title || v.sku_code || 'Unknown', qty: totalQty })
        } else if (totalQty < 50) {
          low++
          lowStockItems.push({ name: v.product_title || p.title || v.sku_code || 'Unknown', qty: totalQty })
        } else {
          healthy++
        }
      })
    })

    const stockByWarehouse = Object.values(warehouseValueMap)
      .filter(w => w.units > 0 || w.value > 0)
      .sort((a, b) => b.value - a.value)
    const totalStockValue = stockByWarehouse.reduce((s, w) => s + w.value, 0)

    // Pick lists / shift
    const picks = pickLists.reduce((s: number, pl: any) => s + (pl.total_items || 0), 0)
    const packs = pickLists.filter((pl: any) => pl.status === 'complete')
      .reduce((s: number, pl: any) => s + (pl.total_items || 0), 0)

    return NextResponse.json({
      ok: true,
      orders: { total: totalOrders, shipped, pending: totalOrders - shipped, revenue: totalRevenue, hourly },
      stock: { critical, low, healthy, total: totalSKUs, lowItems: lowStockItems.slice(0, 10) },
      shift: { picks, packs, lists: pickLists.length, errors: 0 },
      channels,
      topSkus,
      topSkusByChannel,
      stockByWarehouse,
      totalStockValue
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
