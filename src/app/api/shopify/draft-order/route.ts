import { NextRequest, NextResponse } from 'next/server'
import { shopifyFetch } from '../lib'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { customerId, lineItems } = await req.json() as {
      customerId: number
      lineItems: Array<{ variantId: number; quantity: number }>
    }

    if (!customerId) {
      return NextResponse.json({ ok: false, error: 'No customer selected' }, { status: 400 })
    }
    if (!lineItems || lineItems.length === 0) {
      return NextResponse.json({ ok: false, error: 'No line items provided' }, { status: 400 })
    }

    const draftOrder = {
      draft_order: {
        customer: { id: customerId },
        line_items: lineItems.map(li => ({
          variant_id: li.variantId,
          quantity: li.quantity,
        })),
        use_customer_default_address: true,
      },
    }

    const store = process.env.SHOPIFY_B2B_STORE
    const token = process.env.SHOPIFY_B2B_TOKEN
    if (!store || !token) {
      return NextResponse.json({ ok: false, error: 'Shopify credentials not configured' }, { status: 500 })
    }

    const res = await fetch(`https://${store}/admin/api/2024-01/draft_orders.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify(draftOrder),
    })

    const data = await res.json()

    if (!res.ok) {
      const errorMsg = data.errors
        ? typeof data.errors === 'string' ? data.errors : JSON.stringify(data.errors)
        : 'Failed to create draft order'
      return NextResponse.json({ ok: false, error: errorMsg }, { status: res.status })
    }

    const created = data.draft_order
    const adminUrl = `https://${store}/admin/draft_orders/${created.id}`

    return NextResponse.json({
      ok: true,
      draftOrder: {
        id: created.id,
        name: created.name,
        total: parseFloat(created.total_price || '0'),
        status: created.status,
        adminUrl,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
