import { NextRequest, NextResponse } from 'next/server'
import { subDays, startOfDay, endOfDay, format } from 'date-fns'

export const dynamic = 'force-dynamic'

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
    }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error('Google OAuth token refresh failed: ' + res.status)
  const data = await res.json()
  return data.access_token as string
}

async function queryGoogleAds(token: string, customerId: string, query: string) {
  const res = await fetch(
    `https://googleads.googleapis.com/v19/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      cache: 'no-store',
    }
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google Ads API ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  return data.results || []
}

export async function GET(req: NextRequest) {
  const required = ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID']
  const missing = required.filter(k => !process.env[k])
  if (missing.length) {
    return NextResponse.json({ ok: false, error: `Missing env vars: ${missing.join(', ')}` }, { status: 500 })
  }

  const { searchParams } = req.nextUrl
  const range = searchParams.get('range') || 'today'
  const customSince = searchParams.get('since')
  const customUntil = searchParams.get('until')
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID!.replace(/-/g, '')

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

    const sinceStr = format(since, 'yyyy-MM-dd')
    const untilStr = format(until, 'yyyy-MM-dd')

    const token = await getAccessToken()

    // Account-level metrics
    const accountQuery = `
      SELECT
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc,
        metrics.cost_per_conversion
      FROM customer
      WHERE segments.date BETWEEN '${sinceStr}' AND '${untilStr}'
    `

    // Campaign-level breakdown
    const campaignQuery = `
      SELECT
        campaign.name,
        campaign.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${sinceStr}' AND '${untilStr}'
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 10
    `

    const [accountRows, campaignRows] = await Promise.all([
      queryGoogleAds(token, customerId, accountQuery),
      queryGoogleAds(token, customerId, campaignQuery),
    ])

    // Aggregate account metrics (may be multiple rows for date segments)
    let impressions = 0, clicks = 0, costMicros = 0, conversions = 0, convValue = 0
    accountRows.forEach((r: any) => {
      const m = r.metrics || {}
      impressions += parseInt(m.impressions || 0)
      clicks += parseInt(m.clicks || 0)
      costMicros += parseInt(m.costMicros || 0)
      conversions += parseFloat(m.conversions || 0)
      convValue += parseFloat(m.conversionsValue || 0)
    })

    const spend = costMicros / 1_000_000
    const ctr = impressions ? (clicks / impressions) * 100 : 0
    const avgCpc = clicks ? spend / clicks : 0
    const costPerConv = conversions ? spend / conversions : 0
    const roas = spend ? convValue / spend : 0

    // Campaign breakdown
    const campaigns = campaignRows.map((r: any) => {
      const m = r.metrics || {}
      const c = r.campaign || {}
      const campCost = parseInt(m.costMicros || 0) / 1_000_000
      const campConv = parseFloat(m.conversions || 0)
      return {
        name: c.name || 'Unknown',
        status: c.status || 'UNKNOWN',
        impressions: parseInt(m.impressions || 0),
        clicks: parseInt(m.clicks || 0),
        spend: campCost,
        conversions: campConv,
        convValue: parseFloat(m.conversionsValue || 0),
        roas: campCost ? parseFloat(m.conversionsValue || 0) / campCost : 0,
      }
    }).filter((c: any) => c.impressions > 0 || c.clicks > 0 || c.spend > 0)

    return NextResponse.json({
      ok: true,
      account: {
        impressions, clicks, spend, conversions, convValue,
        ctr: Math.round(ctr * 100) / 100,
        avgCpc: Math.round(avgCpc * 100) / 100,
        costPerConv: Math.round(costPerConv * 100) / 100,
        roas: Math.round(roas * 100) / 100,
      },
      campaigns,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
