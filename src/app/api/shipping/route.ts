import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const CALENDAR_URL = 'https://www.leda.com/__calendar/24327924313024364b357136614a75393044697077675a497373665375624d7336646d34365a4a324132776e7247616a6a6878586441422e4459732e.ics'

interface ShipmentEvent {
  type: 'departure' | 'arrival'
  summary: string
  container: string
  reference: string
  date: string
  daysAway: number
  destination: string
}

function parseICS(text: string): ShipmentEvent[] {
  const events: ShipmentEvent[] = []
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  const blocks = text.split('BEGIN:VEVENT')
  for (const block of blocks.slice(1)) {
    const get = (key: string) => {
      const match = block.match(new RegExp(`${key}[^:]*:(.+)`))
      return match ? match[1].trim() : ''
    }

    const summary = get('SUMMARY')
    const description = block.split('DESCRIPTION:')[1]?.split('END:VEVENT')[0] || ''

    // Parse date from DTSTART
    const dtMatch = block.match(/DTSTART[^:]*:(\d{4})(\d{2})(\d{2})/)
    if (!dtMatch) continue
    const eventDate = new Date(parseInt(dtMatch[1]), parseInt(dtMatch[2]) - 1, parseInt(dtMatch[3]))

    // Extract fields from description (handles folded lines)
    const descClean = description.replace(/\r?\n /g, '')
    const refMatch = descClean.match(/Our Reference:\s*([^\n\\]+)/)
    const containerMatch = descClean.match(/Container:\s*([^\n\\]+)/)

    const reference = refMatch ? refMatch[1].trim() : ''
    const container = containerMatch ? containerMatch[1].trim() : ''
    const isDeparture = summary.toLowerCase().includes('departing') || summary.toLowerCase().includes('dep')
    const type = isDeparture ? 'departure' : 'arrival'

    // Extract destination code from summary (last word-like token)
    const summaryParts = summary.trim().split(/\s+/)
    const destination = summaryParts[summaryParts.length - 1] || ''

    const diffMs = eventDate.getTime() - now.getTime()
    const daysAway = Math.round(diffMs / (1000 * 60 * 60 * 24))

    events.push({
      type,
      summary,
      container,
      reference,
      date: eventDate.toISOString().split('T')[0],
      daysAway,
      destination,
    })
  }

  // Sort by date
  events.sort((a, b) => a.date.localeCompare(b.date))
  return events
}

let cache: { data: any; fetchedAt: number } | null = null
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

export async function GET() {
  try {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
      return NextResponse.json(cache.data)
    }

    const res = await fetch(CALENDAR_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Calendar fetch failed: ${res.status}`)
    const text = await res.text()

    const events = parseICS(text)
    const upcoming = events.filter(e => e.daysAway >= 0)
    const past = events.filter(e => e.daysAway < 0)
    const nextArrival = upcoming.find(e => e.type === 'arrival')

    const result = { ok: true, events, upcoming, past, nextArrival, total: events.length }
    cache = { data: result, fetchedAt: Date.now() }

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
