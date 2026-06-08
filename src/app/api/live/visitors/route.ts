import { NextResponse } from 'next/server'
import { GoogleAuth, OAuth2Client } from 'google-auth-library'
import { geocode } from '../geo'

export const dynamic = 'force-dynamic'

// Live storefront visitors from the GA4 Realtime API (active users in the last
// ~30 min), broken down by city so they can ping the globe. Covers the Shopify
// storefront(s) only — marketplaces (Amazon/eBay) expose no visitor data.
//
// Two auth modes (whichever is configured wins; OAuth first):
//   OAuth (recommended here — the GA4 property's Workspace org blocks external
//     service accounts): GA4_REFRESH_TOKEN authenticated as a user who already
//     has GA access, plus an OAuth client id/secret (reuses GOOGLE_ADS_* if no
//     GA4-specific one is set).
//   Service account: GA4_SERVICE_ACCOUNT_JSON (the key JSON pasted whole) — only
//     works if the service-account email can be added as a Viewer on the property.
// Unconfigured → graceful no-op so the page still works without it.

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'

let oauthClient: OAuth2Client | null = null
let saClient: GoogleAuth | null = null

// Returns a GA4 access token from whichever auth mode is configured, or null.
async function getAccessToken(): Promise<string | null> {
  const refresh = process.env.GA4_REFRESH_TOKEN
  const clientId = process.env.GA4_OAUTH_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GA4_OAUTH_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET

  if (refresh && clientId && clientSecret) {
    if (!oauthClient) {
      oauthClient = new OAuth2Client(clientId, clientSecret)
      oauthClient.setCredentials({ refresh_token: refresh })
    }
    const { token } = await oauthClient.getAccessToken()
    return token || null
  }

  const raw = process.env.GA4_SERVICE_ACCOUNT_JSON
  if (raw) {
    if (!saClient) {
      const creds = JSON.parse(raw)
      // Env vars often store the private key with escaped newlines; restore them.
      if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, '\n')
      saClient = new GoogleAuth({ credentials: creds, scopes: [SCOPE] })
    }
    const client = await saClient.getClient()
    return (await client.getAccessToken()).token || null
  }

  return null
}

// "Visitors today" + day-over-day delta from standard reports. Cached because
// these change slowly and we don't want to spend GA4 core quota every poll.
type DayStats = { today: number; todayDelta: number | null }
let dayCache: { data: DayStats; at: number } | null = null
const DAY_TTL = 2 * 60 * 1000

async function fetchHourly(propertyId: string, token: string, range: 'today' | 'yesterday') {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        dateRanges: [{ startDate: range, endDate: range }],
        dimensions: [{ name: 'hour' }],
        metrics: [{ name: 'activeUsers' }],
      }),
    }
  )
  if (!res.ok) return [] as any[]
  return ((await res.json()).rows || []) as any[]
}

async function getDayStats(propertyId: string, token: string): Promise<DayStats> {
  if (dayCache && Date.now() - dayCache.at < DAY_TTL) return dayCache.data
  const curHour = new Date().getHours()
  const [todayRows, yestRows] = await Promise.all([
    fetchHourly(propertyId, token, 'today'),
    fetchHourly(propertyId, token, 'yesterday'),
  ])
  const sum = (rows: any[], maxHour: number) =>
    rows.reduce((s, r) => {
      const h = parseInt(r.dimensionValues?.[0]?.value || '-1', 10)
      return h >= 0 && h <= maxHour ? s + (parseInt(r.metricValues?.[0]?.value || '0', 10) || 0) : s
    }, 0)
  const today = sum(todayRows, 23)
  const todaySoFar = sum(todayRows, curHour)
  const yestSoFar = sum(yestRows, curHour)
  const todayDelta = yestSoFar > 0 ? ((todaySoFar - yestSoFar) / yestSoFar) * 100 : null
  const data: DayStats = { today, todayDelta }
  dayCache = { data, at: Date.now() }
  return data
}

export async function GET() {
  // ridecore.pro GA4 property; override per deployment via GA4_PROPERTY_ID.
  const propertyId = process.env.GA4_PROPERTY_ID || '328365624'
  const hasAuth =
    (process.env.GA4_REFRESH_TOKEN &&
      (process.env.GA4_OAUTH_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID)) ||
    process.env.GA4_SERVICE_ACCOUNT_JSON
  if (!propertyId || !hasAuth) {
    return NextResponse.json({ ok: true, configured: false, total: 0, pings: [] })
  }

  try {
    const token = await getAccessToken()
    if (!token) throw new Error('Failed to obtain GA4 access token')

    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runRealtimeReport`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          metrics: [{ name: 'activeUsers' }],
          dimensions: [{ name: 'city' }, { name: 'country' }],
          limit: 100,
        }),
      }
    )
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GA4 ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = await res.json()
    const rows: any[] = data.rows || []

    // "Visitors today" + day-over-day delta (cached; realtime only covers ~30 min).
    let today = 0
    let todayDelta: number | null = null
    try {
      const ds = await getDayStats(propertyId, token)
      today = ds.today
      todayDelta = ds.todayDelta
    } catch { /* day stats are best-effort */ }

    let total = 0
    const pings: { lat: number; lng: number; users: number; city: string; country: string }[] = []
    for (const row of rows) {
      const city = row.dimensionValues?.[0]?.value || ''
      const country = row.dimensionValues?.[1]?.value || ''
      const users = parseInt(row.metricValues?.[0]?.value || '0', 10) || 0
      total += users
      const coords = geocode(city, country, `ga-${city}-${country}`)
      if (coords) pings.push({ lat: coords.lat, lng: coords.lng, users, city, country })
    }

    return NextResponse.json({ ok: true, configured: true, total, today, todayDelta, pings })
  } catch (err: any) {
    return NextResponse.json({ ok: false, configured: true, error: err.message, total: 0, today: 0, todayDelta: null, pings: [] }, { status: 200 })
  }
}
