import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

const BARCODE_HEADERS = ['barcode', 'ean', 'upc', 'code', 'bar code', 'ean13', 'ean-13', 'gtin', 'product code', 'item code']
const QTY_HEADERS = ['order here', 'order qty', 'order quantity', 'qty', 'quantity', 'units', 'amount', 'required', 'req']

function detectColumn(headers: string[], candidates: string[]): number {
  const lower = headers.map(h => h.toLowerCase().trim())
  // Exact match first
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate)
    if (idx !== -1) return idx
  }
  // Partial match
  for (const candidate of candidates) {
    const idx = lower.findIndex(h => h.includes(candidate))
    if (idx !== -1) return idx
  }
  return -1
}

function parseWorkbook(wb: XLSX.WorkBook, manualBarcodeCol?: number, manualQtyCol?: number): {
  items: Array<{ barcode: string; qty: number }>
  columns: string[]
  headerRow: number
  allRows: string[][]
  sheetName: string
} {
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  if (data.length < 2) {
    return { items: [], columns: [], headerRow: 0, allRows: [], sheetName }
  }

  // If manual columns specified, use them with the detected header row
  if (manualBarcodeCol !== undefined && manualQtyCol !== undefined) {
    // Find header row by scanning first 20 rows
    let headerRowIdx = 0
    for (let r = 0; r < Math.min(20, data.length); r++) {
      const row = data[r].map((c: any) => String(c || '').toLowerCase().trim())
      if (row.some(c => BARCODE_HEADERS.some(bh => c.includes(bh)) || QTY_HEADERS.some(qh => c.includes(qh)))) {
        headerRowIdx = r
        break
      }
    }

    const headers = data[headerRowIdx].map((h: any) => String(h || ''))
    const items: Array<{ barcode: string; qty: number }> = []
    for (let i = headerRowIdx + 1; i < data.length; i++) {
      const row = data[i]
      const barcode = String(row[manualBarcodeCol] || '').trim()
      const qty = parseInt(String(row[manualQtyCol] || '0')) || 0
      if (barcode && qty > 0) {
        items.push({ barcode, qty })
      }
    }
    return { items, columns: headers, headerRow: headerRowIdx, allRows: data.slice(0, 20).map(r => r.map((c: any) => String(c || ''))), sheetName }
  }

  // Auto-detect: scan first 20 rows to find the header row
  for (let r = 0; r < Math.min(20, data.length); r++) {
    const row = data[r].map((h: any) => String(h || ''))
    const barcodeCol = detectColumn(row, BARCODE_HEADERS)
    const qtyCol = detectColumn(row, QTY_HEADERS)

    if (barcodeCol !== -1 && qtyCol !== -1) {
      // Found header row at index r
      const items: Array<{ barcode: string; qty: number }> = []
      for (let i = r + 1; i < data.length; i++) {
        const dataRow = data[i]
        const barcode = String(dataRow[barcodeCol] || '').trim()
        const qty = parseInt(String(dataRow[qtyCol] || '0')) || 0
        if (barcode && qty > 0) {
          items.push({ barcode, qty })
        }
      }
      return { items, columns: row, headerRow: r, allRows: data.slice(0, 20).map(r => r.map((c: any) => String(c || ''))), sheetName }
    }
  }

  // Could not auto-detect — return first 20 rows and all column headers from each row so UI can show a picker
  const allRows = data.slice(0, 20).map(r => r.map((c: any) => String(c || '')))
  // Find the row with the most non-empty cells as the likely header
  let bestRow = 0
  let bestCount = 0
  for (let r = 0; r < Math.min(15, data.length); r++) {
    const count = data[r].filter((c: any) => String(c || '').trim()).length
    if (count > bestCount) { bestCount = count; bestRow = r }
  }
  const columns = data[bestRow].map((h: any) => String(h || ''))

  return { items: [], columns, headerRow: bestRow, allRows, sheetName }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      const manualBarcodeCol = formData.get('barcodeCol') ? parseInt(formData.get('barcodeCol') as string) : undefined
      const manualQtyCol = formData.get('qtyCol') ? parseInt(formData.get('qtyCol') as string) : undefined

      if (!file) {
        return NextResponse.json({ ok: false, error: 'No file provided' }, { status: 400 })
      }

      const buffer = Buffer.from(await file.arrayBuffer())
      const wb = XLSX.read(buffer, { type: 'buffer' })
      const result = parseWorkbook(wb, manualBarcodeCol, manualQtyCol)

      if (result.items.length === 0) {
        return NextResponse.json({
          ok: false,
          error: 'Could not auto-detect barcode and quantity columns. Please select them manually.',
          columns: result.columns,
          headerRow: result.headerRow,
          allRows: result.allRows,
          needsColumnSelection: true,
        })
      }

      return NextResponse.json({ ok: true, ...result })
    }

    // JSON body — Google Sheets URL or manual column selection
    const body = await req.json()
    const url = body.url as string
    const manualBarcodeCol = body.barcodeCol as number | undefined
    const manualQtyCol = body.qtyCol as number | undefined

    if (!url) {
      return NextResponse.json({ ok: false, error: 'No URL provided' }, { status: 400 })
    }

    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
    if (!match) {
      return NextResponse.json({ ok: false, error: 'Invalid Google Sheets URL' }, { status: 400 })
    }

    const sheetId = match[1]
    const gidMatch = url.match(/gid=(\d+)/)
    const gid = gidMatch ? gidMatch[1] : '0'
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`

    const res = await fetch(csvUrl)
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: 'Failed to fetch Google Sheet. Make sure it is shared publicly or "Anyone with the link".' }, { status: 400 })
    }

    const csvText = await res.text()
    const wb = XLSX.read(csvText, { type: 'string' })
    const result = parseWorkbook(wb, manualBarcodeCol, manualQtyCol)

    if (result.items.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'Could not auto-detect barcode and quantity columns. Please select them manually.',
        columns: result.columns,
        headerRow: result.headerRow,
        allRows: result.allRows,
        needsColumnSelection: true,
      })
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
