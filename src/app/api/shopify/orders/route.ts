import { NextRequest, NextResponse } from 'next/server'
import { subDays, subYears, startOfDay, endOfDay, differenceInDays } from 'date-fns'
import { shopifyFetchAll } from '../lib'

export const dynamic = 'force-dynamic'

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

    // Year-on-year: same period last year
    const yoySince = subYears(since, 1)
    const yoyUntil = subYears(until, 1)

    const sinceISO = since.toISOString()
    const untilISO = until.toISOString()
    const prevSinceISO = prevSince.toISOString()
    const prevUntilISO = prevUntil.toISOString()
    const yoySinceISO = yoySince.toISOString()
    const yoyUntilISO = yoyUntil.toISOString()

    const [orders, prevOrders, yoyOrders, latestOrders] = await Promise.all([
      shopifyFetchAll(`/orders.json?status=any&created_at_min=${sinceISO}&created_at_max=${untilISO}`, 'orders'),
      shopifyFetchAll(`/orders.json?status=any&created_at_min=${prevSinceISO}&created_at_max=${prevUntilISO}`, 'orders'),
      shopifyFetchAll(`/orders.json?status=any&created_at_min=${yoySinceISO}&created_at_max=${yoyUntilISO}`, 'orders'),
      shopifyFetchAll(`/orders.json?status=any&limit=10`, 'orders', 10),
    ])

    const isActive = (o: any) => !o.cancelled_at && o.financial_status !== 'voided'
    const activeOrders = orders.filter(isActive)
    const activePrev = prevOrders.filter(isActive)
    const activeYoy = yoyOrders.filter(isActive)

    const total = activeOrders.length
    const revenue = activeOrders.reduce((s: number, o: any) => s + parseFloat(o.total_price || '0'), 0)
    const prevTotal = activePrev.length
    const prevRevenue = activePrev.reduce((s: number, o: any) => s + parseFloat(o.total_price || '0'), 0)
    const yoyTotal = activeYoy.length
    const yoyRevenue = activeYoy.reduce((s: number, o: any) => s + parseFloat(o.total_price || '0'), 0)

    // Top products by quantity and revenue (include product_id for links)
    const productMap: Record<string, { name: string; sku: string; qty: number; revenue: number; productId: number | null }> = {}
    let totalUnits = 0
    for (const order of activeOrders) {
      for (const item of (order.line_items || [])) {
        const key = item.sku || item.title
        if (!productMap[key]) productMap[key] = { name: item.title || item.name || 'Unknown', sku: item.sku || '', qty: 0, revenue: 0, productId: item.product_id || null }
        productMap[key].qty += item.quantity || 0
        productMap[key].revenue += parseFloat(item.price || '0') * (item.quantity || 0)
        totalUnits += item.quantity || 0
      }
    }
    const products = Object.values(productMap)
    const topByQty = [...products].sort((a, b) => b.qty - a.qty).slice(0, 10)
    const topByRevenue = [...products].sort((a, b) => b.revenue - a.revenue).slice(0, 10)

    // Recent orders — always the latest 10 regardless of date filter
    const recentOrders = latestOrders
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10)
      .map((o: any) => ({
        id: o.id,
        name: o.name,
        customer: o.customer
          ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() || o.customer.email
          : 'Guest',
        company: o.customer?.default_address?.company || '',
        total: parseFloat(o.total_price || '0'),
        date: o.created_at,
        status: o.financial_status,
        itemCount: (o.line_items || []).reduce((s: number, li: any) => s + (li.quantity || 0), 0),
      }))

    // Hourly breakdown for sparkline
    const hourly: Record<number, number> = {}
    for (const o of orders) {
      const h = new Date(o.created_at).getHours()
      hourly[h] = (hourly[h] || 0) + 1
    }

    return NextResponse.json({
      ok: true,
      orders: { total, revenue, hourly, totalUnits },
      prevOrders: { total: prevTotal, revenue: prevRevenue },
      yoyOrders: { total: yoyTotal, revenue: yoyRevenue },
      topByQty,
      topByRevenue,
      recentOrders,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
