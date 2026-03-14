'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

type Layout = { i: string; x: number; y: number; w: number; h: number }
type Layouts = { [key: string]: Layout[] }
const ResponsiveGridLayout = WidthProvider(Responsive)

// ─── Types ────────────────────────────────────────────────────────────────────
type DateRange = 'today' | 'yesterday' | '7days' | '30days' | 'custom'
type ApiStatus = 'idle' | 'ok' | 'error' | 'loading'

interface ChannelBreakdown { name: string; orders: number; revenue: number }
interface SkuBreakdown { name: string; sku: string; qty: number; revenue: number }

interface WarehouseStock { name: string; value: number; units: number }

interface VeeqoData {
  orders: { total: number; shipped: number; pending: number; revenue: number; hourly: Record<number, number> }
  stock: { critical: number; low: number; healthy: number; total: number; lowItems: { name: string; qty: number }[] }
  shift: { picks: number; packs: number; lists: number; errors: number }
  channels: ChannelBreakdown[]
  topSkus: SkuBreakdown[]
  topSkusByChannel: Record<string, SkuBreakdown[]>
  stockByWarehouse: WarehouseStock[]
  totalStockValue: number
}
interface AmazonData {
  orders: { total: number; revenue: number; ukOrders: number; ukRevenue: number; euOrders: number; euRevenue: number; hourly: Record<number, number> }
  returns: { cancelled: number }
  rating: { score: number | null; reviews: number }
}
interface EbayData {
  orders: { total: number; revenue: number; hourly: Record<number, number> }
  returns: { returns: number; cancelled: number }
  rating: { score: number; reviews: number }
}
interface SheetsMetric { metric: string; target: number; actual: number; unit: string; pct: number }
interface SheetsData { metrics: SheetsMetric[]; lastSync: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const CUR = process.env.NEXT_PUBLIC_CURRENCY || '£'
const fmt = (n?: number) => n != null ? n.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : '--'
const fmtRev = (n?: number) => n != null ? CUR + fmt(n) : '--'
const pct = (a: number, b: number) => b ? ((a / b) * 100).toFixed(1) + '%' : '--'

function StatusDot({ status }: { status: ApiStatus }) {
  const colours: Record<ApiStatus, string> = {
    ok: '#22c55e', error: '#f87171', loading: '#475569', idle: '#334155'
  }
  return (
    <span
      className={status === 'ok' ? 'pulse' : ''}
      style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: colours[status], flexShrink: 0
      }}
    />
  )
}

function Tag({ label, type }: { label: string; type: 'veeqo' | 'amazon' | 'ebay' | 'sheets' }) {
  const styles: Record<string, React.CSSProperties> = {
    veeqo:  { background: '#1a2744', color: '#38bdf8', border: '1px solid #1e3a5f' },
    amazon: { background: '#2a1f0d', color: '#f59e0b', border: '1px solid #3d2e0f' },
    ebay:   { background: '#1a0f2e', color: '#a78bfa', border: '1px solid #2d1a52' },
    sheets: { background: '#0d2a1a', color: '#4ade80', border: '1px solid #103d22' },
  }
  return (
    <span style={{
      ...styles[type], fontSize: 10, letterSpacing: '0.1em', padding: '3px 8px',
      borderRadius: 3, textTransform: 'uppercase', fontWeight: 700, display: 'inline-block', marginBottom: 8
    }}>{label}</span>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div style={{ background: '#0f1419', border: '1px solid #1e2530', borderRadius: 6, padding: '14px 16px', height: '100%', overflow: 'auto' }} className={className}>
      {children}
    </div>
  )
}

function MetricBlock({ label, value, sub, subColour }: { label: string; value: string; sub?: string; subColour?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#f1f5f9', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: subColour || '#475569', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function ProgressBar({ pct, colour }: { pct: number; colour: string }) {
  return (
    <div style={{ flex: 1, height: 8, background: '#1e2530', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: colour, borderRadius: 4, transition: 'width 0.6s ease' }} />
    </div>
  )
}

function Sparkline({ hourly }: { hourly: Record<number, number> }) {
  const hours = Array.from({ length: 10 }, (_, i) => hourly[i + 8] || 0)
  const max = Math.max(...hours, 1)
  const currentHour = new Date().getHours()
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 36 }}>
      {hours.map((v, i) => {
        const h = i + 8
        const isCurrent = h === currentHour
        const isFuture = h > currentHour
        return (
          <div key={i} style={{
            flex: 1, borderRadius: '2px 2px 0 0',
            height: `${Math.max((v / max) * 100, 5)}%`,
            background: isFuture ? '#1e2530' : isCurrent ? '#38bdf8' : '#1e4a6a',
            opacity: isFuture ? 0.3 : 1,
            transition: 'height 0.5s ease'
          }} />
        )
      })}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, letterSpacing: '0.22em', color: '#475569', textTransform: 'uppercase', marginBottom: 8 }}>{children}</div>
}

