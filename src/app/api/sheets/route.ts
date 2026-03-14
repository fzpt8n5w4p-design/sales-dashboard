import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY
  const sheetId = process.env.GOOGLE_SHEETS_ID
  const range = process.env.GOOGLE_SHEETS_RANGE || 'Targets!A1:D20'

  if (!apiKey || !sheetId) {
    return NextResponse.json({ ok: false, error: 'GOOGLE_SHEETS_API_KEY or GOOGLE_SHEETS_ID not set' }, { status: 500 })
  }

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error?.message || 'Sheets API error ' + res.status)
    }

    const data = await res.json()
    const rows: string[][] = data.values || []

    // Skip header row (row 0), parse: Metric | Target | Actual | Unit
    const metrics: { metric: string; target: number; actual: number; unit: string; pct: number }[] = []
    rows.slice(1).forEach(row => {
      if (!row[0]) return
      const target = parseFloat(row[1] || '0')
      const actual = parseFloat(row[2] || '0')
      metrics.push({
        metric: row[0],
        target,
        actual,
        unit: row[3] || '',
        pct: target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0
      })
    })

    return NextResponse.json({ ok: true, metrics, range, lastSync: new Date().toISOString() })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
