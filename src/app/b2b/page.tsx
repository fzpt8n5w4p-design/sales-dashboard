'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Nav from '../components/Nav'

/* ---------- design tokens ---------- */
const t = {
  bg: '#000000',
  card: 'rgba(28, 28, 30, 0.8)',
  cardBorder: 'rgba(255, 255, 255, 0.06)',
  text1: '#f5f5f7',
  text2: 'rgba(255, 255, 255, 0.55)',
  text3: 'rgba(255, 255, 255, 0.3)',
  separator: 'rgba(255, 255, 255, 0.06)',
  blue: '#0A84FF',
  green: '#30D158',
  red: '#FF453A',
  orange: '#FF9F0A',
  purple: '#BF5AF2',
  teal: '#64D2FF',
  radius: 16,
  radiusSm: 10,
}

const font = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif"

const currency = typeof window !== 'undefined' ? '£' : '£'

function fmt(n: number, decimals = 0) {
  return n.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/* ---------- types ---------- */
type Tab = 'orders' | 'customers' | 'products'
type Range = 'today' | 'yesterday' | '7days' | '30days'

interface OrdersData {
  orders: { total: number; revenue: number; hourly: Record<number, number>; totalUnits: number }
  prevOrders: { total: number; revenue: number }
  topByQty: { name: string; sku: string; qty: number; revenue: number }[]
  topByRevenue: { name: string; sku: string; qty: number; revenue: number }[]
  recentOrders: { id: number; name: string; customer: string; company: string; total: number; date: string; status: string; itemCount: number }[]
}

interface Customer {
  id: number; name: string; email: string; company: string; ordersCount: number; totalSpent: number; lastOrderDate: string | null; createdAt: string
}

interface CustomersData {
  customers: Customer[]
  totalCustomers: number
  totalSpendAll: number
}

interface ProductVariant {
  id: number; title: string; sku: string; price: number; compareAtPrice: number | null; inventoryQuantity: number
}

interface Product {
  id: number; title: string; vendor: string; productType: string; status: string; variants: ProductVariant[]; totalStock: number; image: string | null; createdAt: string
}

interface ProductsData {
  products: Product[]
  summary: { totalProducts: number; totalVariants: number; outOfStock: number; lowStock: number; totalStockUnits: number }
}

/* ---------- sub-components ---------- */
function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div style={{
      flex: '1 1 0', minWidth: 140, padding: '20px 24px',
      background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius,
      backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
    }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: t.text2, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: t.text3, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function ChangeIndicator({ current, previous }: { current: number; previous: number }) {
  if (!previous) return null
  const pct = ((current - previous) / previous * 100)
  const up = pct >= 0
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: up ? t.green : t.red }}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% vs previous
    </span>
  )
}

function Shimmer({ height = 50 }: { height?: number }) {
  return <div className="shimmer" style={{ height, borderRadius: t.radiusSm }} />
}

