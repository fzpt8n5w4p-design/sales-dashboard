import { NextResponse } from 'next/server'
import { shopifyFetchAll } from '../lib'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const customers = await shopifyFetchAll('/customers.json', 'customers')

    const mapped = customers.map((c: any) => ({
      id: c.id,
      name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || 'Unknown',
      email: c.email || '',
      company: c.default_address?.company || '',
      ordersCount: c.orders_count || 0,
      totalSpent: parseFloat(c.total_spent || '0'),
      lastOrderDate: c.last_order_name ? c.updated_at : null,
      createdAt: c.created_at,
    }))

    // Sort by total spend descending
    mapped.sort((a: any, b: any) => b.totalSpent - a.totalSpent)

    const totalSpendAll = mapped.reduce((s: number, c: any) => s + c.totalSpent, 0)

    return NextResponse.json({
      ok: true,
      customers: mapped,
      totalCustomers: mapped.length,
      totalSpendAll,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
