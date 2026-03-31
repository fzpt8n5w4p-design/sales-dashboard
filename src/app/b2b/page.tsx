'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
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
const SHOPIFY_ADMIN = 'https://admin.shopify.com/store/core-b2b'
const currency = '£'

function fmt(n: number, decimals = 0) {
  return n.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/* ---------- types ---------- */
type Tab = 'dashboard' | 'customers' | 'products'
type Range = 'today' | 'yesterday' | '7days' | '30days' | 'custom'

interface OrdersData {
  orders: { total: number; revenue: number; hourly: Record<number, number>; totalUnits: number }
  prevOrders: { total: number; revenue: number }
  yoyOrders: { total: number; revenue: number }
  topByQty: { name: string; sku: string; qty: number; revenue: number; productId: number | null }[]
  topByRevenue: { name: string; sku: string; qty: number; revenue: number; productId: number | null }[]
  recentOrders: { id: number; name: string; customer: string; company: string; total: number; date: string; status: string; itemCount: number }[]
}

interface Customer {
  id: number; name: string; email: string; company: string; ordersCount: number; totalSpent: number; spend30d: number; spendYTD: number; lastOrderDate: string | null; createdAt: string
}

interface CustomersData {
  customers: Customer[]
  totalCustomers: number
  totalSpendAll: number
  totalSpendYTD: number
  prevYTDRevenue: number
  totalRevenue30d: number
  activeCustomers30d: number
}

interface ProductVariant {
  id: number; title: string; sku: string; barcode: string; price: number; compareAtPrice: number | null; inventoryQuantity: number
}

interface Product {
  id: number; title: string; vendor: string; productType: string; status: string; variants: ProductVariant[]; totalStock: number; stockValue: number; image: string | null; createdAt: string
}

type ProductSort = 'title' | 'stock' | 'stockValue'
type SortDir = 'asc' | 'desc'

interface ProductsData {
  products: Product[]
  summary: { totalProducts: number; totalVariants: number; outOfStock: number; lowStock: number; totalStockUnits: number; totalStockValue: number }
}

interface DashboardTopProduct { name: string; sku: string; qty: number; revenue: number; productId: number | null }
interface DashboardTopCustomer { name: string; company: string; customerId: number | null; spend: number; yoySpend: number; orderCount: number; lastOrderDate: string }

type CustomerSort = 'name' | 'orders' | 'ytd' | 'allTime'
interface DashboardData { topProducts: DashboardTopProduct[]; topCustomers: DashboardTopCustomer[]; period: number }
interface DormantCustomer { id: number; name: string; email: string; company: string; ordersCount: number; totalSpent: number; lastOrderDate: string; daysSince: number }
interface DormantData { dormant: DormantCustomer[]; total: number; threshold: number }

interface DailyPoint { label: string; orders: number; units: number; revenue: number; prevOrders?: number; prevRevenue?: number }
interface OutstandingOrder { id: number; name: string; customer: string; company: string; customerId: number | null; total: number; status: string; date: string }
interface HistoryData {
  daily: DailyPoint[]
  newAccounts: { current: number; previous: number; yoy: number }
  outstanding: { orders: OutstandingOrder[]; total: number; count: number }
}

/* ---------- sub-components ---------- */
function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div style={{
      flex: '1 1 0', minWidth: 120, padding: '16px 18px',
      background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius,
      backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
    }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: t.text2, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: t.text3, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function ChangeIndicator({ label, current, previous }: { label: string; current: number; previous: number }) {
  if (!previous) return null
  const pct = ((current - previous) / previous * 100)
  const up = pct >= 0
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: up ? t.green : t.red }}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% {label}
    </span>
  )
}

function Shimmer({ height = 50 }: { height?: number }) {
  return <div className="shimmer" style={{ height, borderRadius: t.radiusSm }} />
}

function ShopifyLink({ href, children, style }: { href: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{
      color: t.blue, textDecoration: 'none', fontWeight: 600, cursor: 'pointer',
      ...style,
    }}>
      {children}
    </a>
  )
}

/* ---------- pill selector ---------- */
function PillSelect({ options, value, onChange }: { options: { key: string | number; label: string }[]; value: string | number; onChange: (v: any) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)} style={{
          padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
          border: 'none', cursor: 'pointer', transition: 'all 0.15s',
          background: value === o.key ? 'rgba(255,255,255,0.12)' : 'transparent',
          color: value === o.key ? t.text1 : t.text3,
        }}>{o.label}</button>
      ))}
    </div>
  )
}

