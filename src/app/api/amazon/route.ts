import { NextRequest, NextResponse } from 'next/server'
import { subDays, startOfDay, endOfDay } from 'date-fns'

export const dynamic = 'force-dynamic'

async function getLwaToken() {
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.AMAZON_REFRESH_TOKEN!,
      client_id: process.env.AMAZON_CLIENT_ID!,
      client_secret: process.env.AMAZON_CLIENT_SECRET!,
    }),
    cache: 'no-store'
  })
  if (!res.ok) throw new Error('Amazon LWA auth failed: ' + res.status)
  const data = await res.json()
  return data.access_token as string
}

async function spFetch(token: string, path: string) {
  const res = await fetch(`https://sellingpartnerapi-eu.amazon.com${path}`, {
    headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
    cache: 'no-store'
  })
  if (!res.ok) throw new Error(`Amazon SP-API ${res.status} — ${path}`)
  return res.json()
}

export async function GET(req: NextRequest) {
  const required = ['AMAZON_SELLER_ID','AMAZON_CLIENT_ID','AMAZON_CLIENT_SECRET','AMAZON_REFRESH_TOKEN']
  const missing = required.filter(k => !process.env[k])
  if (missing.length) {
    return NextResponse.json({ ok: false, error: `Missing env vars: ${missing.join(', ')}` }, { status: 500 })
  }

  const { searchParams } = req.nextUrl
  const range = searchParams.get('range') || 'today'
  const customSince = searchParams.get('since')
  const customUntil = searchParams.get('until')
  const mkt = process.env.AMAZON_MARKETPLACE_ID || 'A1F83G8C2ARO7P'

  try {
    const now = new Date()
    let since: Date, until: Date
    if (customSince && customUntil) {
      since = startOfDay(new Date(customSince))
      until = endOfDay(new Date(customUntil))
    } else {
      switch (range) {
        case 'yesterday': since = startOfDay(subDays(now,1)); until = endOfDay(subDays(now,1)); break
        case '7days':     since = startOfDay(subDays(now,7)); until = endOfDay(now); break
        case '30days':    since = startOfDay(subDays(now,30)); until = endOfDay(now); break
        default:          since = startOfDay(now); until = endOfDay(now)
      }
    }

    const token = await getLwaToken()

    const [ordersData, cancelledData] = await Promise.all([
      spFetch(token,
        `/orders/v0/orders?MarketplaceIds=${mkt}&CreatedAfter=${since.toISOString()}&CreatedBefore=${until.toISOString()}&OrderStatuses=Unshipped,PartiallyShipped,Shipped`
      ),
      spFetch(token,
        `/orders/v0/orders?MarketplaceIds=${mkt}&CreatedAfter=${since.toISOString()}&CreatedBefore=${until.toISOString()}&OrderStatuses=Canceled`
      )
    ])

    const orders = ordersData.payload?.Orders || []
    const cancelled = cancelledData.payload?.Orders || []

    let revenue = 0
    orders.forEach((o: any) => { revenue += parseFloat(o.OrderTotal?.Amount || 0) })

    // Channel breakdown by marketplace
    const ukOrders  = orders.filter((o: any) => o.MarketplaceId === 'A1F83G8C2ARO7P')
    const euOrders  = orders.filter((o: any) => o.MarketplaceId !== 'A1F83G8C2ARO7P')
    const ukRev = ukOrders.reduce((s: number, o: any) => s + parseFloat(o.OrderTotal?.Amount || 0), 0)
    const euRev = euOrders.reduce((s: number, o: any) => s + parseFloat(o.OrderTotal?.Amount || 0), 0)

    // Hourly
    const hourly: Record<number, number> = {}
    orders.forEach((o: any) => {
      const h = new Date(o.PurchaseDate).getHours()
      hourly[h] = (hourly[h] || 0) + 1
    })

    return NextResponse.json({
      ok: true,
      orders: { total: orders.length, revenue, ukOrders: ukOrders.length, ukRevenue: ukRev, euOrders: euOrders.length, euRevenue: euRev, hourly },
      returns: { cancelled: cancelled.length },
      rating: { score: parseFloat(process.env.AMAZON_SELLER_RATING || '0') || null, reviews: orders.length }
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
