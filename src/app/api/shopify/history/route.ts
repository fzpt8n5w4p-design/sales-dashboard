import { NextResponse } from 'next/server'
import { subDays, startOfDay, endOfDay, format } from 'date-fns'
import { shopifyFetchAll } from '../lib'

export const dynamic = 'force-dynamic'

let historyCache: { data: any; fetchedAt: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

export async function GET() {
  try {
    if (historyCache && Date.now() - historyCache.fetchedAt < CACHE_TTL) {
      return NextResponse.json(historyCache.data)
    }

    const now = new Date()
    const since = startOfDay(subDays(now, 30))
    const until = endOfDay(now)

    const [orders, customers] = await Promise.all([
      shopifyFetchAll(`/orders.json?status=any&created_at_min=${since.toISOString()}&created_at_max=${until.toISOString()}`, 'orders'),
      shopifyFetchAll('/customers.json', 'customers'),
    ])

    // Daily breakdown
    const dailyMap: Record<string, { orders: number; units: number; revenue: number }> = {}
    for (let d = 0; d <= 30; d++) {
      const date = format(subDays(now, 30 - d), 'dd MMM')
      dailyMap[date] = { orders: 0, units: 0, revenue: 0 }
    }

    for (const order of orders) {
      const date = format(new Date(order.created_at), 'dd MMM')
      if (dailyMap[date]) {
        dailyMap[date].orders++
        dailyMap[date].revenue += parseFloat(order.total_price || '0')
        dailyMap[date].units += (order.line_items || []).reduce((s: number, li: any) => s + (li.quantity || 0), 0)
      }
    }

    const daily = Object.entries(dailyMap).map(([label, data]) => ({ label, ...data }))

    // New accounts in last 30 days vs previous 30 days
    const prev30Start = subDays(since, 30)
    const newAccounts30d = customers.filter((c: any) => new Date(c.created_at) >= since).length
    const newAccountsPrev30d = customers.filter((c: any) => {
      const d = new Date(c.created_at)
      return d >= prev30Start && d < since
    }).length

    // New accounts last 30 days vs same period last year
    const lastYearStart = subDays(since, 365)
    const lastYearEnd = subDays(until, 365)
    const newAccountsYoY = customers.filter((c: any) => {
      const d = new Date(c.created_at)
      return d >= lastYearStart && d <= lastYearEnd
    }).length

    // Outstanding balances (unpaid/partially paid orders)
    const outstandingOrders = orders
      .filter((o: any) => o.financial_status !== 'paid' && o.financial_status !== 'refunded' && o.financial_status !== 'voided')
      .map((o: any) => ({
        id: o.id,
        name: o.name,
        customer: o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() || o.customer.email : 'Guest',
        company: o.customer?.default_address?.company || '',
        customerId: o.customer?.id || null,
        total: parseFloat(o.total_price || '0'),
        status: o.financial_status,
        date: o.created_at,
      }))
      .sort((a: any, b: any) => b.total - a.total)

    const outstandingTotal = outstandingOrders.reduce((s: number, o: any) => s + o.total, 0)

    const result = {
      ok: true,
      daily,
      newAccounts: { current: newAccounts30d, previous: newAccountsPrev30d, yoy: newAccountsYoY },
      outstanding: { orders: outstandingOrders, total: outstandingTotal, count: outstandingOrders.length },
    }

    historyCache = { data: result, fetchedAt: Date.now() }
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
