const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

export function getShopifyBase() {
  const store = process.env.SHOPIFY_B2B_STORE
  if (!store) throw new Error('SHOPIFY_B2B_STORE not set')
  return `https://${store}/admin/api/2024-01`
}

async function shopifyRawFetch(url: string, retries = 2): Promise<Response> {
  const token = process.env.SHOPIFY_B2B_TOKEN
  if (!token) throw new Error('SHOPIFY_B2B_TOKEN not set')
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      cache: 'no-store',
    })
    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get('Retry-After') || '2')
      await delay(retryAfter * 1000)
      continue
    }
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Shopify ${res.status}: ${body.slice(0, 200)}`)
    }
    return res
  }
  throw new Error('Shopify rate limited after retries')
}

export async function shopifyFetch(path: string, retries = 2): Promise<any> {
  const base = getShopifyBase()
  const url = path.startsWith('http') ? path : `${base}${path}`
  const res = await shopifyRawFetch(url, retries)
  return res.json()
}

function parseLinkHeader(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/<([^>]+)>;\s*rel="next"/)
  return match ? match[1] : null
}

export async function shopifyFetchAll(basePath: string, resourceKey: string, maxPages = 20): Promise<any[]> {
  const base = getShopifyBase()
  let all: any[] = []
  const seen = new Set<number>()
  const hasLimit = basePath.includes('limit=')
  let url: string | null = hasLimit
    ? `${base}${basePath}`
    : `${base}${basePath.includes('?') ? `${basePath}&limit=250` : `${basePath}?limit=250`}`

  for (let page = 0; page < maxPages && url; page++) {
    const res = await shopifyRawFetch(url)
    const data = await res.json()
    const items = data[resourceKey]
    if (!Array.isArray(items) || items.length === 0) break

    // Deduplicate by id
    for (const item of items) {
      if (!seen.has(item.id)) {
        seen.add(item.id)
        all.push(item)
      }
    }

    if (items.length < 250) break

    // Use Link header for cursor pagination (preferred by Shopify)
    url = parseLinkHeader(res.headers.get('Link'))
    if (!url) break

    await delay(500)
  }
  return all
}

// Streaming variant: invokes onPage for each page (deduplicated by id) and
// drops the page after. Lets callers aggregate without holding the full
// dataset in memory — required for staying under Render's 512MB tier.
export async function shopifyStreamPages(
  basePath: string,
  resourceKey: string,
  onPage: (items: any[]) => void,
  maxPages = 20
): Promise<void> {
  const base = getShopifyBase()
  const seen = new Set<number>()
  const hasLimit = basePath.includes('limit=')
  let url: string | null = hasLimit
    ? `${base}${basePath}`
    : `${base}${basePath.includes('?') ? `${basePath}&limit=250` : `${basePath}?limit=250`}`

  for (let page = 0; page < maxPages && url; page++) {
    const res = await shopifyRawFetch(url)
    const data = await res.json()
    const items = data[resourceKey]
    if (!Array.isArray(items) || items.length === 0) break

    const fresh: any[] = []
    for (const item of items) {
      if (!seen.has(item.id)) {
        seen.add(item.id)
        fresh.push(item)
      }
    }
    if (fresh.length > 0) onPage(fresh)

    if (items.length < 250) break

    url = parseLinkHeader(res.headers.get('Link'))
    if (!url) break

    await delay(500)
  }
}
