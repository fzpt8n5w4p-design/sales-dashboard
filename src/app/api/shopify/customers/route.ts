import { NextResponse } from 'next/server'
import { subDays, subYears, startOfDay, startOfYear, endOfDay } from 'date-fns'
import { shopifyFetchAll } from '../lib'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const now = new Date()
    const thirtyDaysAgo = startOfDay(subDays(now, 30))
    const yearStart = startOfYear(now)

    // Previous year same YTD period
    const prevYearStart = subYears(yearStart, 1)
    const prevYearNow = subYears(now, 1)

    const [customers, orders30d, ordersYTD, ordersPrevYTD] = await Promise.all([
      shopifyFetchAll('/customers.json', 'customers'),
      shopifyFetchAll(`/orders.json?status=any&created_at_min=${thirtyDaysAgo.toISOString()}&created_at_max=${endOfDay(now).toISOString()}`, 'orders'),
      shopifyFetchAll(`/orders.json?status=any&created_at_min=${yearStart.toISOString()}&created_at_max=${endOfDay(now).toISOString()}`, 'orders'),
      shopifyFetchAll(`/orders.json?status=any&created_at_min=${prevYearStart.toISOString()}&created_at_max=${endOfDay(prevYearNow).toISOString()}`, 'orders'),
    ])

    // Build per-customer 30d and YTD spend maps
    const spend30d: Record<number, number> = {}
    const spendYTD: Record<number, number> = {}
    const activeCustomerIds = new Set<number>()

    const excludeStatuses = new Set(['cancelled', 'voided', 'refunded'])

    for (const o of orders30d) {
      if (excludeStatuses.has(o.financial_status) || o.cancelled_at) continue
      const cid = o.customer?.id
      if (cid) {
        spend30d[cid] = (spend30d[cid] || 0) + parseFloat(o.total_price || '0')
        activeCustomerIds.add(cid)
      }
    }

    for (const o of ordersYTD) {
      if (excludeStatuses.has(o.financial_status) || o.cancelled_at) continue
      const cid = o.customer?.id
      if (cid) {
        spendYTD[cid] = (spendYTD[cid] || 0) + parseFloat(o.total_price || '0')
      }
    }

    const totalRevenue30d = orders30d.filter((o: any) => !excludeStatuses.has(o.financial_status) && !o.cancelled_at).reduce((s: number, o: any) => s + parseFloat(o.total_price || '0'), 0)

    const mapped = customers.map((c: any) => ({
      id: c.id,
      name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || 'Unknown',
      email: c.email || '',
      company: c.default_address?.company || '',
      ordersCount: c.orders_count || 0,
      totalSpent: parseFloat(c.total_spent || '0'),
      spend30d: spend30d[c.id] || 0,
      spendYTD: spendYTD[c.id] || 0,
      lastOrderDate: c.last_order_name ? c.updated_at : null,
      createdAt: c.created_at,
    }))

    mapped.sort((a: any, b: any) => b.totalSpent - a.totalSpent)

    return NextResponse.json({
      ok: true,
      customers: mapped,
      totalCustomers: mapped.length,
      totalSpendAll: mapped.reduce((s: number, c: any) => s + c.totalSpent, 0),
      totalSpendYTD: mapped.reduce((s: number, c: any) => s + c.spendYTD, 0),
      prevYTDRevenue: ordersPrevYTD.filter((o: any) => !excludeStatuses.has(o.financial_status) && !o.cancelled_at).reduce((s: number, o: any) => s + parseFloat(o.total_price || '0'), 0),
      totalRevenue30d,
      activeCustomers30d: activeCustomerIds.size,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
