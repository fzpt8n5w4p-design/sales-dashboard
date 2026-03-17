import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/* ---------- types ---------- */
interface StockEntry {
  physical_quantity: number
}

interface Sellable {
  sku_code: string
  stock_entries: StockEntry[]
}

interface Channel {
  type_code: string
}

interface ChannelProduct {
  channel: Channel
}

interface VeeqoProduct {
  title: string
  sellables: Sellable[]
  channel_products: ChannelProduct[]
}

interface UnlistedProduct {
  title: string
  sku: string
  currentChannels: string[]
  missingFrom: string[]
  stockLevel: number
}

/* ---------- cache ---------- */
let cache: { data: any; ts: number } | null = null
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

/* ---------- helpers ---------- */
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

async function veeqoFetch(path: string, retries = 2): Promise<any> {
  const key = process.env.VEEQO_API_KEY
  if (!key) throw new Error('VEEQO_API_KEY not set')
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`https://api.veeqo.com${path}`, {
      headers: { 'x-api-key': key },
      cache: 'no-store',
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

async function fetchAllProducts(): Promise<VeeqoProduct[]> {
  const all: VeeqoProduct[] = []
  const maxPages = 50
  const batchSize = 3

  for (let start = 1; start <= maxPages; start += batchSize) {
    const batch = []
    for (let p = start; p < start + batchSize && p <= maxPages; p++) {
      batch.push(
        veeqoFetch(`/products?page_size=100&page=${p}`).catch(() => [] as VeeqoProduct[])
      )
    }
    const results = await Promise.all(batch)
    let done = false
    for (const page of results) {
      if (!Array.isArray(page) || page.length === 0) {
        done = true
        break
      }
      all.push(...page)
    }
    if (done) break
  }

  return all
}

/* ---------- channel helpers ---------- */
const CHANNEL_LABEL: Record<string, string> = {
  shopify: 'Shopify',
  amazon_fba: 'Amazon',
  amazon: 'Amazon',
  ebay: 'eBay',
}

function classifyChannels(product: VeeqoProduct) {
  const channels = new Set<string>()
  for (const cp of product.channel_products ?? []) {
    const code = cp.channel?.type_code
    if (code && CHANNEL_LABEL[code]) {
      channels.add(CHANNEL_LABEL[code])
    }
  }
  return channels
}

/* ---------- handler ---------- */
export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json(cache.data)
    }

    const allProducts = await fetchAllProducts()

    const unlisted: UnlistedProduct[] = []
    let missingEbay = 0
    let missingAmazon = 0
    let missingBoth = 0

    for (const product of allProducts) {
      const channels = classifyChannels(product)
      const missing: string[] = []

      if (!channels.has('eBay')) missing.push('eBay')
      if (!channels.has('Amazon')) missing.push('Amazon')

      if (missing.length === 0) continue

      const firstSellable = product.sellables?.[0]
      const sku = firstSellable?.sku_code ?? ''
      const stockLevel = (firstSellable?.stock_entries ?? []).reduce(
        (sum: number, e: StockEntry) => sum + (e.physical_quantity ?? 0),
        0
      )

      unlisted.push({
        title: product.title ?? 'Untitled',
        sku,
        currentChannels: Array.from(channels),
        missingFrom: missing,
        stockLevel,
      })

      if (missing.includes('eBay')) missingEbay++
      if (missing.includes('Amazon')) missingAmazon++
      if (missing.length === 2) missingBoth++
    }

    // Sort: missing both first, then alphabetically by title
    unlisted.sort((a, b) => {
      const aBoth = a.missingFrom.length === 2 ? 0 : 1
      const bBoth = b.missingFrom.length === 2 ? 0 : 1
      if (aBoth !== bBoth) return aBoth - bBoth
      return a.title.localeCompare(b.title)
    })

    const data = {
      ok: true,
      products: unlisted,
      totalProducts: allProducts.length,
      missingEbay,
      missingAmazon,
      missingBoth,
    }

    cache = { data, ts: Date.now() }
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
