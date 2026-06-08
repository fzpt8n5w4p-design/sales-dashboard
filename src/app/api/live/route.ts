import { NextResponse } from 'next/server'
import { startOfDay } from 'date-fns'
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
    const since = startOfDay(new Date())
    const sinceISO = encodeURIComponent(since.toISOString())

    const pings: Ping[] = []
    let totalRevenue = 0
    let totalOrders = 0
    const channelMap: Record<string, { orders: number; revenue: number }> = {}
    const locationMap: Record<string, number> = {}
    const productMap: Record<string, number> = {}

    // 30 pages × 100 = 3000 order/day capacity — far above real daily volume.
    await veeqoStreamPages(
      `/orders?created_at_min=${sinceISO}`,
      page => {
        for (const o of page) {
          const id = String(o.id ?? `${o.number ?? ''}-${o.created_at ?? ''}`)
          const value = parseFloat(o.total_price || 0) || 0
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
            productMap[name] = (productMap[name] || 0) + (li.quantity || 1)
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
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 8)

    return NextResponse.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      warehouse: warehouseCoords(),
      pings: trimmed,
      stats: { totalRevenue, totalOrders, byChannel, topLocations, topProducts },
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
