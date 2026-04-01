import { NextResponse } from 'next/server'
import { shopifyFetchAll } from '../lib'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const checkouts = await shopifyFetchAll('/checkouts.json', 'checkouts')

    // Filter to only abandoned (not completed)
    const abandoned = checkouts
      .filter((c: any) => !c.completed_at)
      .map((c: any) => ({
        id: c.id,
        email: c.email || 'Unknown',
        customer: c.customer
          ? `${c.customer.first_name || ''} ${c.customer.last_name || ''}`.trim() || c.email
          : c.email || 'Unknown',
        company: c.billing_address?.company || c.shipping_address?.company || '',
        total: parseFloat(c.total_price || '0'),
        currency: c.currency || 'GBP',
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        itemCount: (c.line_items || []).reduce((s: number, li: any) => s + (li.quantity || 0), 0),
        items: (c.line_items || []).map((li: any) => ({
          title: li.title || 'Unknown',
          variant: li.variant_title || '',
          quantity: li.quantity || 0,
          price: parseFloat(li.price || '0'),
        })),
        recoveryUrl: c.abandoned_checkout_url || null,
      }))
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const totalValue = abandoned.reduce((s: number, c: any) => s + c.total, 0)

    return NextResponse.json({
      ok: true,
      checkouts: abandoned,
      totalAbandoned: abandoned.length,
      totalValue,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
