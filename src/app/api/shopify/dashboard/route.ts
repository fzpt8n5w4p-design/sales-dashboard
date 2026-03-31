import { NextRequest, NextResponse } from 'next/server'
import { subDays, subYears, startOfDay, endOfDay } from 'date-fns'
import { shopifyFetchAll } from '../lib'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const daysPeriod = parseInt(searchParams.get('days') || '30')

  try {
    const now = new Date()
    const since = startOfDay(subDays(now, daysPeriod))
    const until = endOfDay(now)

    // Same period last year
    const yoySince = subYears(since, 1)
    const yoyUntil = subYears(until, 1)

    const [orders, yoyOrders] = await Promise.all([
      shopifyFetchAll(`/orders.json?status=any&created_at_min=${since.toISOString()}&created_at_max=${until.toISOString()}`, 'orders'),
      shopifyFetchAll(`/orders.json?status=any&created_at_min=${yoySince.toISOString()}&created_at_max=${yoyUntil.toISOString()}`, 'orders'),
    ])

    const isActive = (o: any) => !o.cancelled_at && o.financial_status !== 'voided'
    const activeOrders = orders.filter(isActive)
    const activeYoy = yoyOrders.filter(isActive)

    // Top products by revenue
    const productMap: Record<string, { name: string; sku: string; qty: number; revenue: number; productId: number | null }> = {}
    for (const order of activeOrders) {
      for (const item of (order.line_items || [])) {
        const key = item.product_id?.toString() || item.sku || item.title
        if (!productMap[key]) productMap[key] = { name: item.title || 'Unknown', sku: item.sku || '', qty: 0, revenue: 0, productId: item.product_id || null }
        productMap[key].qty += item.quantity || 0
        productMap[key].revenue += parseFloat(item.price || '0') * (item.quantity || 0)
      }
    }
    const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 15)

    // Build YoY customer spend map
    const yoyCustomerSpend: Record<string, number> = {}
    for (const order of activeYoy) {
      const cid = order.customer?.id?.toString() || order.customer?.email || 'guest'
      yoyCustomerSpend[cid] = (yoyCustomerSpend[cid] || 0) + parseFloat(order.total_price || '0')
    }

    // Top customers by spend with YoY
    const customerMap: Record<string, { name: string; company: string; customerId: number | null; spend: number; orderCount: number; lastOrderDate: string }> = {}
    for (const order of activeOrders) {
      const cid = order.customer?.id?.toString() || order.customer?.email || 'guest'
      if (!customerMap[cid]) {
        customerMap[cid] = {
          name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() || order.customer.email : 'Guest',
          company: order.customer?.default_address?.company || '',
          customerId: order.customer?.id || null,
          spend: 0,
          orderCount: 0,
          lastOrderDate: order.created_at,
        }
      }
      customerMap[cid].spend += parseFloat(order.total_price || '0')
      customerMap[cid].orderCount++
      if (order.created_at > customerMap[cid].lastOrderDate) customerMap[cid].lastOrderDate = order.created_at
    }

    const topCustomers = Object.entries(customerMap)
      .map(([cid, c]) => ({ ...c, yoySpend: yoyCustomerSpend[cid] || 0 }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 15)

    return NextResponse.json({ ok: true, topProducts, topCustomers, period: daysPeriod })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
