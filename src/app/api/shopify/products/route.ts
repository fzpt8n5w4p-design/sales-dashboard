import { NextResponse } from 'next/server'
import { shopifyFetchAll } from '../lib'

export const dynamic = 'force-dynamic'

let productCache: { data: any; fetchedAt: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

export async function GET() {
  try {
    if (productCache && Date.now() - productCache.fetchedAt < CACHE_TTL) {
      return NextResponse.json(productCache.data)
    }

    const products = await shopifyFetchAll('/products.json', 'products')

    const mapped = products.map((p: any) => {
      const variants = (p.variants || []).map((v: any) => ({
        id: v.id,
        title: v.title,
        sku: v.sku || '',
        barcode: v.barcode || '',
        price: parseFloat(v.price || '0'),
        compareAtPrice: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
        inventoryQuantity: v.inventory_quantity ?? 0,
      }))
      const totalStock = variants.reduce((s: number, v: any) => s + v.inventoryQuantity, 0)
      const stockValue = variants.reduce((s: number, v: any) => s + v.price * Math.max(0, v.inventoryQuantity), 0)
      return {
        id: p.id,
        title: p.title,
        vendor: p.vendor || '',
        productType: p.product_type || '',
        status: p.status,
        variants,
        totalStock,
        stockValue,
        image: p.image?.src || p.images?.[0]?.src || null,
        createdAt: p.created_at,
      }
    })

    const outOfStock = mapped.filter((p: any) => p.totalStock <= 0).length
    const lowStock = mapped.filter((p: any) => p.totalStock > 0 && p.totalStock <= 10).length
    const totalStockUnits = mapped.reduce((s: number, p: any) => s + p.totalStock, 0)
    const totalStockValue = mapped.reduce((s: number, p: any) => s + p.stockValue, 0)

    const result = {
      ok: true,
      products: mapped,
      summary: {
        totalProducts: mapped.length,
        totalVariants: mapped.reduce((s: number, p: any) => s + p.variants.length, 0),
        outOfStock,
        lowStock,
        totalStockUnits,
        totalStockValue,
      },
    }

    productCache = { data: result, fetchedAt: Date.now() }
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
