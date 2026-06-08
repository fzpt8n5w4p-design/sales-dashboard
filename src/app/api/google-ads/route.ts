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

async function queryGoogleAds(token: string, customerId: string, query: string, loginCustomerId?: string) {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    'Content-Type': 'application/json',
  }
  // When the client account sits under a manager (MCC), the manager ID must be
  // sent as login-customer-id while the URL targets the client account.
  const loginId = (loginCustomerId || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '')
  if (loginId) headers['login-customer-id'] = loginId

  const res = await fetch(
    `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
      cache: 'no-store',
    }
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google Ads API ${res.status}: ${body.slice(0, 1500)}`)
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
  const configuredId = process.env.GOOGLE_ADS_CUSTOMER_ID!.replace(/-/g, '')
  // login-customer-id for all calls: an explicit manager if set, else the
  // configured account (works whether it's a manager or a standalone client).
  const loginId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || configuredId).replace(/-/g, '')

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

    // GOOGLE_ADS_CUSTOMER_ID is the manager (MCC), which can't report metrics —
    // so report the specific ridecore client account, with the manager sent as
    // login-customer-id. Override the client via GOOGLE_ADS_REPORT_CUSTOMER_ID.
    const reportId = (process.env.GOOGLE_ADS_REPORT_CUSTOMER_ID || '9683657843').replace(/-/g, '')
    const targets = [reportId]

    // Pull metrics from each client account and aggregate.
    let impressions = 0, clicks = 0, costMicros = 0, conversions = 0, convValue = 0
    const campaignMap: Record<string, { name: string; status: string; impressions: number; clicks: number; spend: number; conversions: number; convValue: number }> = {}

    for (const cid of targets) {
      const [accountRows, campaignRows] = await Promise.all([
        queryGoogleAds(token, cid, accountQuery, loginId),
        queryGoogleAds(token, cid, campaignQuery, loginId),
      ])
      accountRows.forEach((r: any) => {
        const m = r.metrics || {}
        impressions += parseInt(m.impressions || 0)
        clicks += parseInt(m.clicks || 0)
        costMicros += parseInt(m.costMicros || 0)
        conversions += parseFloat(m.conversions || 0)
        convValue += parseFloat(m.conversionsValue || 0)
      })
      campaignRows.forEach((r: any) => {
        const m = r.metrics || {}
        const c = r.campaign || {}
        const name = c.name || 'Unknown'
        if (!campaignMap[name]) campaignMap[name] = { name, status: c.status || 'UNKNOWN', impressions: 0, clicks: 0, spend: 0, conversions: 0, convValue: 0 }
        const e = campaignMap[name]
        e.impressions += parseInt(m.impressions || 0)
        e.clicks += parseInt(m.clicks || 0)
        e.spend += parseInt(m.costMicros || 0) / 1_000_000
        e.conversions += parseFloat(m.conversions || 0)
        e.convValue += parseFloat(m.conversionsValue || 0)
      })
    }

    const spend = costMicros / 1_000_000
    const ctr = impressions ? (clicks / impressions) * 100 : 0
    const avgCpc = clicks ? spend / clicks : 0
    const costPerConv = conversions ? spend / conversions : 0
    const roas = spend ? convValue / spend : 0

    const campaigns = Object.values(campaignMap)
      .map(c => ({ ...c, roas: c.spend ? c.convValue / c.spend : 0 }))
      .filter(c => c.impressions > 0 || c.clicks > 0 || c.spend > 0)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10)

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
