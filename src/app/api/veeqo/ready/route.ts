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

export async function GET() {
  try {
    const orders = await fetchAllPages('/orders?status=awaiting_fulfillment')

    // Ready to ship: non-FBA, Wirral Warehouse, no excluded tags
    const readyToShip = orders.filter((o: any) => {
      if (FBA_TYPES.has(o.channel?.type_code)) return false
      const tags = getOrderTags(o)
      if (tags.some(tag => EXCLUDED_TAGS.has(tag))) return false
      const warehouses = getOrderWarehouses(o)
      if (!warehouses.some(w => w === 'Wirral Warehouse')) return false
      return true
    }).length

    // Pre-orders: tagged pre order/pre-order, awaiting_fulfillment status (already filtered)
    const preOrders = orders.filter((o: any) => {
      const tags = getOrderTags(o)
      return tags.some(tag => PRE_ORDER_TAGS.has(tag))
    }).length

    return NextResponse.json({ ok: true, readyToShip, preOrders, total: orders.length })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
