import { NextRequest, NextResponse } from 'next/server'
import { shopifyFetchAll } from '../lib'

export const dynamic = 'force-dynamic'

// Cache products for 10 minutes to avoid re-fetching on every match request
let productCache: { data: any[]; fetchedAt: number } | null = null
const CACHE_TTL = 10 * 60 * 1000

async function getProducts() {
  if (productCache && Date.now() - productCache.fetchedAt < CACHE_TTL) {
    return productCache.data
  }
  const products = await shopifyFetchAll('/products.json', 'products')
  productCache = { data: products, fetchedAt: Date.now() }
  return products
}

export async function POST(req: NextRequest) {
  try {
    const { items } = await req.json() as { items: Array<{ barcode: string; qty: number }> }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ ok: false, error: 'No items provided' }, { status: 400 })
    }

    const products = await getProducts()

    // Build lookup maps: barcode → variant, sku → variant
    const barcodeMap: Record<string, { variantId: number; variantTitle: string; productTitle: string; productId: number; sku: string; barcode: string; price: number; image: string | null; stock: number }> = {}
    const skuMap: Record<string, typeof barcodeMap[string]> = {}

    for (const product of products) {
      const image = product.image?.src || product.images?.[0]?.src || null
      for (const variant of (product.variants || [])) {
        const entry = {
          variantId: variant.id,
          variantTitle: variant.title === 'Default Title' ? '' : variant.title || '',
          productTitle: product.title || 'Unknown',
          productId: product.id,
          sku: variant.sku || '',
          barcode: variant.barcode || '',
          price: parseFloat(variant.price || '0'),
          image,
          stock: variant.inventory_quantity || 0,
        }

        if (variant.barcode) {
          barcodeMap[variant.barcode.trim()] = entry
        }
        if (variant.sku) {
          skuMap[variant.sku.trim().toLowerCase()] = entry
        }
      }
    }

    // Match items
    const matched: Array<{
      barcode: string
      qty: number
      variantId: number
      variantTitle: string
      productTitle: string
      productId: number
      sku: string
      price: number
      image: string | null
      stock: number
      lineTotal: number
      matchedBy: 'barcode' | 'sku'
    }> = []

    const unmatched: Array<{ barcode: string; qty: number }> = []

    for (const item of items) {
      const bc = item.barcode.trim()
      const byBarcode = barcodeMap[bc]
      const bySku = skuMap[bc.toLowerCase()]

      if (byBarcode) {
        matched.push({
          ...byBarcode,
          barcode: bc,
          qty: item.qty,
          lineTotal: byBarcode.price * item.qty,
          matchedBy: 'barcode',
        })
      } else if (bySku) {
        matched.push({
          ...bySku,
          barcode: bc,
          qty: item.qty,
          lineTotal: bySku.price * item.qty,
          matchedBy: 'sku',
        })
      } else {
        unmatched.push({ barcode: bc, qty: item.qty })
      }
    }

    const totalValue = matched.reduce((s, m) => s + m.lineTotal, 0)
    const totalItems = matched.reduce((s, m) => s + m.qty, 0)

    return NextResponse.json({
      ok: true,
      matched,
      unmatched,
      summary: {
        totalMatched: matched.length,
        totalUnmatched: unmatched.length,
        totalItems,
        totalValue,
        matchRate: items.length > 0 ? Math.round((matched.length / items.length) * 100) : 0,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
