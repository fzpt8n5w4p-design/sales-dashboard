import { NextResponse } from 'next/server'
import { subDays, subYears, startOfDay, startOfYear, endOfDay } from 'date-fns'
import { shopifyStreamPages } from '../lib'

export const dynamic = 'force-dynamic'

let customersCache: { data: any; fetchedAt: number } | null = null
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

const excludeStatuses = new Set(['cancelled', 'voided', 'refunded'])

type CustomerSlim = {
  id: number
  name: string
  email: string
  company: string
  ordersCount: number
  totalSpent: number
  lastOrderDate: string | null
  createdAt: string
}

export async function GET() {
  try {
    if (customersCache && Date.now() - customersCache.fetchedAt < CACHE_TTL) {
      return NextResponse.json(customersCache.data)
    }
    const now = new Date()
    const thirtyDaysAgo = startOfDay(subDays(now, 30))
    const sixtyDaysAgo = startOfDay(subDays(now, 60))
    const yearStart = startOfYear(now)
    const prevYearStart = subYears(yearStart, 1)
    const prevYearNow = subYears(now, 1)
    const prevYear30dAgo = subYears(thirtyDaysAgo, 1)
    const prevYearNowEnd = endOfDay(prevYearNow)

    // Stream customers — keep only the slim shape used in the response.
    // Raw Shopify customer objects carry addresses, metafields, marketing
    // consent, tax exemptions, etc. — ~3KB each vs ~150 bytes for the slim
    // shape. Counting prevYear customers inline avoids a second pass.
    const customers: CustomerSlim[] = []
    let totalCustomersPrevYear = 0
    await shopifyStreamPages('/customers.json', 'customers', page => {
      for (const c of page) {
        customers.push({
          id: c.id,
          name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || 'Unknown',
          email: c.email || '',
          company: c.default_address?.company || '',
          ordersCount: c.orders_count || 0,
          totalSpent: parseFloat(c.total_spent || '0'),
          lastOrderDate: c.last_order_name ? c.updated_at : null,
          createdAt: c.created_at,
        })
        if (new Date(c.created_at) <= prevYearNow) totalCustomersPrevYear++
      }
    })

    // Stream 5 order date ranges. Each one only needs a small running set
    // of aggregates — never hold the full order arrays in memory.
    const spend30d: Record<number, number> = {}
    const activeCustomerIds = new Set<number>()
    let totalRevenue30d = 0
    await shopifyStreamPages(
      `/orders.json?status=any&created_at_min=${thirtyDaysAgo.toISOString()}&created_at_max=${endOfDay(now).toISOString()}`,
      'orders',
      page => {
        for (const o of page) {
          if (excludeStatuses.has(o.financial_status) || o.cancelled_at) continue
          const price = parseFloat(o.total_price || '0')
          totalRevenue30d += price
          const cid = o.customer?.id
          if (cid) {
            spend30d[cid] = (spend30d[cid] || 0) + price
            activeCustomerIds.add(cid)
          }
        }
      }
    )

    let prevRevenue30d = 0
    const prevActiveCustomerIds = new Set<number>()
    await shopifyStreamPages(
      `/orders.json?status=any&created_at_min=${sixtyDaysAgo.toISOString()}&created_at_max=${endOfDay(subDays(thirtyDaysAgo, 1)).toISOString()}`,
      'orders',
      page => {
        for (const o of page) {
          if (excludeStatuses.has(o.financial_status) || o.cancelled_at) continue
          prevRevenue30d += parseFloat(o.total_price || '0')
          const cid = o.customer?.id
          if (cid) prevActiveCustomerIds.add(cid)
        }
      }
    )

    const spendYTD: Record<number, number> = {}
    await shopifyStreamPages(
      `/orders.json?status=any&created_at_min=${yearStart.toISOString()}&created_at_max=${endOfDay(now).toISOString()}`,
      'orders',
      page => {
        for (const o of page) {
          if (excludeStatuses.has(o.financial_status) || o.cancelled_at) continue
          const cid = o.customer?.id
          if (cid) {
            spendYTD[cid] = (spendYTD[cid] || 0) + parseFloat(o.total_price || '0')
          }
        }
      }
    )

    let prevYTDRevenue = 0
    await shopifyStreamPages(
      `/orders.json?status=any&created_at_min=${prevYearStart.toISOString()}&created_at_max=${prevYearNowEnd.toISOString()}`,
      'orders',
      page => {
        for (const o of page) {
          if (excludeStatuses.has(o.financial_status) || o.cancelled_at) continue
          prevYTDRevenue += parseFloat(o.total_price || '0')
        }
      }
    )

    let prevYearRevenue30d = 0
    const prevYearActiveCustomerIds = new Set<number>()
    await shopifyStreamPages(
      `/orders.json?status=any&created_at_min=${prevYear30dAgo.toISOString()}&created_at_max=${prevYearNowEnd.toISOString()}`,
      'orders',
      page => {
        for (const o of page) {
          if (excludeStatuses.has(o.financial_status) || o.cancelled_at) continue
          prevYearRevenue30d += parseFloat(o.total_price || '0')
          const cid = o.customer?.id
          if (cid) prevYearActiveCustomerIds.add(cid)
        }
      }
    )

    const mapped = customers.map(c => ({
      ...c,
      spend30d: spend30d[c.id] || 0,
      spendYTD: spendYTD[c.id] || 0,
    }))
    mapped.sort((a, b) => b.totalSpent - a.totalSpent)

    let totalSpendAll = 0
    let totalSpendYTD = 0
    for (const c of mapped) {
      totalSpendAll += c.totalSpent
      totalSpendYTD += c.spendYTD
    }

    const result = {
      ok: true,
      customers: mapped,
      totalCustomers: mapped.length,
      totalSpendAll,
      totalSpendYTD,
      prevYTDRevenue,
      totalRevenue30d,
      prevRevenue30d,
      prevYearRevenue30d,
      activeCustomers30d: activeCustomerIds.size,
      prevActiveCustomers30d: prevActiveCustomerIds.size,
      prevYearActiveCustomers30d: prevYearActiveCustomerIds.size,
      totalCustomersPrevYear,
    }
    customersCache = { data: result, fetchedAt: Date.now() }
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
