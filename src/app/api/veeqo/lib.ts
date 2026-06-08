// Shared Veeqo API helpers. Mirrors the pattern in src/app/api/shopify/lib.ts.
// Extracted from veeqo/route.ts so the live-view endpoint can reuse the same
// rate-limit/backoff + memory-bounded streaming logic.

const VEEQO_BASE = 'https://api.veeqo.com'

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function veeqoFetch(path: string, retries = 4): Promise<any> {
  const key = process.env.VEEQO_API_KEY
  if (!key) throw new Error('VEEQO_API_KEY not set')
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${VEEQO_BASE}${path}`, {
      headers: { 'x-api-key': key },
      cache: 'no-store'
    })
    if (res.status === 429) {
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s — total ~31s worst case.
      // Veeqo's bucket refills slowly under sustained load.
      await delay(1000 * Math.pow(2, attempt))
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

// Stream pages in batches, calling onPage for each. Pages are dropped after
// processing so peak memory stays bounded by batch size, not by total dataset
// size. This is the key change for staying under Render's 512MB.
export async function veeqoStreamPages(
  basePath: string,
  onPage: (page: any[]) => void,
  maxPages = 50
): Promise<void> {
  const sep = basePath.includes('?') ? '&' : '?'
  // BATCH=2 keeps in-stream concurrency low so Veeqo's rate limit isn't
  // exhausted when the route runs multiple streams sequentially.
  const BATCH = 2
  for (let start = 1; start <= maxPages; start += BATCH) {
    const batch: Promise<any[]>[] = []
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
      onPage(page)
      if (page.length < 100) { done = true; break }
    }
    if (done) break
  }
}
