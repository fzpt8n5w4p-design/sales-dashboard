import { NextResponse } from 'next/server'

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

async function fetchAllPages(basePath: string): Promise<any[]> {
  const sep = basePath.includes('?') ? '&' : '?'
  let all: any[] = []
  for (let page = 1; page <= 30; page++) {
    const data = await veeqoFetch(`${basePath}${sep}page_size=100&page=${page}`)
    if (!Array.isArray(data) || data.length === 0) break
    all = all.concat(data)
    if (data.length < 100) break
  }
  return all
}

const FBA_TYPES = new Set(['amazon_fba'])
const EXCLUDED_TAGS = new Set(['on hold', 'pre order', 'pre-order', 'urgent'])
const PRE_ORDER_TAGS = new Set(['pre order', 'pre-order'])

function getOrderTags(o: any): string[] {
  return (o.tags || []).map((tag: any) => (tag.name || '').toLowerCase())
}

function getOrderWarehouses(o: any): string[] {
  return (o.allocations || []).map((a: any) => a.warehouse?.name || '').filter(Boolean)
}

// Cache the small result. The underlying paged fetches are slow and Veeqo
// rate-limits under load, so without this every poll (live view + main
// dashboard) pays the full cost. 3-min freshness is fine for fulfilment counts.
let cache: { data: any; at: number } | null = null
const CACHE_TTL = 3 * 60 * 1000

// Coalesce concurrent requests: while one fetch is in flight, everyone else
// awaits it instead of firing their own (prevents a thundering herd that makes
// Veeqo rate-limiting far worse when several pollers hit at once).
let inFlight: Promise<any> | null = null

async function computeReady() {
  const now = new Date()
  const yesterdayStart = new Date(now)
  yesterdayStart.setDate(yesterdayStart.getDate() - 1)
  yesterdayStart.setHours(0, 0, 0, 0)
  const yesterdayEnd = new Date(now)
  yesterdayEnd.setDate(yesterdayEnd.getDate() - 1)
  yesterdayEnd.setHours(23, 59, 59, 999)

  // Use updated_at_min to limit shipped orders to recent ones, filter client-side.
  const orders = await fetchAllPages('/orders?status=awaiting_fulfillment')
  const shippedOrders = await fetchAllPages(`/orders?status=shipped&updated_at_min=${yesterdayStart.toISOString()}`)

  const readyToShip = orders.filter((o: any) => {
    if (FBA_TYPES.has(o.channel?.type_code)) return false
    const tags = getOrderTags(o)
    if (tags.some(tag => EXCLUDED_TAGS.has(tag))) return false
    const warehouses = getOrderWarehouses(o)
    if (!warehouses.some(w => w === 'Wirral Warehouse')) return false
    return true
  }).length

  const preOrders = orders.filter((o: any) => {
    const tags = getOrderTags(o)
    return tags.some(tag => PRE_ORDER_TAGS.has(tag))
  }).length

  const shippedYesterday = shippedOrders.filter((o: any) => {
    if (FBA_TYPES.has(o.channel?.type_code)) return false
    const shippedAt = o.shipped_at ? new Date(o.shipped_at) : null
    if (!shippedAt || shippedAt < yesterdayStart || shippedAt > yesterdayEnd) return false
    const warehouses = getOrderWarehouses(o)
    return warehouses.some(w => w === 'Wirral Warehouse')
  }).length

  const data = { ok: true, readyToShip, preOrders, shippedYesterday, total: orders.length }
  cache = { data, at: Date.now() }
  return data
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL) {
    return NextResponse.json({ ...cache.data, cached: true })
  }
  try {
    if (!inFlight) inFlight = computeReady().finally(() => { inFlight = null })
    const data = await inFlight
    return NextResponse.json(data)
  } catch (err: any) {
    // Serve stale cache if available so a transient Veeqo error doesn't blank the tile.
    if (cache) return NextResponse.json({ ...cache.data, cached: true, stale: true })
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