/* ---------- main page ---------- */
export default function B2BPage() {
  const [tab, setTab] = useState<Tab>('orders')
  const [range, setRange] = useState<Range>('today')
  const [search, setSearch] = useState('')

  const [ordersData, setOrdersData] = useState<OrdersData | null>(null)
  const [customersData, setCustomersData] = useState<CustomersData | null>(null)
  const [productsData, setProductsData] = useState<ProductsData | null>(null)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [customersLoading, setCustomersLoading] = useState(false)
  const [productsLoading, setProductsLoading] = useState(false)

  // Fetch orders (depends on range)
  const fetchOrders = useCallback(() => {
    setOrdersLoading(true)
    fetch(`/api/shopify/orders?range=${range}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setOrdersData(d) })
      .catch(() => {})
      .finally(() => setOrdersLoading(false))
  }, [range])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // Fetch customers & products once on mount
  useEffect(() => {
    setCustomersLoading(true)
    fetch('/api/shopify/customers')
      .then(r => r.json())
      .then(d => { if (d.ok) setCustomersData(d) })
      .catch(() => {})
      .finally(() => setCustomersLoading(false))

    setProductsLoading(true)
    fetch('/api/shopify/products')
      .then(r => r.json())
      .then(d => { if (d.ok) setProductsData(d) })
      .catch(() => {})
      .finally(() => setProductsLoading(false))
  }, [])

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(fetchOrders, 60_000)
    return () => clearInterval(id)
  }, [fetchOrders])

  // Filtered customers
  const filteredCustomers = useMemo(() => {
    if (!customersData) return []
    if (!search.trim()) return customersData.customers
    const q = search.toLowerCase()
    return customersData.customers.filter(c =>
      c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.company.toLowerCase().includes(q)
    )
  }, [customersData, search])

  // Filtered products
  const filteredProducts = useMemo(() => {
    if (!productsData) return []
    if (!search.trim()) return productsData.products
    const q = search.toLowerCase()
    return productsData.products.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.vendor.toLowerCase().includes(q) ||
      p.variants.some(v => v.sku.toLowerCase().includes(q))
    )
  }, [productsData, search])

  /* ---------- range pills ---------- */
  const ranges: { key: Range; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7days', label: '7 Days' },
    { key: '30days', label: '30 Days' },
  ]

  /* ---------- tabs ---------- */
  const tabs: { key: Tab; label: string }[] = [
    { key: 'orders', label: 'Orders & Revenue' },
    { key: 'customers', label: 'Customers' },
    { key: 'products', label: 'Products' },
  ]

  const stockColor = (qty: number) => qty <= 0 ? t.red : qty <= 10 ? t.orange : t.green

  return (
    <div style={{ minHeight: '100vh', background: t.bg, fontFamily: font, color: t.text1 }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50, padding: '12px 20px',
        display: 'flex', alignItems: 'center', gap: 16,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${t.separator}`,
      }}>
        <Nav />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, background: t.purple,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: '#fff',
          }}>B</div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>B2B Wholesale</span>
          <span style={{ fontSize: 12, color: t.text3, marginLeft: 4 }}>b2b.ridecore.pro</span>
        </div>
        <div style={{ flex: 1 }} />
        {tab === 'orders' && (
          <div style={{ display: 'flex', gap: 4 }}>
            {ranges.map(r => (
              <button key={r.key} onClick={() => setRange(r.key)} style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: range === r.key ? 'rgba(255,255,255,0.12)' : 'transparent',
                color: range === r.key ? t.text1 : t.text2,
              }}>
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ padding: '16px 20px 0', display: 'flex', gap: 4 }}>
        {tabs.map(tb => (
          <button key={tb.key} onClick={() => { setTab(tb.key); setSearch('') }} style={{
            padding: '8px 18px', borderRadius: t.radiusSm, fontSize: 13, fontWeight: 600,
            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
            background: tab === tb.key ? 'rgba(255,255,255,0.1)' : 'transparent',
            color: tab === tb.key ? t.text1 : t.text3,
          }}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>

        {/* ============= ORDERS TAB ============= */}
        {tab === 'orders' && (
          <>
            {/* Stats row */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              {ordersLoading && !ordersData ? (
                <>
                  <div style={{ flex: '1 1 0', minWidth: 140 }}><Shimmer height={90} /></div>
                  <div style={{ flex: '1 1 0', minWidth: 140 }}><Shimmer height={90} /></div>
                  <div style={{ flex: '1 1 0', minWidth: 140 }}><Shimmer height={90} /></div>
                  <div style={{ flex: '1 1 0', minWidth: 140 }}><Shimmer height={90} /></div>
                </>
              ) : ordersData ? (
                <>
                  <StatCard label="Orders" value={fmt(ordersData.orders.total)} color={t.text1}
                    sub={ordersData.prevOrders.total ? `Previous: ${fmt(ordersData.prevOrders.total)}` : undefined} />
                  <StatCard label="Revenue" value={`${currency}${fmt(ordersData.orders.revenue, 2)}`} color={t.green}
                    sub={ordersData.prevOrders.revenue ? `Previous: ${currency}${fmt(ordersData.prevOrders.revenue, 2)}` : undefined} />
                  <StatCard label="Avg Order Value"
                    value={ordersData.orders.total ? `${currency}${fmt(ordersData.orders.revenue / ordersData.orders.total, 2)}` : '-'}
                    color={t.blue} />
                  <StatCard label="Units Sold" value={fmt(ordersData.orders.totalUnits)} color={t.teal} />
                </>
              ) : null}
            </div>

            {/* Change indicators */}
            {ordersData && ordersData.prevOrders.total > 0 && (
              <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
                <ChangeIndicator current={ordersData.orders.total} previous={ordersData.prevOrders.total} />
                <ChangeIndicator current={ordersData.orders.revenue} previous={ordersData.prevOrders.revenue} />
              </div>
            )}

            {/* Top products side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16, marginBottom: 20 }}>
              {/* Top by Qty */}
              <div style={{
                background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20,
                backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.text1, marginBottom: 12 }}>Top Products by Quantity</div>
                {ordersLoading && !ordersData ? <Shimmer height={200} /> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${t.separator}` }}>
                        <th style={{ textAlign: 'left', padding: '8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Product</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Qty</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ordersData?.topByQty || []).map((p, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${t.separator}` }}>
                          <td style={{ padding: '10px 0', fontSize: 13, color: t.text1, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                          <td style={{ padding: '10px 0', fontSize: 13, color: t.text1, textAlign: 'right', fontWeight: 600 }}>{p.qty}</td>
                          <td style={{ padding: '10px 0', fontSize: 13, color: t.green, textAlign: 'right', fontWeight: 600 }}>{currency}{fmt(p.revenue, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Top by Revenue */}
              <div style={{
                background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20,
                backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.text1, marginBottom: 12 }}>Top Products by Revenue</div>
                {ordersLoading && !ordersData ? <Shimmer height={200} /> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${t.separator}` }}>
                        <th style={{ textAlign: 'left', padding: '8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Product</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Revenue</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ordersData?.topByRevenue || []).map((p, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${t.separator}` }}>
                          <td style={{ padding: '10px 0', fontSize: 13, color: t.text1, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                          <td style={{ padding: '10px 0', fontSize: 13, color: t.green, textAlign: 'right', fontWeight: 600 }}>{currency}{fmt(p.revenue, 0)}</td>
                          <td style={{ padding: '10px 0', fontSize: 13, color: t.text1, textAlign: 'right' }}>{p.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Recent Orders */}
            <div style={{
              background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20,
              backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.text1, marginBottom: 12 }}>Recent Orders</div>
              {ordersLoading && !ordersData ? <Shimmer height={300} /> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${t.separator}` }}>
                        {['Order', 'Customer', 'Company', 'Items', 'Total', 'Status', 'Date'].map(h => (
                          <th key={h} style={{ textAlign: h === 'Total' || h === 'Items' ? 'right' : 'left', padding: '8px 8px 8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(ordersData?.recentOrders || []).map(o => (
                        <tr key={o.id} style={{ borderBottom: `1px solid ${t.separator}` }}>
                          <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.blue, fontWeight: 600 }}>{o.name}</td>
                          <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.text1 }}>{o.customer}</td>
                          <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.text2 }}>{o.company || '-'}</td>
                          <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.text1, textAlign: 'right' }}>{o.itemCount}</td>
                          <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.green, textAlign: 'right', fontWeight: 600 }}>{currency}{fmt(o.total, 2)}</td>
                          <td style={{ padding: '10px 8px 10px 0' }}>
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                              background: o.status === 'paid' ? 'rgba(48,209,88,0.15)' : 'rgba(255,159,10,0.15)',
                              color: o.status === 'paid' ? t.green : t.orange,
                            }}>{o.status}</span>
                          </td>
                          <td style={{ padding: '10px 0', fontSize: 12, color: t.text2 }}>
                            {new Date(o.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                      {ordersData && ordersData.recentOrders.length === 0 && (
                        <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: t.text3 }}>No orders in this period</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ============= CUSTOMERS TAB ============= */}
        {tab === 'customers' && (
          <>
            {/* Search */}
            <div style={{ marginBottom: 16 }}>
              <input
                type="text" placeholder="Search customers by name, email or company..."
                value={search} onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%', maxWidth: 400, padding: '10px 14px', borderRadius: t.radiusSm,
                  background: 'rgba(255,255,255,0.06)', border: `1px solid ${t.cardBorder}`,
                  color: t.text1, fontSize: 13, fontFamily: font, outline: 'none',
                }}
              />
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              {customersLoading && !customersData ? (
                <>
                  <div style={{ flex: '1 1 0', minWidth: 140 }}><Shimmer height={90} /></div>
                  <div style={{ flex: '1 1 0', minWidth: 140 }}><Shimmer height={90} /></div>
                </>
              ) : customersData ? (
                <>
                  <StatCard label="Total Customers" value={fmt(customersData.totalCustomers)} color={t.text1} />
                  <StatCard label="Total Spend (All Time)" value={`${currency}${fmt(customersData.totalSpendAll, 2)}`} color={t.green} />
                </>
              ) : null}
            </div>

            {/* Customer table */}
            <div style={{
              background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20,
              backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
            }}>
              {customersLoading && !customersData ? <Shimmer height={400} /> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${t.separator}` }}>
                        {['Name', 'Company', 'Email', 'Orders', 'Total Spent', 'Last Order'].map(h => (
                          <th key={h} style={{ textAlign: h === 'Orders' || h === 'Total Spent' ? 'right' : 'left', padding: '8px 8px 8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCustomers.map(c => (
                        <tr key={c.id} style={{ borderBottom: `1px solid ${t.separator}` }}>
                          <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.text1, fontWeight: 500 }}>{c.name}</td>
                          <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.text2 }}>{c.company || '-'}</td>
                          <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.text2 }}>{c.email}</td>
                          <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.text1, textAlign: 'right' }}>{c.ordersCount}</td>
                          <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.green, textAlign: 'right', fontWeight: 600 }}>{currency}{fmt(c.totalSpent, 2)}</td>
                          <td style={{ padding: '10px 0', fontSize: 12, color: t.text2 }}>
                            {c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                          </td>
                        </tr>
                      ))}
                      {filteredCustomers.length === 0 && (
                        <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: t.text3 }}>
                          {search ? 'No customers match your search' : 'No customers found'}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ============= PRODUCTS TAB ============= */}
        {tab === 'products' && (
          <>
            {/* Search */}
            <div style={{ marginBottom: 16 }}>
              <input
                type="text" placeholder="Search products by name, vendor or SKU..."
                value={search} onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%', maxWidth: 400, padding: '10px 14px', borderRadius: t.radiusSm,
                  background: 'rgba(255,255,255,0.06)', border: `1px solid ${t.cardBorder}`,
                  color: t.text1, fontSize: 13, fontFamily: font, outline: 'none',
                }}
              />
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              {productsLoading && !productsData ? (
                <>
                  <div style={{ flex: '1 1 0', minWidth: 140 }}><Shimmer height={90} /></div>
                  <div style={{ flex: '1 1 0', minWidth: 140 }}><Shimmer height={90} /></div>
                  <div style={{ flex: '1 1 0', minWidth: 140 }}><Shimmer height={90} /></div>
                  <div style={{ flex: '1 1 0', minWidth: 140 }}><Shimmer height={90} /></div>
                </>
              ) : productsData ? (
                <>
                  <StatCard label="Total Products" value={fmt(productsData.summary.totalProducts)} color={t.text1} />
                  <StatCard label="In Stock" value={fmt(productsData.summary.totalProducts - productsData.summary.outOfStock)} color={t.green} />
                  <StatCard label="Low Stock" value={fmt(productsData.summary.lowStock)} color={t.orange} />
                  <StatCard label="Out of Stock" value={fmt(productsData.summary.outOfStock)} color={t.red} />
                </>
              ) : null}
            </div>

            {/* Product table */}
            <div style={{
              background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20,
              backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
            }}>
              {productsLoading && !productsData ? <Shimmer height={400} /> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${t.separator}` }}>
                        {['Product', 'Type', 'SKU(s)', 'Price', 'Stock', 'Status'].map(h => (
                          <th key={h} style={{ textAlign: h === 'Price' || h === 'Stock' ? 'right' : 'left', padding: '8px 8px 8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map(p => {
                        const mainVariant = p.variants[0]
                        const skus = p.variants.map(v => v.sku).filter(Boolean).join(', ')
                        return (
                          <tr key={p.id} style={{ borderBottom: `1px solid ${t.separator}` }}>
                            <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.text1, fontWeight: 500, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.title}
                            </td>
                            <td style={{ padding: '10px 8px 10px 0', fontSize: 12, color: t.text2 }}>{p.productType || '-'}</td>
                            <td style={{ padding: '10px 8px 10px 0', fontSize: 12, color: t.text2, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skus || '-'}</td>
                            <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.text1, textAlign: 'right' }}>
                              {mainVariant ? `${currency}${fmt(mainVariant.price, 2)}` : '-'}
                            </td>
                            <td style={{ padding: '10px 8px 10px 0', fontSize: 13, textAlign: 'right', fontWeight: 600, color: stockColor(p.totalStock) }}>
                              {p.totalStock}
                            </td>
                            <td style={{ padding: '10px 0' }}>
                              <span style={{
                                fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                                background: p.status === 'active' ? 'rgba(48,209,88,0.15)' : 'rgba(255,255,255,0.06)',
                                color: p.status === 'active' ? t.green : t.text3,
                              }}>{p.status}</span>
                            </td>
                          </tr>
                        )
                      })}
                      {filteredProducts.length === 0 && (
                        <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: t.text3 }}>
                          {search ? 'No products match your search' : 'No products found'}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
