import { NextRequest, NextResponse } from 'next/server'
import { subDays, startOfDay, endOfDay } from 'date-fns'

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

async function fetchAllPages(basePath: string, maxPages = 10): Promise<any[]> {
  const sep = basePath.includes('?') ? '&' : '?'
  let all: any[] = []
  for (let page = 1; page <= maxPages; page++) {
    const data = await veeqoFetch(`${basePath}${sep}page_size=100&page=${page}`)
    if (!Array.isArray(data) || data.length === 0) break
    all = all.concat(data)
    if (data.length < 100) break
  }
  return all
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const range = searchParams.get('range') || 'today'
  const customSince = searchParams.get('since')
  const customUntil = searchParams.get('until')

  try {
    const now = new Date()
    let since: Date, until: Date

    if (customSince && customUntil) {
      since = startOfDay(new Date(customSince))
      until = endOfDay(new Date(customUntil))
    } else {
      switch (range) {
        case 'yesterday': since = startOfDay(subDays(now, 1)); until = endOfDay(subDays(now, 1)); break
        case '7days':     since = startOfDay(subDays(now, 7)); until = endOfDay(now); break
        case '30days':    since = startOfDay(subDays(now, 30)); until = endOfDay(now); break
        default:          since = startOfDay(now); until = endOfDay(now)
      }
    }

    const sinceISO = encodeURIComponent(since.toISOString())
    const untilISO = encodeURIComponent(until.toISOString())

    const orders = await fetchAllPages(
      `/orders?status=cancelled&created_at_min=${sinceISO}&created_at_max=${untilISO}`
    )

    // Group by channel
    const channelMap: Record<string, { count: number; value: number }> = {}
    orders.forEach((o: any) => {
      const chName = o.channel?.name || 'Unknown'
      if (!channelMap[chName]) channelMap[chName] = { count: 0, value: 0 }
      channelMap[chName].count++
      channelMap[chName].value += parseFloat(o.total_price || 0)
    })

    const channels = Object.entries(channelMap)
      .map(([name, data]) => ({ name, count: data.count, value: data.value }))
      .sort((a, b) => b.count - a.count)

    const total = orders.length
    const totalValue = orders.reduce((s: number, o: any) => s + parseFloat(o.total_price || 0), 0)

    return NextResponse.json({ ok: true, total, totalValue, channels })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
