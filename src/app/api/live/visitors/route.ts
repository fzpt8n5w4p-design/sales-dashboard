import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'
import { geocode } from '../geo'

export const dynamic = 'force-dynamic'

// Live storefront visitors from the GA4 Realtime API (active users in the last
// ~30 min), broken down by city so they can ping the globe. Covers the Shopify
// storefront(s) only — marketplaces (Amazon/eBay) expose no visitor data.
//
// Config (Render env): GA4_PROPERTY_ID (numeric) + GA4_SERVICE_ACCOUNT_JSON
// (the service-account key JSON, pasted whole). Unconfigured → graceful no-op so
// the page still works without it.

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'

// Cache the auth client across requests so we don't re-sign a JWT every poll.
let authClient: GoogleAuth | null = null
function getAuth(): GoogleAuth | null {
  const raw = process.env.GA4_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  if (authClient) return authClient
  const creds = JSON.parse(raw)
  // Env vars often store the private key with escaped newlines; restore them.
  if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, '\n')
  authClient = new GoogleAuth({ credentials: creds, scopes: [SCOPE] })
  return authClient
}

export async function GET() {
  // ridecore.pro GA4 property; override per deployment via GA4_PROPERTY_ID.
  const propertyId = process.env.GA4_PROPERTY_ID || '328365624'
  const auth = getAuth()
  if (!propertyId || !auth) {
    return NextResponse.json({ ok: true, configured: false, total: 0, pings: [] })
  }

  try {
    const client = await auth.getClient()
    const token = (await client.getAccessToken()).token
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

    return NextResponse.json({ ok: true, configured: true, total, pings })
  } catch (err: any) {
    return NextResponse.json({ ok: false, configured: true, error: err.message, total: 0, pings: [] }, { status: 200 })
  }
}
