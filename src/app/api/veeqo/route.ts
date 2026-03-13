import { NextRequest, NextResponse } from 'next/server'
import { subDays, startOfDay, endOfDay, format } from 'date-fns'

const VEEQO_BASE = 'https://api.veeqo.com'

async function veeqoFetch(path: string) {
  const key = process.env.VEEQO_API_KEY
  if (!key) throw new Error('VEEQO_API_KEY not set')
  const res = await fetch(`${VEEQO_BASE}${path}`, {
    headers: { 'x-api-key': key },
    next: { revalidate: 0 }
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Veeqo ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const range = searchParams.get('range') || 'today'

  try {
    const now = new Date()
    let since: Date, until: Date

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
      default: // today
        since = startOfDay(now)
        until = endOfDay(now)
    }

    const sinceISO = encodeURIComponent(since.toISOString())
    const untilISO = encodeURIComponent(until.toISOString())

    // Fetch orders in parallel with stock
    const [orders, products, pickLists] = await Promise.all([
      veeqoFetch(`/orders?created_at_min=${sinceISO}&created_at_max=${untilISO}&page_size=250`),
      veeqoFetch(`/products?page_size=250`),
      veeqoFetch(`/pick_lists?created_at_min=${sinceISO}`).catch(() => [])
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

    // Stock levels
    let critical = 0, low = 0, healthy = 0, totalSKUs = 0
    const lowStockItems: { name: string; qty: number }[] = []
    products.forEach((p: any) => {
      const variants = p.variants?.length ? p.variants : [p]
      variants.forEach((v: any) => {
        const qty = v.sellable_on_hand_count ?? 0
        totalSKUs++
        if (qty < 10) {
          critical++
          lowStockItems.push({ name: p.title || v.sku || 'Unknown', qty })
        } else if (qty < 50) {
          low++
          lowStockItems.push({ name: p.title || v.sku || 'Unknown', qty })
        } else {
          healthy++
        }
      })
    })

    // Pick lists / shift
    const picks = pickLists.reduce((s: number, pl: any) => s + (pl.total_items || 0), 0)
    const packs = pickLists.filter((pl: any) => pl.status === 'complete')
      .reduce((s: number, pl: any) => s + (pl.total_items || 0), 0)

    return NextResponse.json({
      ok: true,
      orders: { total: totalOrders, shipped, pending: totalOrders - shipped, revenue: totalRevenue, hourly },
      stock: { critical, low, healthy, total: totalSKUs, lowItems: lowStockItems.slice(0, 10) },
      shift: { picks, packs, lists: pickLists.length, errors: 0 }
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
