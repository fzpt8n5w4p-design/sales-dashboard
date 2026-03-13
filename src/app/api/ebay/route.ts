import { NextRequest, NextResponse } from 'next/server'
import { subDays, startOfDay, endOfDay } from 'date-fns'

export async function GET(req: NextRequest) {
  const token = process.env.EBAY_TOKEN
  if (!token) return NextResponse.json({ ok: false, error: 'EBAY_TOKEN not set' }, { status: 500 })

  const { searchParams } = req.nextUrl
  const range = searchParams.get('range') || 'today'
  const isSandbox = process.env.EBAY_ENV === 'sandbox'
  const base = isSandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com'

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB'
  }

  const now = new Date()
  let since: Date, until: Date
  switch (range) {
    case 'yesterday': since = startOfDay(subDays(now,1)); until = endOfDay(subDays(now,1)); break
    case '7days':     since = startOfDay(subDays(now,7)); until = endOfDay(now); break
    case '30days':    since = startOfDay(subDays(now,30)); until = endOfDay(now); break
    default:          since = startOfDay(now); until = endOfDay(now)
  }

  try {
    const [ordersRes, analyticsRes] = await Promise.all([
      fetch(
        `${base}/sell/fulfillment/v1/order?filter=creationdate:[${since.toISOString()}..${until.toISOString()}]&limit=200`,
        { headers, next: { revalidate: 0 } }
      ),
      fetch(`${base}/sell/analytics/v1/seller_standards_profile`, { headers, next: { revalidate: 0 } })
    ])

    if (!ordersRes.ok) throw new Error(`eBay orders ${ordersRes.status}`)
    const ordersData = await ordersRes.json()
    const orders = ordersData.orders || []

    let revenue = 0
    let returns = 0
    orders.forEach((o: any) => {
      revenue += parseFloat(o.pricingSummary?.total?.value || 0)
      if (o.cancelStatus?.cancelState === 'CANCEL_REQUESTED' || o.orderFulfillmentStatus === 'NOT_STARTED') returns++
    })

    const hourly: Record<number, number> = {}
    orders.forEach((o: any) => {
      const h = new Date(o.creationDate).getHours()
      hourly[h] = (hourly[h] || 0) + 1
    })

    let rating = 99.1
    if (analyticsRes.ok) {
      const analyticsData = await analyticsRes.json()
      const defectRate = analyticsData?.standardsProfiles?.[0]?.metrics?.find(
        (m: any) => m.name === 'TRANSACTION_DEFECT_RATE'
      )
      if (defectRate) rating = parseFloat((100 - parseFloat(defectRate.value || 0)).toFixed(1))
    }

    return NextResponse.json({
      ok: true,
      orders: { total: orders.length, revenue, hourly },
      returns: { returns, cancelled: returns },
      rating: { score: rating, reviews: orders.length }
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
