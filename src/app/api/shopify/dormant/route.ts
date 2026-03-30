import { NextRequest, NextResponse } from 'next/server'
import { shopifyFetchAll } from '../lib'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const threshold = parseInt(searchParams.get('days') || '30')

  try {
    const customers = await shopifyFetchAll('/customers.json', 'customers')
    const now = new Date()
    const cutoff = new Date(now.getTime() - threshold * 24 * 60 * 60 * 1000)

    const dormant = customers
      .filter((c: any) => {
        if (!c.orders_count || c.orders_count === 0) return false // skip never-ordered
        const lastOrder = c.last_order_name ? new Date(c.updated_at) : null
        return lastOrder && lastOrder < cutoff
      })
      .map((c: any) => {
        const lastOrderDate = c.updated_at
        const daysSince = Math.floor((now.getTime() - new Date(lastOrderDate).getTime()) / (1000 * 60 * 60 * 24))
        return {
          id: c.id,
          name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || 'Unknown',
          email: c.email || '',
          company: c.default_address?.company || '',
          ordersCount: c.orders_count || 0,
          totalSpent: parseFloat(c.total_spent || '0'),
          lastOrderDate,
          daysSince,
        }
      })
      .sort((a: any, b: any) => b.daysSince - a.daysSince)

    return NextResponse.json({ ok: true, dormant, total: dormant.length, threshold })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
