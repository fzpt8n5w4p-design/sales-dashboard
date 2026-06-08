import { NextResponse } from 'next/server'
import { startOfDay, subDays } from 'date-fns'
import { veeqoStreamPages } from '../veeqo/lib'
import { geocode } from './geo'

export const dynamic = 'force-dynamic'

// Live-view feed: today's orders across every channel (Veeqo aggregates them),
// each geocoded to a globe ping, plus headline stats. Today-only keeps memory
// tiny (~200 orders/day) so this stays well under Render's 512MB.

const MAX_PINGS = 300

// Arc destination on the globe — the Wirral warehouse. Override per deployment
// via WAREHOUSE_LAT / WAREHOUSE_LNG if the exact site differs.
function warehouseCoords() {
  const lat = parseFloat(process.env.WAREHOUSE_LAT || '')
  const lng = parseFloat(process.env.WAREHOUSE_LNG || '')
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
  return { lat: 53.3727, lng: -3.0738 } // Wirral, Merseyside, UK
}

type Ping = {
  id: string
  lat: number
  lng: number
  channel: string
  value: number
  city: string
  country: string
  product: string
  createdAt: string
}

export async function GET() {
  try {
    const now = new Date()
    const since = startOfDay(now)              // today 00:00
    const yStart = subDays(since, 1)           // yesterday 00:00
    const sinceMs = since.getTime()
    const yStartMs = yStart.getTime()
    // Yesterday up to the same clock time as now — apples-to-apples baseline.
    const ySameTimeCut = yStartMs + (now.getTime() - sinceMs)
    const sinceISO = encodeURIComponent(yStart.toISOString())

    const pings: Ping[] = []
    let totalRevenue = 0
    let totalOrders = 0
    let prevRevenue = 0 // yesterday, to the same time of day
    let prevOrders = 0
    const channelMap: Record<string, { orders: number; revenue: number }> = {}
    const locationMap: Record<string, number> = {}
    const productMap: Record<string, { qty: number; image: string }> = {}

    // Stream from yesterday 00:00: today's orders feed the globe + stats; the
    // prior day (to the same time) feeds the day-over-day comparison.
    // 30 pages × 100 = 3000 capacity — far above ~2 days of real volume.
    await veeqoStreamPages(
      `/orders?created_at_min=${sinceISO}`,
      page => {
        for (const o of page) {
          const value = parseFloat(o.total_price || 0) || 0
          const t = new Date(o.created_at).getTime()
          if (t < sinceMs) {
            if (t >= yStartMs && t <= ySameTimeCut) { prevOrders++; prevRevenue += value }
            continue
          }
          const id = String(o.id ?? `${o.number ?? ''}-${o.created_at ?? ''}`)
          const channel = o.channel?.name || 'Unknown'
          const createdAt = o.created_at || since.toISOString()

          totalOrders++
          totalRevenue += value
          if (!channelMap[channel]) channelMap[channel] = { orders: 0, revenue: 0 }
          channelMap[channel].orders++
          channelMap[channel].revenue += value

          // Veeqo's delivery address lives on deliver_to; guard alternatives.
          const addr = o.deliver_to || o.delivery_address || o.shipping_address || {}
          const city = addr.city || ''
          const country = addr.country || ''
          if (city || country) {
            const label = [city, country].filter(Boolean).join(', ')
            locationMap[label] = (locationMap[label] || 0) + 1
          }

          const items = Array.isArray(o.line_items) ? o.line_items : []
          const first = items[0]?.sellable || {}
          const product = first.product_title || first.title || first.sku_code || ''
          for (const li of items) {
            const s = li.sellable || {}
            const name = s.product_title || s.title || s.sku_code || 'Unknown'
            const img = s.image_url || s.main_thumbnail_url || ''
            if (!productMap[name]) productMap[name] = { qty: 0, image: img }
            productMap[name].qty += li.quantity || 1
            if (!productMap[name].image && img) productMap[name].image = img
          }

          const coords = geocode(city, country, id)
          if (coords) {
            pings.push({
              id, lat: coords.lat, lng: coords.lng, channel, value,
              city, country, product, createdAt,
            })
          }
        }
      },
      30
    )

    // Keep the most recent pings for a smooth globe; sort newest-first.
    pings.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    const trimmed = pings.slice(0, MAX_PINGS)

    const byChannel = Object.entries(channelMap)
      .map(([name, d]) => ({ name, orders: d.orders, revenue: d.revenue }))
      .sort((a, b) => b.revenue - a.revenue)
    const topLocations = Object.entries(locationMap)
      .map(([label, orders]) => ({ label, orders }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 8)
    const topProducts = Object.entries(productMap)
      .map(([name, d]) => ({ name, qty: d.qty, image: d.image }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 8)

    return NextResponse.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      warehouse: warehouseCoords(),
      pings: trimmed,
      stats: { totalRevenue, totalOrders, prevRevenue, prevOrders, byChannel, topLocations, topProducts },
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