/* ---------- main page ---------- */
export default function B2BPage() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [range, setRange] = useState<Range>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [search, setSearch] = useState('')
  const [productSort, setProductSort] = useState<ProductSort>('title')
  const [productSortDir, setProductSortDir] = useState<SortDir>('asc')
  const [productPage, setProductPage] = useState(0)
  const PRODUCTS_PER_PAGE = 200
  const [customerSort, setCustomerSort] = useState<CustomerSort>('allTime')
  const [customerSortDir, setCustomerSortDir] = useState<SortDir>('desc')

  const PIE_COLORS = [t.blue, t.green, t.purple, t.teal, t.orange, '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9']

  // Dashboard tile periods
  const [topProductDays, setTopProductDays] = useState(30)
  const [topCustomerDays, setTopCustomerDays] = useState(30)
  const [dormantDays, setDormantDays] = useState(30)
  const [chartDays, setChartDays] = useState(30)

  const [ordersData, setOrdersData] = useState<OrdersData | null>(null)
  const [customersData, setCustomersData] = useState<CustomersData | null>(null)
  const [productsData, setProductsData] = useState<ProductsData | null>(null)
  const [dashboardData, setDashboardData] = useState<{ products: DashboardData | null; customers: DashboardData | null }>({ products: null, customers: null })
  const [dormantData, setDormantData] = useState<DormantData | null>(null)
  const [historyData, setHistoryData] = useState<HistoryData | null>(null)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [customersLoading, setCustomersLoading] = useState(false)
  const [productsLoading, setProductsLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const anyLoading = ordersLoading || customersLoading || productsLoading || historyLoading || dashboardLoading

  // Fetch orders (depends on range)
  const fetchOrders = useCallback(() => {
    setOrdersLoading(true)
    const qs = range === 'custom' && customFrom && customTo
      ? `since=${customFrom}&until=${customTo}`
      : `range=${range}`
    fetch(`/api/shopify/orders?${qs}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setOrdersData(d) })
      .catch(() => {})
      .finally(() => setOrdersLoading(false))
  }, [range, customFrom, customTo])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // Fetch dashboard top products
  useEffect(() => {
    setDashboardLoading(true)
    fetch(`/api/shopify/dashboard?days=${topProductDays}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setDashboardData(prev => ({ ...prev, products: d })) })
      .catch(() => {})
      .finally(() => setDashboardLoading(false))
  }, [topProductDays])

  // Fetch dashboard top customers
  useEffect(() => {
    setDashboardLoading(true)
    fetch(`/api/shopify/dashboard?days=${topCustomerDays}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setDashboardData(prev => ({ ...prev, customers: d })) })
      .catch(() => {})
      .finally(() => setDashboardLoading(false))
  }, [topCustomerDays])

  // Fetch dormant customers
  useEffect(() => {
    setDashboardLoading(true)
    fetch(`/api/shopify/dormant?days=${dormantDays}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setDormantData(d) })
      .catch(() => {})
      .finally(() => setDashboardLoading(false))
  }, [dormantDays])

  // Fetch history (chart, new accounts, outstanding)
  useEffect(() => {
    setHistoryLoading(true)
    fetch(`/api/shopify/history?days=${chartDays}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setHistoryData(d) })
      .catch(() => {})
      .finally(() => setHistoryLoading(false))
  }, [chartDays])

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

  // Filtered + sorted customers
  const filteredCustomers = useMemo(() => {
    if (!customersData) return []
    let list = customersData.customers
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.company.toLowerCase().includes(q)
      )
    }
    const mult = customerSortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      let cmp = 0
      switch (customerSort) {
        case 'name': cmp = a.name.localeCompare(b.name); break
        case 'orders': cmp = a.ordersCount - b.ordersCount; break
        case 'ytd': cmp = a.spendYTD - b.spendYTD; break
        case 'allTime': cmp = a.totalSpent - b.totalSpent; break
      }
      return cmp !== 0 ? cmp * mult : a.name.localeCompare(b.name)
    })
  }, [customersData, search, customerSort, customerSortDir])

  const toggleCustomerSort = (col: CustomerSort) => {
    if (customerSort === col) setCustomerSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setCustomerSort(col); setCustomerSortDir(col === 'name' ? 'asc' : 'desc') }
  }

  const custSortIndicator = (col: CustomerSort) => customerSort === col ? (customerSortDir === 'asc' ? ' ▲' : ' ▼') : ''

  // Filtered products (search only)
  const filteredProductsBase = useMemo(() => {
    if (!productsData) return []
    if (!search.trim()) return productsData.products
    const q = search.toLowerCase()
    return productsData.products.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.vendor.toLowerCase().includes(q) ||
      p.variants.some(v => v.sku.toLowerCase().includes(q) || v.barcode.toLowerCase().includes(q))
    )
  }, [productsData, search])

  // Sorted products (separate memo so sort changes don't re-filter)
  const filteredProducts = useMemo(() => {
    const mult = productSortDir === 'asc' ? 1 : -1
    return [...filteredProductsBase].sort((a, b) => {
      let cmp = 0
      switch (productSort) {
        case 'stock': cmp = a.totalStock - b.totalStock; break
        case 'stockValue': cmp = a.stockValue - b.stockValue; break
        default: cmp = a.title.localeCompare(b.title); break
      }
      if (cmp !== 0) return cmp * mult
      // Tie-breaker: alphabetical by title
      return a.title.localeCompare(b.title)
    })
  }, [filteredProductsBase, productSort, productSortDir])

  const totalProductPages = Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE)
  const paginatedProducts = useMemo(() =>
    filteredProducts.slice(productPage * PRODUCTS_PER_PAGE, (productPage + 1) * PRODUCTS_PER_PAGE),
    [filteredProducts, productPage]
  )

  const toggleProductSort = (col: ProductSort) => {
    if (productSort === col) {
      setProductSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      const dir = col === 'title' ? 'asc' : 'desc'
      setProductSort(col)
      setProductSortDir(dir)
    }
    setProductPage(0)
  }

  // Reset page when search changes
  useEffect(() => { setProductPage(0) }, [search])

  const sortIndicator = (col: ProductSort) => productSort === col ? (productSortDir === 'asc' ? ' ▲' : ' ▼') : ''

  /* ---------- range pills ---------- */
  const ranges: { key: Range; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7days', label: '7 Days' },
    { key: '30days', label: '30 Days' },
    { key: 'custom', label: 'Custom' },
  ]

  /* ---------- tabs ---------- */
  const tabs: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: 'B2B Dashboard' },
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
        {anyLoading && (
          <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.1)', borderTopColor: t.blue, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
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
          {range === 'custom' && (
            <>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{
                padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(255,255,255,0.08)',
                border: `1px solid ${t.cardBorder}`, color: t.text1, fontFamily: font,
              }} />
              <span style={{ color: t.text3, fontSize: 11 }}>to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{
                padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(255,255,255,0.08)',
                border: `1px solid ${t.cardBorder}`, color: t.text1, fontFamily: font,
              }} />
            </>
          )}
        </div>
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

        {/* ============= B2B DASHBOARD TAB ============= */}
        {tab === 'dashboard' && (
          <>
            {/* Loading indicator */}
            {ordersLoading && ordersData && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div className="pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: t.blue }} />
                <span style={{ fontSize: 11, color: t.text3 }}>Updating...</span>
              </div>
            )}

            {/* 6-column stats row: Orders, Revenue, AOV, Units, New Accounts, Outstanding */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
              {ordersLoading && !ordersData ? (
                <>
                  {[...Array(6)].map((_, i) => <div key={i}><Shimmer height={90} /></div>)}
                </>
              ) : (
                <>
                  <StatCard label="Orders" value={ordersData ? fmt(ordersData.orders.total) : '-'} color={t.text1}
                    sub={ordersData?.prevOrders.total ? `Prev: ${fmt(ordersData.prevOrders.total)}` : undefined} />
                  <StatCard label="Revenue" value={ordersData ? `${currency}${fmt(ordersData.orders.revenue, 2)}` : '-'} color={t.green}
                    sub={ordersData?.prevOrders.revenue ? `Prev: ${currency}${fmt(ordersData.prevOrders.revenue, 0)}` : undefined} />
                  <StatCard label="Avg Order Value"
                    value={ordersData?.orders.total ? `${currency}${fmt(ordersData.orders.revenue / ordersData.orders.total, 2)}` : '-'}
                    color={t.blue} />
                  <StatCard label="Units Sold" value={ordersData ? fmt(ordersData.orders.totalUnits) : '-'} color={t.teal} />
                  <StatCard label="New Accounts (30d)" value={historyData ? String(historyData.newAccounts.current) : '-'} color={t.purple}
                    sub={historyData?.newAccounts.previous ? `Prev: ${historyData.newAccounts.previous}` : undefined} />
                  <StatCard label="Outstanding" value={historyData ? `${currency}${fmt(historyData.outstanding.total, 0)}` : '-'}
                    color={historyData && historyData.outstanding.total > 0 ? t.orange : t.green}
                    sub={historyData ? `${historyData.outstanding.count} unpaid` : undefined} />
                </>
              )}
            </div>

            {/* YoY Comparison Tiles */}
            {ordersData && (ordersData.prevOrders.total > 0 || (ordersData.yoyOrders && ordersData.yoyOrders.total > 0)) && (() => {
              const rangeLabel = range === 'today' ? 'Today' : range === 'yesterday' ? 'Yesterday' : range === '7days' ? '7 Days' : range === '30days' ? '30 Days' : 'Custom'
              const tiles: { label: string; current: number; previous: number; prefix?: string; period: string }[] = []
              if (ordersData.prevOrders.total > 0) {
                tiles.push({ label: 'Orders', current: ordersData.orders.total, previous: ordersData.prevOrders.total, period: `vs Previous ${rangeLabel}` })
                tiles.push({ label: 'Revenue', current: ordersData.orders.revenue, previous: ordersData.prevOrders.revenue, prefix: currency, period: `vs Previous ${rangeLabel}` })
              }
              if (ordersData.yoyOrders && ordersData.yoyOrders.total > 0) {
                tiles.push({ label: 'Orders', current: ordersData.orders.total, previous: ordersData.yoyOrders.total, period: `vs Last Year (${rangeLabel})` })
                tiles.push({ label: 'Revenue', current: ordersData.orders.revenue, previous: ordersData.yoyOrders.revenue, prefix: currency, period: `vs Last Year (${rangeLabel})` })
              }
              return (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tiles.length}, 1fr)`, gap: 12, marginBottom: 16 }}>
                  {tiles.map((tile, i) => {
                    const pct = tile.previous > 0 ? ((tile.current - tile.previous) / tile.previous * 100) : 0
                    const up = pct >= 0
                    return (
                      <div key={i} style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: '14px 16px', backdropFilter: 'blur(40px)' }}>
                        <div style={{ fontSize: 11, color: t.text3, marginBottom: 6 }}>{tile.label}</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 22, fontWeight: 700, color: up ? t.green : t.red }}>
                            {up ? '▲' : '▼'}{Math.abs(pct).toFixed(1)}%
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: t.text3, marginTop: 6 }}>
                          {tile.prefix || ''}{fmt(tile.current, tile.prefix ? 0 : undefined)} vs {tile.prefix || ''}{fmt(tile.previous, tile.prefix ? 0 : undefined)}
                        </div>
                        <div style={{ fontSize: 10, color: t.text3, marginTop: 2, opacity: 0.7 }}>{tile.period}</div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* Sales Chart — right below stats */}
            <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20, backdropFilter: 'blur(40px)', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.text1 }}>Sales Overview</div>
                <PillSelect options={[{ key: 7, label: '7d' }, { key: 14, label: '14d' }, { key: 30, label: '30d' }, { key: 60, label: '60d' }, { key: 90, label: '90d' }, { key: 180, label: '180d' }]} value={chartDays} onChange={setChartDays} />
              </div>
              {!historyData ? <Shimmer height={180} /> : !historyData.daily.length ? (
                <div style={{ fontSize: 13, color: t.text3 }}>No data</div>
              ) : (
                <>
                  <div style={{ width: '100%', height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={historyData.daily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="b2bOrdersFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={t.blue} stopOpacity={0.25} />
                            <stop offset="100%" stopColor={t.blue} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="b2bRevenueFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={t.green} stopOpacity={0.2} />
                            <stop offset="100%" stopColor={t.green} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(historyData.daily.length / 8))} />
                        <YAxis yAxisId="orders" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="revenue" orientation="right" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `${currency}${(v/1000).toFixed(0)}k` : `${currency}${v}`} />
                        <Tooltip content={({ active, payload, label }: any) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0]?.payload
                          if (!d) return null
                          const ordersPct = d.prevOrders > 0 ? ((d.orders - d.prevOrders) / d.prevOrders * 100) : null
                          const revPct = d.prevRevenue > 0 ? ((d.revenue - d.prevRevenue) / d.prevRevenue * 100) : null
                          return (
                            <div style={{ background: 'rgba(28,28,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                              <div style={{ color: t.text1, fontWeight: 600, marginBottom: 6 }}>{label}</div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: t.blue, marginBottom: 3 }}>
                                <span>Orders: {d.orders}</span>
                                {ordersPct !== null && <span style={{ color: ordersPct >= 0 ? t.green : t.red, fontWeight: 600 }}>{ordersPct >= 0 ? '▲' : '▼'}{Math.abs(ordersPct).toFixed(0)}%</span>}
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: t.green, marginBottom: 3 }}>
                                <span>Revenue: {currency}{fmt(d.revenue, 0)}</span>
                                {revPct !== null && <span style={{ color: revPct >= 0 ? t.green : t.red, fontWeight: 600 }}>{revPct >= 0 ? '▲' : '▼'}{Math.abs(revPct).toFixed(0)}%</span>}
                              </div>
                              <div style={{ color: t.red, marginBottom: 2, fontSize: 11 }}>Prev Orders: {d.prevOrders || 0}</div>
                              <div style={{ color: '#ffd60a', fontSize: 11 }}>Prev Revenue: {currency}{fmt(d.prevRevenue || 0, 0)}</div>
                            </div>
                          )
                        }} />
                        <Area yAxisId="orders" type="monotone" dataKey="prevOrders" stroke={t.red} strokeWidth={1.5} strokeDasharray="4 3" fill="none" dot={false} />
                        <Area yAxisId="revenue" type="monotone" dataKey="prevRevenue" stroke="#ffd60a" strokeWidth={1.5} strokeDasharray="4 3" fill="none" dot={false} />
                        <Area yAxisId="orders" type="monotone" dataKey="orders" stroke={t.blue} strokeWidth={2} fill="url(#b2bOrdersFill)" />
                        <Area yAxisId="revenue" type="monotone" dataKey="revenue" stroke={t.green} strokeWidth={2} fill="url(#b2bRevenueFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  {(() => {
                    const totalOrders = historyData.daily.reduce((s, d) => s + d.orders, 0)
                    const totalRevenue = historyData.daily.reduce((s, d) => s + d.revenue, 0)
                    const prevTotalOrders = historyData.daily.reduce((s, d) => s + (d.prevOrders || 0), 0)
                    const prevTotalRevenue = historyData.daily.reduce((s, d) => s + (d.prevRevenue || 0), 0)
                    const ordersPct = prevTotalOrders > 0 ? ((totalOrders - prevTotalOrders) / prevTotalOrders * 100) : null
                    const revenuePct = prevTotalRevenue > 0 ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue * 100) : null
                    return (
                      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 12, height: 3, borderRadius: 2, background: t.blue, display: 'inline-block' }} />
                          <span style={{ fontSize: 11, color: t.text3 }}>Orders</span>
                          {ordersPct !== null && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: ordersPct >= 0 ? t.green : t.red }}>
                              {ordersPct >= 0 ? '▲' : '▼'}{Math.abs(ordersPct).toFixed(0)}%
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 12, height: 3, borderRadius: 2, background: t.green, display: 'inline-block' }} />
                          <span style={{ fontSize: 11, color: t.text3 }}>Revenue</span>
                          {revenuePct !== null && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: revenuePct >= 0 ? t.green : t.red }}>
                              {revenuePct >= 0 ? '▲' : '▼'}{Math.abs(revenuePct).toFixed(0)}%
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 12, height: 3, borderRadius: 2, background: t.red, display: 'inline-block' }} />
                          <span style={{ fontSize: 11, color: t.text3 }}>Prev Year Orders</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 12, height: 3, borderRadius: 2, background: '#ffd60a', display: 'inline-block' }} />
                          <span style={{ fontSize: 11, color: t.text3 }}>Prev Year Revenue</span>
                        </div>
                      </div>
                    )
                  })()}
                </>
              )}
            </div>

            {/* Top Customers (with YoY) + Pie Chart + Recent Orders */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 20 }}>
              {/* Top Customers with YoY */}
              <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20, backdropFilter: 'blur(40px)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: t.text1 }}>Top Customers</div>
                  <PillSelect options={[{ key: 7, label: '7d' }, { key: 14, label: '14d' }, { key: 30, label: '30d' }, { key: 60, label: '60d' }, { key: 90, label: '90d' }, { key: 180, label: '180d' }]} value={topCustomerDays} onChange={setTopCustomerDays} />
                </div>
                {!dashboardData.customers ? <Shimmer height={300} /> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${t.separator}` }}>
                        <th style={{ textAlign: 'left', padding: '6px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Customer</th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Spend</th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>YoY</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardData.customers.topCustomers.map((c, i) => {
                        const yoyPct = c.yoySpend > 0 ? ((c.spend - c.yoySpend) / c.yoySpend * 100) : null
                        return (
                          <tr key={i} style={{ borderBottom: `1px solid ${t.separator}` }}>
                            <td style={{ padding: '7px 8px 7px 0', fontSize: 12 }}>
                              {c.customerId ? <ShopifyLink href={`${SHOPIFY_ADMIN}/customers/${c.customerId}`}>{c.name}</ShopifyLink> : <span style={{ color: t.text1 }}>{c.name}</span>}
                            </td>
                            <td style={{ padding: '7px 4px 7px 0', fontSize: 12, color: t.green, textAlign: 'right', fontWeight: 600 }}>{currency}{fmt(c.spend, 0)}</td>
                            <td style={{ padding: '7px 0', fontSize: 11, textAlign: 'right', fontWeight: 600, color: yoyPct === null ? t.text3 : yoyPct >= 0 ? t.green : t.red }}>
                              {yoyPct === null ? 'New' : `${yoyPct >= 0 ? '▲' : '▼'}${Math.abs(yoyPct).toFixed(0)}%`}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Customer Revenue Pie Chart */}
              <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20, backdropFilter: 'blur(40px)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.text1, marginBottom: 12 }}>Revenue Split</div>
                {!dashboardData.customers ? <Shimmer height={250} /> : (() => {
                  const pieSlices = dashboardData.customers.topCustomers.slice(0, 8).map(c => ({ name: c.name, value: c.spend }))
                  const pieTotal = pieSlices.reduce((s, c) => s + c.value, 0)
                  return (
                    <>
                      <div style={{ width: '100%', height: 160, position: 'relative' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={pieSlices}
                              cx="50%" cy="50%" innerRadius={42} outerRadius={68}
                              paddingAngle={3} dataKey="value" stroke="none"
                              animationBegin={0} animationDuration={800} animationEasing="ease-out"
                            >
                              {pieSlices.map((_, i) => (
                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: number) => `${currency}${fmt(v, 0)}`} contentStyle={{ background: 'rgba(28,28,30,0.95)', border: `1px solid ${t.cardBorder}`, borderRadius: 8, fontSize: 12, color: t.text1, backdropFilter: 'blur(20px)' }} itemStyle={{ color: t.text2 }} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: t.text1, letterSpacing: '-0.02em', lineHeight: 1 }}>{currency}{fmt(pieTotal, 0)}</div>
                          <div style={{ fontSize: 9, color: t.text3, marginTop: 2 }}>total</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 8 }}>
                        {pieSlices.map((c, i) => (
                          <div key={c.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                              <span style={{ width: 8, height: 8, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0, display: 'inline-block' }} />
                              <span style={{ fontSize: 11, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 600, color: t.text1, flexShrink: 0, marginLeft: 8 }}>{currency}{fmt(c.value, 0)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )
                })()}
              </div>

              {/* Recent Orders — last 10 */}
              <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20, backdropFilter: 'blur(40px)' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.text1, marginBottom: 12 }}>Recent Orders</div>
                {ordersLoading && !ordersData ? <Shimmer height={300} /> : (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${t.separator}` }}>
                            {['Order', 'Customer', 'Date', 'Total', 'Status'].map(h => (
                              <th key={h} style={{ textAlign: h === 'Total' ? 'right' : 'left', padding: '6px 8px 6px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(ordersData?.recentOrders || []).slice(0, 10).map(o => (
                            <tr key={o.id} style={{ borderBottom: `1px solid ${t.separator}` }}>
                              <td style={{ padding: '8px 8px 8px 0', fontSize: 12 }}>
                                <ShopifyLink href={`${SHOPIFY_ADMIN}/orders/${o.id}`}>{o.name}</ShopifyLink>
                              </td>
                              <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: t.text1 }}>{o.customer}</td>
                              <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: t.text3, whiteSpace: 'nowrap' }}>{new Date(o.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                              <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: t.green, textAlign: 'right', fontWeight: 600 }}>{currency}{fmt(o.total, 2)}</td>
                              <td style={{ padding: '8px 0' }}>
                                <span style={{
                                  fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                                  background: o.status === 'paid' ? 'rgba(48,209,88,0.15)' : 'rgba(255,159,10,0.15)',
                                  color: o.status === 'paid' ? t.green : t.orange,
                                }}>{o.status}</span>
                              </td>
                            </tr>
                          ))}
                          {ordersData && ordersData.recentOrders.length === 0 && (
                            <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: t.text3 }}>No orders in this period</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ textAlign: 'center', marginTop: 12 }}>
                      <a href={`${SHOPIFY_ADMIN}/orders`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: t.blue, textDecoration: 'none', fontWeight: 500 }}>View more →</a>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Top Products — 2 columns */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 16, marginBottom: 20 }}>
              {/* Top Products by Revenue */}
              <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20, backdropFilter: 'blur(40px)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: t.text1 }}>Top Products by Revenue</div>
                  <PillSelect options={[{ key: 7, label: '7d' }, { key: 14, label: '14d' }, { key: 30, label: '30d' }]} value={topProductDays} onChange={setTopProductDays} />
                </div>
                {!dashboardData.products ? <Shimmer height={300} /> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${t.separator}` }}>
                        <th style={{ textAlign: 'left', padding: '6px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Product</th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Revenue</th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardData.products.topProducts.map((p, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${t.separator}` }}>
                          <td style={{ padding: '8px 0', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.productId ? <ShopifyLink href={`${SHOPIFY_ADMIN}/products/${p.productId}`}>{p.name}</ShopifyLink> : <span style={{ color: t.text1 }}>{p.name}</span>}
                          </td>
                          <td style={{ padding: '8px 0', fontSize: 12, color: t.green, textAlign: 'right', fontWeight: 600 }}>{currency}{fmt(p.revenue, 0)}</td>
                          <td style={{ padding: '8px 0', fontSize: 12, color: t.text1, textAlign: 'right' }}>{p.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Top Products by Quantity */}
              <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20, backdropFilter: 'blur(40px)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: t.text1 }}>Top Products by Quantity</div>
                  <PillSelect options={[{ key: 7, label: '7d' }, { key: 14, label: '14d' }, { key: 30, label: '30d' }]} value={topProductDays} onChange={setTopProductDays} />
                </div>
                {!dashboardData.products ? <Shimmer height={300} /> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${t.separator}` }}>
                        <th style={{ textAlign: 'left', padding: '6px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Product</th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Qty</th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...dashboardData.products.topProducts].sort((a, b) => b.qty - a.qty).map((p, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${t.separator}` }}>
                          <td style={{ padding: '8px 0', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.productId ? <ShopifyLink href={`${SHOPIFY_ADMIN}/products/${p.productId}`}>{p.name}</ShopifyLink> : <span style={{ color: t.text1 }}>{p.name}</span>}
                          </td>
                          <td style={{ padding: '8px 0', fontSize: 12, color: t.text1, textAlign: 'right', fontWeight: 600 }}>{p.qty}</td>
                          <td style={{ padding: '8px 0', fontSize: 12, color: t.green, textAlign: 'right' }}>{currency}{fmt(p.revenue, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Dormant Customers + Outstanding Orders — side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginTop: 16 }}>
            <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20, backdropFilter: 'blur(40px)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.text1 }}>
                  Dormant Customers {dormantData ? <span style={{ color: t.orange, fontWeight: 700 }}>({dormantData.total})</span> : null}
                </div>
                <PillSelect options={[{ key: 30, label: '30d' }, { key: 60, label: '60d' }, { key: 90, label: '90d' }, { key: 180, label: '180d' }, { key: 365, label: '1yr' }]} value={dormantDays} onChange={setDormantDays} />
              </div>
              <div style={{ fontSize: 11, color: t.text3, marginBottom: 12 }}>Customers who haven&apos;t ordered in the last {dormantDays} days</div>
              {!dormantData ? <Shimmer height={200} /> : (
                <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${t.separator}`, position: 'sticky', top: 0, background: t.card }}>
                        {['Customer', 'Company', 'Orders', 'Total Spent', 'Days Since Order'].map(h => (
                          <th key={h} style={{ textAlign: h === 'Orders' || h === 'Total Spent' || h === 'Days Since Order' ? 'right' : 'left', padding: '6px 8px 6px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dormantData.dormant.map(c => (
                        <tr key={c.id} style={{ borderBottom: `1px solid ${t.separator}` }}>
                          <td style={{ padding: '8px 8px 8px 0', fontSize: 12 }}>
                            <ShopifyLink href={`${SHOPIFY_ADMIN}/customers/${c.id}`}>{c.name}</ShopifyLink>
                          </td>
                          <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: t.text2 }}>{c.company || '-'}</td>
                          <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: t.text1, textAlign: 'right' }}>{c.ordersCount}</td>
                          <td style={{ padding: '8px 8px 8px 0', fontSize: 12, color: t.green, textAlign: 'right', fontWeight: 600 }}>{currency}{fmt(c.totalSpent, 0)}</td>
                          <td style={{ padding: '8px 0', fontSize: 12, textAlign: 'right', fontWeight: 600, color: c.daysSince > 90 ? t.red : c.daysSince > 60 ? t.orange : t.text1 }}>{c.daysSince}d</td>
                        </tr>
                      ))}
                      {dormantData.dormant.length === 0 && (
                        <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: t.text3 }}>No dormant customers in this period</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Outstanding Orders — consolidated by customer */}
            {historyData && historyData.outstanding.count > 0 && (() => {
              // Group by customer
              const grouped: Record<string, { customer: string; company: string; customerId: number | null; totalOwed: number; orderCount: number; orders: { id: number; name: string; total: number; status: string; date: string }[] }> = {}
              for (const o of historyData.outstanding.orders) {
                const key = o.customerId?.toString() || o.customer
                if (!grouped[key]) grouped[key] = { customer: o.customer, company: o.company, customerId: o.customerId, totalOwed: 0, orderCount: 0, orders: [] }
                grouped[key].totalOwed += o.total
                grouped[key].orderCount++
                grouped[key].orders.push({ id: o.id, name: o.name, total: o.total, status: o.status, date: o.date })
              }
              const customers = Object.values(grouped).sort((a, b) => b.totalOwed - a.totalOwed)
              return (
                <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20, backdropFilter: 'blur(40px)' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: t.text1, marginBottom: 12 }}>Outstanding by Customer</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${t.separator}` }}>
                          {['Customer', 'Company', 'Orders', 'Total Owed'].map(h => (
                            <th key={h} style={{ textAlign: h === 'Orders' || h === 'Total Owed' ? 'right' : 'left', padding: '6px 8px 6px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {customers.map((c, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${t.separator}` }}>
                            <td style={{ padding: '10px 8px 10px 0', fontSize: 13 }}>
                              {c.customerId ? <ShopifyLink href={`${SHOPIFY_ADMIN}/customers/${c.customerId}`}>{c.customer}</ShopifyLink> : <span style={{ color: t.text1 }}>{c.customer}</span>}
                            </td>
                            <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.text2 }}>{c.company || '-'}</td>
                            <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.text1, textAlign: 'right' }}>{c.orderCount}</td>
                            <td style={{ padding: '10px 0', fontSize: 13, color: t.orange, textAlign: 'right', fontWeight: 600 }}>{currency}{fmt(c.totalOwed, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })()}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 20 }}>
              {customersLoading && !customersData ? (
                <>
                  {[...Array(5)].map((_, i) => <div key={i}><Shimmer height={90} /></div>)}
                </>
              ) : customersData ? (
                <>
                  <StatCard label={`Revenue (${range === 'today' ? 'Today' : range === 'yesterday' ? 'Yesterday' : range === '7days' ? '7d' : range === '30days' ? '30d' : 'Custom'})`} value={ordersData ? `${currency}${fmt(ordersData.orders.revenue, 0)}` : '-'} color={t.green} />
                  <StatCard label="Total Customers" value={fmt(customersData.totalCustomers)} color={t.text1} />
                  <StatCard label="Active Last 30d" value={fmt(customersData.activeCustomers30d)} color={t.blue} />
                  <StatCard label="Revenue (30d)" value={`${currency}${fmt(customersData.totalRevenue30d, 0)}`} color={t.green} />
                  {(() => {
                    const ytd = customersData.totalSpendYTD
                    const prevYtd = customersData.prevYTDRevenue
                    const pct = prevYtd > 0 ? ((ytd - prevYtd) / prevYtd * 100) : null
                    const sub = pct !== null
                      ? `${pct >= 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}% vs last year (${currency}${fmt(prevYtd, 0)})`
                      : undefined
                    return <StatCard label="YTD Revenue" value={`${currency}${fmt(ytd, 0)}`} color={t.text2} sub={sub} />
                  })()}
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
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800, tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: '16%' }} />
                      <col style={{ width: '12%' }} />
                      <col style={{ width: '22%' }} />
                      <col style={{ width: '10%' }} />
                      <col style={{ width: '14%' }} />
                      <col style={{ width: '14%' }} />
                      <col style={{ width: '12%' }} />
                    </colgroup>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${t.separator}` }}>
                        <th style={{ textAlign: 'left', padding: '10px 16px 10px 0' }}>
                          <button type="button" onClick={() => toggleCustomerSort('name')} style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 500, color: customerSort === 'name' ? t.text1 : t.text3, cursor: 'pointer' }}>Name{custSortIndicator('name')}</button>
                        </th>
                        <th style={{ textAlign: 'left', padding: '10px 16px 10px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Company</th>
                        <th style={{ textAlign: 'left', padding: '10px 16px 10px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Email</th>
                        <th style={{ textAlign: 'right', padding: '10px 16px 10px 0' }}>
                          <button type="button" onClick={() => toggleCustomerSort('orders')} style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 500, color: customerSort === 'orders' ? t.text1 : t.text3, cursor: 'pointer' }}>Orders{custSortIndicator('orders')}</button>
                        </th>
                        <th style={{ textAlign: 'right', padding: '10px 16px 10px 0' }}>
                          <button type="button" onClick={() => toggleCustomerSort('ytd')} style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 500, color: customerSort === 'ytd' ? t.text1 : t.text3, cursor: 'pointer' }}>YTD Revenue{custSortIndicator('ytd')}</button>
                        </th>
                        <th style={{ textAlign: 'right', padding: '10px 16px 10px 0' }}>
                          <button type="button" onClick={() => toggleCustomerSort('allTime')} style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 500, color: customerSort === 'allTime' ? t.text1 : t.text3, cursor: 'pointer' }}>All Time{custSortIndicator('allTime')}</button>
                        </th>
                        <th style={{ textAlign: 'right', padding: '10px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Last Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCustomers.map(c => (
                        <tr key={c.id} style={{ borderBottom: `1px solid ${t.separator}` }}>
                          <td style={{ padding: '12px 16px 12px 0', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <ShopifyLink href={`${SHOPIFY_ADMIN}/customers/${c.id}`}>{c.name}</ShopifyLink>
                          </td>
                          <td style={{ padding: '12px 16px 12px 0', fontSize: 12, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company || '-'}</td>
                          <td style={{ padding: '12px 16px 12px 0', fontSize: 12, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</td>
                          <td style={{ padding: '12px 16px 12px 0', fontSize: 13, color: t.text1, textAlign: 'right' }}>{c.ordersCount}</td>
                          <td style={{ padding: '12px 16px 12px 0', fontSize: 13, color: t.green, textAlign: 'right', fontWeight: 600 }}>{currency}{fmt(c.spendYTD, 2)}</td>
                          <td style={{ padding: '12px 16px 12px 0', fontSize: 13, color: t.text2, textAlign: 'right' }}>{currency}{fmt(c.totalSpent, 0)}</td>
                          <td style={{ padding: '12px 0', fontSize: 12, color: t.text2, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                          </td>
                        </tr>
                      ))}
                      {filteredCustomers.length === 0 && (
                        <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: t.text3 }}>
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
                  <StatCard label="Total Stock Value" value={`${currency}${fmt(productsData.summary.totalStockValue, 0)}`} color={t.purple} />
                </>
              ) : null}
            </div>

            {/* Product table */}
            <div style={{
              background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: t.radius, padding: 20,
              backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
            }}>
              {productsLoading && !productsData ? <Shimmer height={400} /> : (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${t.separator}` }}>
                          <th style={{ padding: '8px 8px 8px 0', fontSize: 11, fontWeight: 500, color: t.text3, width: 44 }}></th>
                          <th style={{ textAlign: 'left', padding: '8px 8px 8px 0' }}>
                            <button type="button" onClick={() => toggleProductSort('title')} style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 500, color: productSort === 'title' ? t.text1 : t.text3, cursor: 'pointer' }}>Product{sortIndicator('title')}</button>
                          </th>
                          <th style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Type</th>
                          <th style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>SKU(s)</th>
                          <th style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Barcode</th>
                          <th style={{ textAlign: 'right', padding: '8px 8px 8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Price</th>
                          <th style={{ textAlign: 'right', padding: '8px 8px 8px 0' }}>
                            <button type="button" onClick={() => toggleProductSort('stock')} style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 500, color: productSort === 'stock' ? t.text1 : t.text3, cursor: 'pointer' }}>Stock{sortIndicator('stock')}</button>
                          </th>
                          <th style={{ textAlign: 'right', padding: '8px 8px 8px 0' }}>
                            <button type="button" onClick={() => toggleProductSort('stockValue')} style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 500, color: productSort === 'stockValue' ? t.text1 : t.text3, cursor: 'pointer' }}>Stock Value{sortIndicator('stockValue')}</button>
                          </th>
                          <th style={{ textAlign: 'left', padding: '8px 8px 8px 0', fontSize: 11, fontWeight: 500, color: t.text3 }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedProducts.map((p, idx) => {
                          const mainVariant = p.variants[0]
                          const skus = p.variants.map(v => v.sku).filter(Boolean).join(', ')
                          const barcodes = p.variants.map(v => v.barcode).filter(Boolean).join(', ')
                          return (
                            <tr key={`${p.id}-${idx}`} style={{ borderBottom: `1px solid ${t.separator}` }}>
                              <td style={{ padding: '6px 8px 6px 0', width: 44 }}>
                                {p.image ? (
                                  <img src={p.image} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', background: 'rgba(255,255,255,0.05)' }} />
                                ) : (
                                  <div style={{ width: 36, height: 36, borderRadius: 6, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: t.text3 }}>N/A</div>
                                )}
                              </td>
                              <td style={{ padding: '10px 8px 10px 0', fontSize: 13, fontWeight: 500, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <ShopifyLink href={`${SHOPIFY_ADMIN}/products/${p.id}`}>{p.title}</ShopifyLink>
                              </td>
                              <td style={{ padding: '10px 8px 10px 0', fontSize: 12, color: t.text2 }}>{p.productType || '-'}</td>
                              <td style={{ padding: '10px 8px 10px 0', fontSize: 12, color: t.text2, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skus || '-'}</td>
                              <td style={{ padding: '10px 8px 10px 0', fontSize: 12, color: t.text2, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{barcodes || '-'}</td>
                              <td style={{ padding: '10px 8px 10px 0', fontSize: 13, color: t.text1, textAlign: 'right' }}>
                                {mainVariant ? `${currency}${fmt(mainVariant.price, 2)}` : '-'}
                              </td>
                              <td style={{ padding: '10px 8px 10px 0', fontSize: 13, textAlign: 'right', fontWeight: 600, color: stockColor(p.totalStock) }}>
                                {p.totalStock}
                              </td>
                              <td style={{ padding: '10px 8px 10px 0', fontSize: 13, textAlign: 'right', color: t.text1 }}>
                                {currency}{fmt(p.stockValue, 0)}
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
                          <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: t.text3 }}>
                            {search ? 'No products match your search' : 'No products found'}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination */}
                  {totalProductPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                      <span style={{ fontSize: 12, color: t.text3 }}>
                        Showing {productPage * PRODUCTS_PER_PAGE + 1}–{Math.min((productPage + 1) * PRODUCTS_PER_PAGE, filteredProducts.length)} of {filteredProducts.length}
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setProductPage(p => Math.max(0, p - 1))} disabled={productPage === 0} style={{
                          padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: 'none', cursor: productPage === 0 ? 'default' : 'pointer',
                          background: 'rgba(255,255,255,0.08)', color: productPage === 0 ? t.text3 : t.text1,
                        }}>Previous</button>
                        <button onClick={() => setProductPage(p => Math.min(totalProductPages - 1, p + 1))} disabled={productPage >= totalProductPages - 1} style={{
                          padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: 'none', cursor: productPage >= totalProductPages - 1 ? 'default' : 'pointer',
                          background: 'rgba(255,255,255,0.08)', color: productPage >= totalProductPages - 1 ? t.text3 : t.text1,
                        }}>Next</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