// ─── Widget Components ────────────────────────────────────────────────────────
function VeeqoOrdersWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  return (
    <Card>
      <Tag label="Veeqo" type="veeqo" />
      <SectionLabel>Orders & Revenue</SectionLabel>
      {loading ? (
        <><div className="shimmer" style={{ height: 28, width: '60%', marginBottom: 12 }} /><div className="shimmer" style={{ height: 22, width: '40%' }} /></>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <MetricBlock label="Orders Today" value={fmt(data?.orders.total)} sub={`${fmt(data?.orders.shipped)} shipped`} />
          <MetricBlock label="Revenue" value={fmtRev(data?.orders.revenue)} sub={`${fmt(data?.orders.pending)} pending`} subColour="#f59e0b" />
        </div>
      )}
    </Card>
  )
}

function VeeqoChannelsWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  const channels = data?.channels || []
  const totalRev = channels.reduce((s, c) => s + c.revenue, 0)
  const channelColours = ['#38bdf8', '#f59e0b', '#a78bfa', '#4ade80', '#f87171', '#fb923c']
  return (
    <Card>
      <Tag label="Veeqo" type="veeqo" />
      <SectionLabel>Revenue by Channel</SectionLabel>
      {loading ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !channels.length ? (
        <div style={{ fontSize: 13, color: '#475569' }}>No orders yet</div>
      ) : (
        <>
          {channels.map((ch, i) => {
            const share = totalRev ? (ch.revenue / totalRev) * 100 : 0
            return (
              <div key={ch.name} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: '#94a3b8' }}>{ch.name}</span>
                  <span style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600 }}>{fmtRev(ch.revenue)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ProgressBar pct={share} colour={channelColours[i % channelColours.length]} />
                  <span style={{ fontSize: 12, color: '#64748b', width: 40, textAlign: 'right', flexShrink: 0 }}>{share.toFixed(0)}%</span>
                </div>
              </div>
            )
          })}
        </>
      )}
    </Card>
  )
}

function VeeqoOrdersByChannelWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  const channels = data?.channels || []
  const channelColours = ['#38bdf8', '#f59e0b', '#a78bfa', '#4ade80', '#f87171', '#fb923c']
  return (
    <Card>
      <Tag label="Veeqo" type="veeqo" />
      <SectionLabel>Orders by Channel</SectionLabel>
      {loading ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !channels.length ? (
        <div style={{ fontSize: 13, color: '#475569' }}>No orders yet</div>
      ) : (
        <>
          {channels.map((ch, i) => (
            <div key={ch.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #111820' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: channelColours[i % channelColours.length], flexShrink: 0, display: 'inline-block' }} />
                <span style={{ fontSize: 13, color: '#94a3b8' }}>{ch.name}</span>
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{fmt(ch.orders)}</span>
            </div>
          ))}
          <div style={{ fontSize: 12, color: '#475569', marginTop: 8 }}>
            Total: <span style={{ color: '#f1f5f9', fontWeight: 700 }}>{fmt(channels.reduce((s, c) => s + c.orders, 0))}</span>
          </div>
        </>
      )}
    </Card>
  )
}

function VeeqoTopSkusWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  const skus = data?.topSkus || []
  return (
    <Card>
      <Tag label="Veeqo" type="veeqo" />
      <SectionLabel>Best Selling SKUs (Overall)</SectionLabel>
      {loading ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !skus.length ? (
        <div style={{ fontSize: 13, color: '#475569' }}>No sales yet</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Product', 'Qty', 'Revenue'].map(h => (
                <th key={h} style={{ fontSize: 11, letterSpacing: '0.1em', color: '#475569', textTransform: 'uppercase', textAlign: h === 'Product' ? 'left' : 'right', paddingBottom: 8, borderBottom: '1px solid #1e2530' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skus.slice(0, 8).map((s, i) => (
              <tr key={i}>
                <td style={{ padding: '6px 0', borderBottom: '1px solid #111820', color: '#94a3b8', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</td>
                <td style={{ padding: '6px 0', borderBottom: '1px solid #111820', color: '#f1f5f9', fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{s.qty}</td>
                <td style={{ padding: '6px 0', borderBottom: '1px solid #111820', color: '#38bdf8', fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{fmtRev(s.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function VeeqoTopSkusByChannelWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  const byChannel = data?.topSkusByChannel || {}
  const channelNames = Object.keys(byChannel)
  const channelColours: Record<string, string> = {}
  const palette = ['#38bdf8', '#f59e0b', '#a78bfa', '#4ade80', '#f87171', '#fb923c']
  channelNames.forEach((n, i) => { channelColours[n] = palette[i % palette.length] })

  return (
    <Card>
      <Tag label="Veeqo" type="veeqo" />
      <SectionLabel>Top SKUs by Channel</SectionLabel>
      {loading ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !channelNames.length ? (
        <div style={{ fontSize: 13, color: '#475569' }}>No sales yet</div>
      ) : (
        <>
          {channelNames.map(ch => (
            <div key={ch} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: channelColours[ch], marginBottom: 6 }}>{ch}</div>
              {byChannel[ch].slice(0, 3).map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #111820' }}>
                  <span style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{s.name}</span>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{s.qty} sold</span>
                  <span style={{ fontSize: 12, color: '#f1f5f9', fontWeight: 600 }}>{fmtRev(s.revenue)}</span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </Card>
  )
}

function VeeqoShiftWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <Tag label="Veeqo — Shift" type="veeqo" />
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#475569', letterSpacing: '0.1em' }}>SHIFT ENDS</div>
          <div style={{ fontSize: 15, color: '#38bdf8', fontWeight: 700 }}>17:30</div>
        </div>
      </div>
      {loading ? (
        <div className="shimmer" style={{ height: 60 }} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            <MetricBlock label="Picks" value={fmt(data?.shift.picks)} sub={`${data?.shift.lists || 0} lists`} />
            <MetricBlock label="Packs" value={fmt(data?.shift.packs)} sub={pct(data?.shift.packs || 0, data?.shift.picks || 1) + ' done'} />
            <MetricBlock label="Errors" value={String(data?.shift.errors ?? '--')} subColour="#f87171" />
          </div>
          <SectionLabel>Hourly picks</SectionLabel>
          <Sparkline hourly={data?.orders.hourly || {}} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 11, color: '#475569' }}>08:00</span>
            <span style={{ fontSize: 11, color: '#475569' }}>Now</span>
            <span style={{ fontSize: 11, color: '#334155' }}>17:30</span>
          </div>
        </>
      )}
    </Card>
  )
}

function VeeqoStockWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  return (
    <Card>
      <Tag label="Veeqo — Inventory" type="veeqo" />
      <SectionLabel>Stock alerts</SectionLabel>
      {loading ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : (
        <>
          {[
            { label: 'Critical (<10)', value: `${data?.stock.critical ?? '--'} SKUs`, colour: '#f87171', dot: '#f87171' },
            { label: 'Low (<50)', value: `${data?.stock.low ?? '--'} SKUs`, colour: '#f59e0b', dot: '#f59e0b' },
            { label: 'Healthy', value: `${fmt(data?.stock.healthy)} SKUs`, colour: '#22c55e', dot: '#22c55e' },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #111820' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.dot, flexShrink: 0, display: 'inline-block' }} />
                <span style={{ fontSize: 13, color: '#94a3b8' }}>{r.label}</span>
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: r.colour }}>{r.value}</span>
            </div>
          ))}
          <div style={{ fontSize: 12, color: '#475569', marginTop: 8 }}>
            Total SKUs: <span style={{ color: '#94a3b8' }}>{fmt(data?.stock.total)}</span>
          </div>
          {(data?.stock.lowItems?.length ?? 0) > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ fontSize: 11, color: '#475569', cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase' }}>View low stock items</summary>
              <div style={{ marginTop: 6 }}>
                {data!.stock.lowItems.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', padding: '4px 0', borderBottom: '1px solid #111820' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{item.name}</span>
                    <span style={{ color: item.qty < 10 ? '#f87171' : '#f59e0b' }}>{item.qty} left</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </Card>
  )
}

function VeeqoStockValueWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  const warehouses = data?.stockByWarehouse || []
  const total = data?.totalStockValue ?? 0
  const totalUnits = warehouses.reduce((s, w) => s + w.units, 0)
  const maxValue = Math.max(...warehouses.map(w => w.value), 1)
  return (
    <Card>
      <Tag label="Veeqo — Inventory" type="veeqo" />
      <SectionLabel>Stock Value by Warehouse</SectionLabel>
      {loading ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !warehouses.length ? (
        <div style={{ fontSize: 13, color: '#475569' }}>No stock data</div>
      ) : (
        <>
          <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #1e2530' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#475569', textTransform: 'uppercase', marginBottom: 4 }}>Total Stock Value</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#f1f5f9', lineHeight: 1 }}>{fmtRev(total)}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{fmt(totalUnits)} units across {warehouses.length} warehouses</div>
          </div>
          {warehouses.map((wh, i) => {
            const pctOfTotal = total ? (wh.value / total) * 100 : 0
            const barPct = (wh.value / maxValue) * 100
            return (
              <div key={wh.name} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: '#94a3b8' }}>{wh.name}</span>
                  <span style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600 }}>{fmtRev(wh.value)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ProgressBar pct={barPct} colour="#38bdf8" />
                  <span style={{ fontSize: 12, color: '#64748b', width: 70, textAlign: 'right', flexShrink: 0 }}>{fmt(wh.units)} units</span>
                </div>
              </div>
            )
          })}
        </>
      )}
    </Card>
  )
}

function AmazonWidget({ data, loading }: { data?: AmazonData; loading: boolean }) {
  return (
    <Card>
      <Tag label="Amazon SP-API" type="amazon" />
      <SectionLabel>Orders & Revenue</SectionLabel>
      {loading ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <MetricBlock label="Total Orders" value={fmt(data?.orders.total)} />
            <MetricBlock label="Revenue" value={fmtRev(data?.orders.revenue)} />
          </div>
          <div style={{ borderTop: '1px solid #1e2530', paddingTop: 10 }}>
            {[
              { label: 'UK', orders: data?.orders.ukOrders, rev: data?.orders.ukRevenue },
              { label: 'EU', orders: data?.orders.euOrders, rev: data?.orders.euRevenue },
            ].map(ch => (
              <div key={ch.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #111820', fontSize: 13 }}>
                <span style={{ color: '#64748b' }}>Amazon {ch.label}</span>
                <span style={{ color: '#f59e0b' }}>{fmt(ch.orders)} orders</span>
                <span style={{ color: '#f1f5f9' }}>{fmtRev(ch.rev)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#475569', marginBottom: 2 }}>CANCELLED</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#f87171' }}>{data?.returns.cancelled ?? '--'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#475569', marginBottom: 2 }}>SELLER RATING</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>{data?.rating.score != null ? data.rating.score + '%' : '--'}</div>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}

function EbayWidget({ data, loading }: { data?: EbayData; loading: boolean }) {
  return (
    <Card>
      <Tag label="eBay API" type="ebay" />
      <SectionLabel>Orders & Revenue</SectionLabel>
      {loading ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <MetricBlock label="Orders" value={fmt(data?.orders.total)} />
            <MetricBlock label="Revenue" value={fmtRev(data?.orders.revenue)} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #1e2530', paddingTop: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: '#475569', marginBottom: 2 }}>RETURNS</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#f87171' }}>{data?.returns.returns ?? '--'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#475569', marginBottom: 2 }}>CANCELLED</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#f87171' }}>{data?.returns.cancelled ?? '--'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#475569', marginBottom: 2 }}>FEEDBACK</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#22c55e' }}>{data?.rating.score ?? '--'}%</div>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}

function SheetsWidget({ data, loading }: { data?: SheetsData; loading: boolean }) {
  const barColours = ['#38bdf8', '#a78bfa', '#4ade80', '#f59e0b', '#f87171', '#22c55e']
  return (
    <Card>
      <Tag label="Google Sheets" type="sheets" />
      <SectionLabel>Targets vs Actual</SectionLabel>
      {loading ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !data?.metrics.length ? (
        <div style={{ fontSize: 13, color: '#475569' }}>No data — check sheet format: Metric | Target | Actual | Unit</div>
      ) : (
        <>
          {data.metrics.map((m, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: '#64748b' }}>{m.metric}</span>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>
                  {m.unit === '£' || m.unit === '$' ? m.unit : ''}{fmt(m.actual)} / {m.unit === '£' || m.unit === '$' ? m.unit : ''}{fmt(m.target)}{m.unit && m.unit !== '£' && m.unit !== '$' ? ' ' + m.unit : ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ProgressBar pct={m.pct} colour={barColours[i % barColours.length]} />
                <span style={{ fontSize: 12, color: m.pct >= 90 ? '#22c55e' : m.pct >= 70 ? '#f59e0b' : '#f87171', width: 36, textAlign: 'right', flexShrink: 0 }}>{m.pct}%</span>
              </div>
            </div>
          ))}
          {data.lastSync && (
            <div style={{ fontSize: 11, color: '#334155', marginTop: 4 }}>
              Synced {new Date(data.lastSync).toLocaleTimeString('en-GB')}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function ReturnsWidget({ amazon, ebay, loading }: { amazon?: AmazonData; ebay?: EbayData; loading: boolean }) {
  const rows = [
    { ch: 'Amazon UK', returns: 0, cancels: amazon?.returns.cancelled ?? 0 },
    { ch: 'eBay UK', returns: ebay?.returns.returns ?? 0, cancels: ebay?.returns.cancelled ?? 0 },
  ]
  const totalOrders = (amazon?.orders.total ?? 0) + (ebay?.orders.total ?? 0)
  const totalReturns = rows.reduce((s, r) => s + r.returns, 0)
  const returnRate = totalOrders ? ((totalReturns / totalOrders) * 100).toFixed(1) : '--'

  return (
    <Card>
      <div style={{ marginBottom: 8, display: 'flex', gap: 4 }}>
        <Tag label="Amazon" type="amazon" />
        <Tag label="eBay" type="ebay" />
      </div>
      <SectionLabel>Returns & Cancellations</SectionLabel>
      {loading ? (
        <div className="shimmer" style={{ height: 60 }} />
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['Channel','Returns','Cancels'].map(h => (
                <th key={h} style={{ fontSize: 11, letterSpacing: '0.1em', color: '#475569', textTransform: 'uppercase', textAlign: 'left', paddingBottom: 8, borderBottom: '1px solid #1e2530' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ch}>
                  <td style={{ padding: '7px 0', borderBottom: '1px solid #111820', color: '#94a3b8' }}>{r.ch}</td>
                  <td style={{ padding: '7px 0', borderBottom: '1px solid #111820', color: r.returns > 5 ? '#f87171' : '#94a3b8' }}>{r.returns}</td>
                  <td style={{ padding: '7px 0', borderBottom: '1px solid #111820', color: r.cancels > 5 ? '#f87171' : '#e2e8f0', textAlign: 'right' }}>{r.cancels}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>Return rate</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#f59e0b' }}>{returnRate}{returnRate !== '--' ? '%' : ''}</span>
          </div>
        </>
      )}
    </Card>
  )
}

// ─── Default layouts ──────────────────────────────────────────────────────────
const defaultLayouts: Layouts = {
  lg: [
    { i: 'veeqo-orders',       x: 0, y: 0,  w: 4, h: 4 },
    { i: 'veeqo-channels',     x: 4, y: 0,  w: 4, h: 6 },
    { i: 'veeqo-orders-by-ch', x: 8, y: 0,  w: 4, h: 6 },
    { i: 'veeqo-shift',        x: 0, y: 4,  w: 4, h: 7 },
    { i: 'veeqo-top-skus',     x: 4, y: 6,  w: 4, h: 7 },
    { i: 'veeqo-skus-by-ch',   x: 8, y: 6,  w: 4, h: 7 },
    { i: 'veeqo-stock',        x: 0, y: 11, w: 4, h: 7 },
    { i: 'veeqo-stock-value',  x: 4, y: 13, w: 4, h: 8 },
    { i: 'amazon',             x: 8, y: 13, w: 4, h: 7 },
    { i: 'ebay',               x: 0, y: 18, w: 4, h: 5 },
    { i: 'returns',            x: 4, y: 21, w: 4, h: 5 },
    { i: 'sheets',             x: 8, y: 20, w: 4, h: 5 },
  ]
}
const LAYOUT_KEY = 'opscore_layouts_v3'

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [range, setRange] = useState<DateRange>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [layouts, setLayouts] = useState<Layouts>(() => {
    if (typeof window === 'undefined') return defaultLayouts
    try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '') } catch { return defaultLayouts }
  })

  const [veeqoData, setVeeqoData]   = useState<VeeqoData>()
  const [amazonData, setAmazonData] = useState<AmazonData>()
  const [ebayData, setEbayData]     = useState<EbayData>()
  const [sheetsData, setSheetsData] = useState<SheetsData>()

  const [statuses, setStatuses] = useState<Record<string, ApiStatus>>({
    veeqo: 'idle', amazon: 'idle', ebay: 'idle', sheets: 'idle'
  })
  const [lastRefresh, setLastRefresh] = useState<string>('never')
  const timerRef = useRef<NodeJS.Timeout>()

  const setStatus = (key: string, s: ApiStatus) =>
    setStatuses(prev => ({ ...prev, [key]: s }))

  const buildQueryString = useCallback((r: DateRange) => {
    if (r === 'custom' && customFrom && customTo) {
      return `range=custom&since=${customFrom}&until=${customTo}`
    }
    return `range=${r}`
  }, [customFrom, customTo])

  const fetchAll = useCallback(async (r: DateRange) => {
    setLastRefresh(new Date().toLocaleTimeString('en-GB'))
    const qs = r === 'custom' && customFrom && customTo
      ? `range=custom&since=${customFrom}&until=${customTo}`
      : `range=${r}`

    // Veeqo
    setStatus('veeqo', 'loading')
    fetch(`/api/veeqo?${qs}`)
      .then(res => res.json())
      .then(d => { if (d.ok) { setVeeqoData(d); setStatus('veeqo', 'ok') } else { setStatus('veeqo', 'error'); console.error('Veeqo:', d.error) } })
      .catch(() => setStatus('veeqo', 'error'))

    // Amazon
    setStatus('amazon', 'loading')
    fetch(`/api/amazon?${qs}`)
      .then(res => res.json())
      .then(d => { if (d.ok) { setAmazonData(d); setStatus('amazon', 'ok') } else { setStatus('amazon', 'error'); console.error('Amazon:', d.error) } })
      .catch(() => setStatus('amazon', 'error'))

    // eBay
    setStatus('ebay', 'loading')
    fetch(`/api/ebay?${qs}`)
      .then(res => res.json())
      .then(d => { if (d.ok) { setEbayData(d); setStatus('ebay', 'ok') } else { setStatus('ebay', 'error'); console.error('eBay:', d.error) } })
      .catch(() => setStatus('ebay', 'error'))

    // Sheets
    setStatus('sheets', 'loading')
    fetch(`/api/sheets`)
      .then(res => res.json())
      .then(d => { if (d.ok) { setSheetsData(d); setStatus('sheets', 'ok') } else { setStatus('sheets', 'error'); console.error('Sheets:', d.error) } })
      .catch(() => setStatus('sheets', 'error'))
  }, [customFrom, customTo])

  useEffect(() => {
    fetchAll(range)
    const interval = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL || '60') * 1000
    timerRef.current = setInterval(() => fetchAll(range), interval)
    return () => clearInterval(timerRef.current)
  }, [range, fetchAll])

  const handleRangeChange = (r: DateRange) => {
    setRange(r)
    if (timerRef.current) clearInterval(timerRef.current)
    fetchAll(r)
    const interval = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL || '60') * 1000
    timerRef.current = setInterval(() => fetchAll(r), interval)
  }

  const handleCustomApply = () => {
    if (!customFrom || !customTo) return
    setRange('custom')
    if (timerRef.current) clearInterval(timerRef.current)
    fetchAll('custom')
    const interval = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL || '60') * 1000
    timerRef.current = setInterval(() => fetchAll('custom'), interval)
  }

  const handleLayoutChange = (_: Layout[], all: Layouts) => {
    setLayouts(all)
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(all))
  }

  const resetLayout = () => {
    setLayouts(defaultLayouts)
    localStorage.removeItem(LAYOUT_KEY)
  }

  const isLoading = (key: string) => statuses[key] === 'loading'

  const presetLabels: Record<string, string> = { today: 'Today', yesterday: 'Yesterday', '7days': '7 Days', '30days': '30 Days' }

  const inputStyle: React.CSSProperties = {
    fontSize: 11, padding: '4px 8px', borderRadius: 3,
    border: '1px solid #1e2530', background: '#0f1419', color: '#e2e8f0',
    fontFamily: 'inherit', outline: 'none'
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0c0f', padding: 20 }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #1e2530' }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.2em', color: '#64748b', textTransform: 'uppercase' }}>
          OPS<span style={{ color: '#38bdf8' }}>CORE</span> &mdash; Command Centre
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>

          {/* Preset date range buttons */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(Object.keys(presetLabels) as DateRange[]).map(r => (
              <button key={r} onClick={() => handleRangeChange(r)} style={{
                fontSize: 11, padding: '5px 12px', borderRadius: 3,
                border: `1px solid ${range === r ? '#2a3a50' : '#1e2530'}`,
                background: range === r ? '#1e2530' : 'transparent',
                color: range === r ? '#38bdf8' : '#475569',
                cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.1em', textTransform: 'uppercase'
              }}>{presetLabels[r]}</button>
            ))}
          </div>

          {/* Custom date range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              style={{ ...inputStyle, colorScheme: 'dark' }}
            />
            <span style={{ fontSize: 11, color: '#475569' }}>to</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              style={{ ...inputStyle, colorScheme: 'dark' }}
            />
            <button onClick={handleCustomApply} style={{
              fontSize: 11, padding: '5px 12px', borderRadius: 3,
              border: `1px solid ${range === 'custom' ? '#2a3a50' : '#1e2530'}`,
              background: range === 'custom' ? '#1e2530' : 'transparent',
              color: range === 'custom' ? '#38bdf8' : '#475569',
              cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.1em', textTransform: 'uppercase',
              opacity: customFrom && customTo ? 1 : 0.4
            }}>Apply</button>
          </div>

          {/* API status */}
          <div style={{ display: 'flex', gap: 12 }}>
            {(['veeqo','amazon','ebay','sheets'] as const).map(k => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#64748b' }}>
                <StatusDot status={statuses[k]} />
                <span style={{ textTransform: 'capitalize' }}>{k}</span>
              </div>
            ))}
          </div>

          <button onClick={() => fetchAll(range)} style={{ fontSize: 11, padding: '5px 12px', background: '#1e2530', border: '1px solid #2a3a50', color: '#38bdf8', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Refresh
          </button>
          <button onClick={resetLayout} style={{ fontSize: 11, padding: '5px 12px', background: 'transparent', border: '1px solid #1e2530', color: '#475569', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Reset Layout
          </button>
          <span style={{ fontSize: 11, color: '#334155' }}>Last: {lastRefresh}</span>
        </div>
      </div>

      {/* Tip bar */}
      <div style={{ fontSize: 11, color: '#334155', marginBottom: 12, letterSpacing: '0.08em' }}>
        Drag panels by their header · Resize from bottom-right corner · Layout auto-saves
      </div>

      {/* Grid */}
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        onLayoutChange={handleLayoutChange}
        breakpoints={{ lg: 1200, md: 996, sm: 768 }}
        cols={{ lg: 12, md: 8, sm: 4 }}
        rowHeight={40}
        draggableHandle=".drag-handle"
        margin={[10, 10]}
      >
        <div key="veeqo-orders">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, zIndex: 1 }} />
          <VeeqoOrdersWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="veeqo-channels">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, zIndex: 1 }} />
          <VeeqoChannelsWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="veeqo-orders-by-ch">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, zIndex: 1 }} />
          <VeeqoOrdersByChannelWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="veeqo-shift">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, zIndex: 1 }} />
          <VeeqoShiftWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="veeqo-top-skus">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, zIndex: 1 }} />
          <VeeqoTopSkusWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="veeqo-skus-by-ch">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, zIndex: 1 }} />
          <VeeqoTopSkusByChannelWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="veeqo-stock">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, zIndex: 1 }} />
          <VeeqoStockWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="veeqo-stock-value">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, zIndex: 1 }} />
          <VeeqoStockValueWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="amazon">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, zIndex: 1 }} />
          <AmazonWidget data={amazonData} loading={isLoading('amazon')} />
        </div>
        <div key="ebay">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, zIndex: 1 }} />
          <EbayWidget data={ebayData} loading={isLoading('ebay')} />
        </div>
        <div key="returns">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, zIndex: 1 }} />
          <ReturnsWidget amazon={amazonData} ebay={ebayData} loading={isLoading('amazon') || isLoading('ebay')} />
        </div>
        <div key="sheets">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, zIndex: 1 }} />
          <SheetsWidget data={sheetsData} loading={isLoading('sheets')} />
        </div>
      </ResponsiveGridLayout>
    </div>
  )
}
