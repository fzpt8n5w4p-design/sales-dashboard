import { NextResponse } from 'next/server'
import { subDays, startOfDay, endOfDay, format } from 'date-fns'

export const dynamic = 'force-dynamic'

const VEEQO_BASE = 'https://api.veeqo.com'

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

async function veeqoFetch(path: string, retries = 2): Promise<any> {
  const key = process.env.VEEQO_API_KEY
  if (!key) throw new Error('VEEQO_API_KEY not set')
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${VEEQO_BASE}${path}`, {
      headers: { 'x-api-key': key },
      cache: 'no-store'
    })
    if (res.status === 429) {
      await delay(1000 * (attempt + 1))
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

async function veeqoFetchAll(basePath: string, maxPages = 20): Promise<any[]> {
  const sep = basePath.includes('?') ? '&' : '?'
  let all: any[] = []
  const BATCH = 3
  for (let start = 1; start <= maxPages; start += BATCH) {
    const batch = []
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
      all = all.concat(page)
      if (page.length < 100) { done = true; break }
    }
    if (done) break
  }
  return all
}

// In-memory cache for the 30-day history (refreshes every 5 minutes)
let historyCache: { data: any; fetchedAt: number } | null = null
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes — this is a heavy fetch

export async function GET() {
  try {
    if (historyCache && Date.now() - historyCache.fetchedAt < CACHE_TTL) {
      return NextResponse.json(historyCache.data)
    }

    const now = new Date()
    const since = startOfDay(subDays(now, 29))
    const until = endOfDay(now)
    const sinceISO = encodeURIComponent(since.toISOString())
    const untilISO = encodeURIComponent(until.toISOString())

    const orders = await veeqoFetchAll(`/orders?created_at_min=${sinceISO}&created_at_max=${untilISO}`, 50)

    // Group by day
    const dayMap: Record<string, { orders: number; revenue: number; units: number }> = {}

    // Pre-fill all 30 days so there are no gaps
    for (let i = 29; i >= 0; i--) {
      const day = format(subDays(now, i), 'yyyy-MM-dd')
      dayMap[day] = { orders: 0, revenue: 0, units: 0 }
    }

    let totalUnitsSold = 0
    orders.forEach((o: any) => {
      const day = format(new Date(o.created_at), 'yyyy-MM-dd')
      const items = o.line_items || []
      let orderUnits = 0
      items.forEach((li: any) => { orderUnits += li.quantity || 1 })
      totalUnitsSold += orderUnits
      if (dayMap[day]) {
        dayMap[day].orders++
        dayMap[day].revenue += parseFloat(o.total_price || 0)
        dayMap[day].units += orderUnits
      }
    })

    const daily = Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        label: format(new Date(date), 'dd MMM'),
        orders: data.orders,
        revenue: Math.round(data.revenue * 100) / 100,
        units: data.units,
      }))

    const totalOrders = daily.reduce((s, d) => s + d.orders, 0)
    const totalRevenue = daily.reduce((s, d) => s + d.revenue, 0)

    const result = { ok: true, daily, totalOrders, totalRevenue, totalUnitsSold }
    historyCache = { data: result, fetchedAt: Date.now() }

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
