const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

export function getShopifyBase() {
  const store = process.env.SHOPIFY_B2B_STORE
  if (!store) throw new Error('SHOPIFY_B2B_STORE not set')
  return `https://${store}/admin/api/2024-01`
}

export async function shopifyFetch(path: string, retries = 2): Promise<any> {
  const token = process.env.SHOPIFY_B2B_TOKEN
  if (!token) throw new Error('SHOPIFY_B2B_TOKEN not set')
  const base = getShopifyBase()
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${base}${path}`, {
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
    return res.json()
  }
  throw new Error('Shopify rate limited after retries')
}

export async function shopifyFetchAll(basePath: string, resourceKey: string, maxPages = 20): Promise<any[]> {
  let all: any[] = []
  let url: string | null = basePath.includes('?') ? `${basePath}&limit=250` : `${basePath}?limit=250`

  for (let page = 0; page < maxPages && url; page++) {
    const data = await shopifyFetch(url)
    const items = data[resourceKey]
    if (!Array.isArray(items) || items.length === 0) break
    all = all.concat(items)

    // Parse Link header for cursor pagination
    url = null
    // Shopify returns pagination info in the response for REST API
    // For simplicity, if we got less than 250 items, we're done
    if (items.length < 250) break

    // Check if there's a next page via link header (handled differently in fetch)
    // We need to construct the next URL from page_info
    // Actually, Shopify REST API uses page_info parameter
    // The link info is embedded in the response headers which we don't have access to
    // in the shopifyFetch helper. Let's use a simpler approach with since_id
    const lastId = items[items.length - 1]?.id
    if (lastId) {
      const sep = basePath.includes('?') ? '&' : '?'
      url = `${basePath}${sep}limit=250&since_id=${lastId}`
    }

    await delay(500) // Rate limit protection
  }
  return all
}
