'use client'

import { useEffect, useState, useMemo } from 'react'
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

/* ---------- types ---------- */
interface UnlistedProduct {
  title: string
  sku: string
  currentChannels: string[]
  missingFrom: string[]
  stockLevel: number
}

interface ApiResponse {
  ok: boolean
  products: UnlistedProduct[]
  totalProducts: number
  missingEbay: number
  missingAmazon: number
  missingBoth: number
  error?: string
}

type Filter = 'all' | 'ebay' | 'amazon' | 'both'

/* ---------- component ---------- */
export default function UnlistedPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/veeqo/unlisted')
      .then(r => r.json())
      .then((d: ApiResponse) => {
        if (!d.ok) throw new Error(d.error ?? 'Unknown error')
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!data) return []
    let list = data.products

    if (filter === 'ebay') list = list.filter(p => p.missingFrom.includes('eBay'))
    else if (filter === 'amazon') list = list.filter(p => p.missingFrom.includes('Amazon'))
    else if (filter === 'both') list = list.filter(p => p.missingFrom.length === 2)

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        p => p.title.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      )
    }

    return list
  }, [data, filter, search])

  const downloadCSV = () => {
    const header = 'Product,SKU,Stock,Current Channels,Missing From'
    const rows = filtered.map(p => {
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
      return [
        esc(p.title),
        esc(p.sku),
        p.stockLevel,
        esc(p.currentChannels.join(', ')),
        esc(p.missingFrom.join(', ')),
      ].join(',')
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'unlisted-products.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ---------- stat card ---------- */
  const StatCard = ({ label, value, color }: { label: string; value: number | string; color: string }) => (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 160,
        padding: '20px 24px',
        background: t.card,
        border: `1px solid ${t.cardBorder}`,
        borderRadius: t.radius,
        backdropFilter: 'blur(40px)',
        WebkitBackdropFilter: 'blur(40px)',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500, color: t.text2, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, letterSpacing: '-0.02em' }}>{value}</div>
    </div>
  )

  /* ---------- filter tabs ---------- */
  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'ebay', label: 'Missing eBay' },
    { key: 'amazon', label: 'Missing Amazon' },
    { key: 'both', label: 'Missing Both' },
  ]

  /* ---------- channel badge ---------- */
  const Badge = ({ label, color }: { label: string; color: string }) => (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        background: `${color}18`,
        color,
        marginRight: 4,
        marginBottom: 2,
      }}
    >
      {label}
    </span>
  )

  const channelColor: Record<string, string> = {
    Shopify: t.green,
    Amazon: t.orange,
    eBay: t.blue,
  }

  /* ---------- render ---------- */
  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: t.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: font,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 32,
              height: 32,
              border: `3px solid ${t.text3}`,
              borderTopColor: t.blue,
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 16px',
            }}
          />
          <div style={{ color: t.text2, fontSize: 15 }}>Loading products...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: t.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: font,
        }}
      >
        <div
          style={{
            padding: '32px 40px',
            background: t.card,
            border: `1px solid ${t.cardBorder}`,
            borderRadius: t.radius,
            textAlign: 'center',
            maxWidth: 440,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 600, color: t.red, marginBottom: 8 }}>
            Failed to load
          </div>
          <div style={{ fontSize: 13, color: t.text2 }}>{error}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: t.bg,
        fontFamily: font,
        color: t.text1,
        padding: '24px clamp(12px, 3vw, 28px) 60px',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Nav />
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              margin: 0,
            }}
          >
            Unlisted Products
          </h1>
        </div>
        <p style={{ fontSize: 14, color: t.text2, margin: '6px 0 0' }}>
          Products missing from eBay or Amazon marketplaces
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
        <StatCard label="Total Products" value={data?.totalProducts ?? 0} color={t.text1} />
        <StatCard label="Missing eBay" value={data?.missingEbay ?? 0} color={t.blue} />
        <StatCard label="Missing Amazon" value={data?.missingAmazon ?? 0} color={t.orange} />
        <StatCard label="Missing Both" value={data?.missingBoth ?? 0} color={t.red} />
      </div>

      {/* Toolbar: filters + search + download */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 20,
        }}
      >
        {/* Filter tabs */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: t.radiusSm,
            padding: 3,
          }}
        >
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: '7px 16px',
                borderRadius: 8,
                border: 'none',
                fontSize: 13,
                fontWeight: 500,
                fontFamily: font,
                cursor: 'pointer',
                color: filter === f.key ? t.text1 : t.text2,
                background: filter === f.key ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                transition: 'all 0.2s ease',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Search */}
          <input
            type="text"
            placeholder="Search product or SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              padding: '8px 16px',
              borderRadius: t.radiusSm,
              border: `1px solid ${t.cardBorder}`,
              background: 'rgba(255, 255, 255, 0.04)',
              color: t.text1,
              fontSize: 13,
              fontFamily: font,
              outline: 'none',
              width: 240,
            }}
          />

          {/* Download CSV */}
          <button
            onClick={downloadCSV}
            style={{
              padding: '8px 18px',
              borderRadius: t.radiusSm,
              border: 'none',
              background: t.blue,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: font,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Download CSV
          </button>
        </div>
      </div>

      {/* Results count */}
      <div style={{ fontSize: 13, color: t.text3, marginBottom: 12 }}>
        {filtered.length} product{filtered.length !== 1 ? 's' : ''}
      </div>

      {/* Table */}
      <div
        style={{
          background: t.card,
          border: `1px solid ${t.cardBorder}`,
          borderRadius: t.radius,
          overflowX: 'auto',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
        }}
      >
        <table
          style={{
            width: '100%',
            minWidth: 600,
            borderCollapse: 'collapse',
            fontSize: 13,
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: `1px solid ${t.separator}`,
              }}
            >
              {['Product', 'SKU', 'Stock', 'Listed On', 'Missing From'].map(h => (
                <th
                  key={h}
                  style={{
                    padding: '14px 20px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: t.text2,
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    padding: '40px 20px',
                    textAlign: 'center',
                    color: t.text3,
                  }}
                >
                  No products found
                </td>
              </tr>
            ) : (
              filtered.map((p, i) => (
                <tr
                  key={`${p.sku}-${i}`}
                  style={{
                    borderBottom:
                      i < filtered.length - 1 ? `1px solid ${t.separator}` : 'none',
                  }}
                >
                  <td
                    style={{
                      padding: '14px 20px',
                      color: t.text1,
                      fontWeight: 500,
                      maxWidth: 320,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.title}
                  </td>
                  <td
                    style={{
                      padding: '14px 20px',
                      color: t.text2,
                      fontFamily: "'SF Mono', Menlo, monospace",
                      fontSize: 12,
                    }}
                  >
                    {p.sku}
                  </td>
                  <td
                    style={{
                      padding: '14px 20px',
                      color: p.stockLevel === 0 ? t.red : t.text1,
                      fontWeight: 600,
                    }}
                  >
                    {p.stockLevel}
                  </td>
                  <td style={{ padding: '14px 20px' }}>
                    {p.currentChannels.length > 0
                      ? p.currentChannels.map(ch => (
                          <Badge
                            key={ch}
                            label={ch}
                            color={channelColor[ch] ?? t.teal}
                          />
                        ))
                      : <span style={{ color: t.text3 }}>None</span>}
                  </td>
                  <td style={{ padding: '14px 20px' }}>
                    {p.missingFrom.map(ch => (
                      <Badge key={ch} label={ch} color={t.red} />
                    ))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
