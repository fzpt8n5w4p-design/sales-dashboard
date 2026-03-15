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

export async function GET() {
  try {
    // "Ready to Ship" in Veeqo = awaiting_fulfillment (allocated, ready to pick/pack)
    const orders = await fetchAllPages('/orders?status=awaiting_fulfillment')

    const EXCLUDED_TAGS = new Set(['on hold', 'pre order', 'pre-order', 'urgent'])

    // Filter out FBA orders and orders with excluded tags
    const readyToShip = orders.filter((o: any) => {
      if (FBA_TYPES.has(o.channel?.type_code)) return false
      const tags = (o.tags || []).map((tag: any) => (tag.name || '').toLowerCase())
      if (tags.some((tag: string) => EXCLUDED_TAGS.has(tag))) return false
      return true
    }).length

    return NextResponse.json({ ok: true, readyToShip, total: orders.length })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
