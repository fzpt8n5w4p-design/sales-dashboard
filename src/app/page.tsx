'use client'

import { useState, useEffect, useRef, createContext, useContext } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
import Nav from './components/Nav'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'
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
  orders: { total: number; shipped: number; pending: number; revenue: number; hourly: Record<number, number>; readyToShip: number }
  prevOrders: { total: number; revenue: number }
  stock: { critical: number; low: number; healthy: number; total: number; lowItems: { name: string; qty: number }[] }
  shift: { picks: number; packs: number; lists: number; errors: number }
  channels: ChannelBreakdown[]
  topSkus: SkuBreakdown[]
  topSkusByRevenue: SkuBreakdown[]
  totalUnitsSold: number
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
interface GoogleAdsCampaign { name: string; status: string; impressions: number; clicks: number; spend: number; conversions: number; convValue: number; roas: number }
interface GoogleAdsData {
  account: { impressions: number; clicks: number; spend: number; conversions: number; convValue: number; ctr: number; avgCpc: number; costPerConv: number; roas: number }
  campaigns: GoogleAdsCampaign[]
}
interface ShipmentEvent { type: 'departure' | 'arrival'; summary: string; container: string; reference: string; date: string; daysAway: number; destination: string }
interface ShippingData { events: ShipmentEvent[]; upcoming: ShipmentEvent[]; past: ShipmentEvent[]; nextArrival?: ShipmentEvent; total: number }
interface CancellationChannel { name: string; count: number; value: number }
interface CancellationsData { total: number; totalValue: number; channels: CancellationChannel[] }
interface DailyPoint { date: string; label: string; orders: number; revenue: number; units: number }
interface HistoryData { daily: DailyPoint[]; totalOrders: number; totalRevenue: number; totalUnitsSold: number }

// ─── Apple Design Tokens ──────────────────────────────────────────────────────
const t = {
  bg: '#000000',
  card: 'rgba(28, 28, 30, 0.8)',
  cardBorder: 'rgba(255, 255, 255, 0.06)',
  cardHover: 'rgba(44, 44, 46, 0.8)',
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

// ─── Display Mode Context ─────────────────────────────────────────────────────
interface DisplayMode {
  hideValues: boolean
  multiplier: number
  hiddenTiles: Set<string>
  toggleTile: (id: string) => void
}
const DisplayCtx = createContext<DisplayMode>({ hideValues: false, multiplier: 1, hiddenTiles: new Set(), toggleTile: () => {} })
const useDisplay = () => useContext(DisplayCtx)

// ─── Helpers ──────────────────────────────────────────────────────────────────
const CUR = process.env.NEXT_PUBLIC_CURRENCY || '£'
const rawFmt = (n?: number) => n != null ? n.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : '--'
const rawFmtRev = (n?: number) => n != null ? CUR + rawFmt(n) : '--'
const pct = (a: number, b: number) => b ? ((a / b) * 100).toFixed(1) + '%' : '--'

// Display-aware helpers — all widgets should use these
// ─── Order Ding Sound ─────────────────────────────────────────────────────────
function playDing() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    // First tone
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(880, ctx.currentTime) // A5
    gain1.gain.setValueAtTime(0.3, ctx.currentTime)
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(ctx.currentTime)
    osc1.stop(ctx.currentTime + 0.4)

    // Second tone (higher, slight delay for a chime effect)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(1318.5, ctx.currentTime + 0.08) // E6
    gain2.gain.setValueAtTime(0, ctx.currentTime)
    gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.08)
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(ctx.currentTime + 0.08)
    osc2.stop(ctx.currentTime + 0.5)

    setTimeout(() => ctx.close(), 600)
  } catch {}
}

function useDisplayFmt() {
  const { hideValues, multiplier } = useDisplay()
  const m = (n?: number) => n != null ? n * multiplier : undefined
  const fmt = (n?: number) => rawFmt(m(n))
  const fmtRev = (n?: number) => hideValues ? '******' : rawFmtRev(m(n))
  return { fmt, fmtRev, hideValues, multiplier, m }
}

function ChangeIndicator({ current, previous, prefix = '', isMoney = false }: { current?: number; previous?: number; prefix?: string; isMoney?: boolean }) {
  const { hideValues } = useDisplay()
  if (isMoney && hideValues) return null
  if (current == null || previous == null || previous === 0) return null
  const change = ((current - previous) / previous) * 100
  const isUp = change > 0
  const isFlat = Math.abs(change) < 0.5
  const colour = isFlat ? t.text3 : isUp ? t.green : t.red
  const arrow = isFlat ? '' : isUp ? '\u25B2' : '\u25BC'
  return (
    <span style={{ fontSize: 12, color: colour, fontWeight: 500, letterSpacing: '-0.01em' }}>
      {arrow} {Math.abs(change).toFixed(1)}% <span style={{ color: t.text3 }}>{prefix ? `vs ${prefix}` : ''}</span>
    </span>
  )
}

function StatusDot({ status }: { status: ApiStatus }) {
  const colours: Record<ApiStatus, string> = {
    ok: t.green, error: t.red, loading: t.text3, idle: 'rgba(255,255,255,0.12)'
  }
  return (
    <span
      className={status === 'ok' ? 'pulse' : ''}
      style={{
        display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
        background: colours[status], flexShrink: 0
      }}
    />
  )
}

function SourceTag({ label, colour }: { label: string; colour: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', padding: '3px 10px',
      borderRadius: 20, display: 'inline-block', marginBottom: 10,
      background: `${colour}18`, color: colour, border: `1px solid ${colour}25`
    }}>{label}</span>
  )
}

const sourceColours: Record<string, string> = {
  veeqo: t.blue, amazon: t.orange, ebay: t.purple, sheets: t.green
}

function Card({ children, tileId }: { children: React.ReactNode; tileId?: string }) {
  const { hiddenTiles, toggleTile } = useDisplay()
  const isHidden = tileId ? hiddenTiles.has(tileId) : false

  return (
    <div style={{
      background: t.card, border: `1px solid ${t.cardBorder}`,
      borderRadius: t.radius, padding: '18px 20px', height: '100%', overflow: 'auto',
      backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
      transition: 'background 0.3s ease', position: 'relative'
    }}>
      {tileId && (
        <button
          onClick={() => toggleTile(tileId)}
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 2,
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            opacity: isHidden ? 0.8 : 0.25, transition: 'opacity 0.2s',
            display: 'flex', alignItems: 'center',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = isHidden ? '0.8' : '0.25' }}
          title={isHidden ? 'Show content' : 'Hide content'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isHidden ? t.red : t.text2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {isHidden ? (
              <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></>
            ) : (
              <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
            )}
          </svg>
        </button>
      )}
      {isHidden ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 60, color: t.text3, fontSize: 13 }}>
          Content hidden
        </div>
      ) : children}
    </div>
  )
}

function MetricBlock({ label, value, sub, subColour }: { label: string; value: React.ReactNode; sub?: React.ReactNode; subColour?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 500, color: t.text2, letterSpacing: '0.02em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: t.text1, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: subColour || t.text3, marginTop: 5, fontWeight: 400 }}>{sub}</div>}
    </div>
  )
}

function ProgressBar({ pct: p, colour }: { pct: number; colour: string }) {
  return (
    <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, p)}%`, height: '100%', background: colour, borderRadius: 3, transition: 'width 0.8s cubic-bezier(0.25, 0.1, 0.25, 1)' }} />
    </div>
  )
}

function Sparkline({ hourly }: { hourly: Record<number, number> }) {
  const hours = Array.from({ length: 10 }, (_, i) => hourly[i + 8] || 0)
  const max = Math.max(...hours, 1)
  const [currentHour, setCurrentHour] = useState(-1)
  useEffect(() => { setCurrentHour(new Date().getHours()) }, [])
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40 }}>
      {hours.map((v, i) => {
        const h = i + 8
        const isCurrent = h === currentHour
        const isFuture = h > currentHour
        return (
          <div key={i} style={{
            flex: 1, borderRadius: 3,
            height: `${Math.max((v / max) * 100, 4)}%`,
            background: isFuture ? 'rgba(255,255,255,0.04)' : isCurrent ? t.blue : `${t.blue}50`,
            opacity: isFuture ? 0.5 : 1,
            transition: 'height 0.8s cubic-bezier(0.25, 0.1, 0.25, 1)'
          }} />
        )
      })}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: t.text2, marginBottom: 12, letterSpacing: '0.01em' }}>{children}</div>
}

function Divider() {
  return <div style={{ height: 1, background: t.separator, margin: '12px 0' }} />
}

// ─── Widget Components ────────────────────────────────────────────────────────
function VeeqoOrdersWidget({ data, loading, range }: { data?: VeeqoData; loading: boolean; range: string }) {
  const showShimmer = loading && !data
  const { fmt, fmtRev, m } = useDisplayFmt()
  const prevLabel = range === '7days' ? 'prev 7d' : range === '30days' ? 'prev 30d' : range === 'yesterday' ? 'day before' : 'yesterday'
  return (
    <Card tileId="veeqo-orders">
      <SourceTag label="Veeqo" colour={sourceColours.veeqo} />
      <SectionTitle>Orders & Revenue</SectionTitle>
      {showShimmer ? (
        <><div className="shimmer" style={{ height: 30, width: '50%', marginBottom: 14 }} /><div className="shimmer" style={{ height: 24, width: '35%' }} /></>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <MetricBlock label="Orders" value={fmt(data?.orders.total)} sub={<>{fmt(data?.orders.shipped)} shipped</>} />
              <div style={{ marginTop: 8 }}>
                <ChangeIndicator current={m(data?.orders.total)} previous={m(data?.prevOrders?.total)} prefix={prevLabel} />
              </div>
            </div>
            <div>
              <MetricBlock label="Revenue" value={fmtRev(data?.orders.revenue)} sub={<>{fmt(data?.orders.pending)} pending</>} subColour={t.orange} />
              <div style={{ marginTop: 8 }}>
                <ChangeIndicator current={m(data?.orders.revenue)} previous={m(data?.prevOrders?.revenue)} prefix={prevLabel} isMoney />
              </div>
            </div>
          </div>
          {data?.prevOrders && (
            <>
              <Divider />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: t.text3, marginBottom: 4 }}>Previous — {prevLabel}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: t.text2, letterSpacing: '-0.02em' }}>{fmt(data.prevOrders.total)} <span style={{ fontSize: 12, fontWeight: 400, color: t.text3 }}>orders</span></div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: t.text3, marginBottom: 4 }}>Previous — {prevLabel}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: t.text2, letterSpacing: '-0.02em' }}>{fmtRev(data.prevOrders.revenue)}</div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  )
}

function ReadyToShipWidget({ count, loading }: { count?: number; loading: boolean }) {
  const showShimmer = loading && count == null
  const { fmt } = useDisplayFmt()
  const qty = count ?? 0
  const [now, setNow] = useState<Date | null>(null)

  // Tick every second for the countdown (only on client)
  useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Calculate countdown to next 3pm cutoff
  const clockReady = now !== null
  const currentTime = now ?? new Date()
  const todayCutoff = new Date(currentTime)
  todayCutoff.setHours(15, 0, 0, 0)
  const todayPast = currentTime.getTime() > todayCutoff.getTime()

  // If past today's 3pm, count down to tomorrow's 3pm
  const nextCutoff = todayPast ? new Date(todayCutoff.getTime() + 24 * 60 * 60 * 1000) : todayCutoff
  const diff = nextCutoff.getTime() - currentTime.getTime()
  const isPast = todayPast
  const isUrgent = !isPast && diff < 60 * 60 * 1000
  const isWarning = !isPast && diff < 2 * 60 * 60 * 1000

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  const secs = Math.floor((diff % (1000 * 60)) / 1000)
  const countdown = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`

  // Determine tile accent colour
  const hasOrders = qty > 0
  const accentColour = isPast && hasOrders ? t.red : isUrgent && hasOrders ? t.red : isWarning && hasOrders ? t.orange : hasOrders ? t.green : t.text3

  // Tile background tints (RGBA)
  const tileBg = isPast && hasOrders ? 'rgba(255,69,58,0.1)' : isUrgent && hasOrders ? 'rgba(255,69,58,0.08)' : isWarning && hasOrders ? 'rgba(255,159,10,0.07)' : hasOrders ? 'rgba(48,209,88,0.07)' : 'transparent'
  const borderColour = isPast && hasOrders ? 'rgba(255,69,58,0.3)' : isUrgent && hasOrders ? 'rgba(255,69,58,0.2)' : isWarning && hasOrders ? 'rgba(255,159,10,0.2)' : hasOrders ? 'rgba(48,209,88,0.15)' : t.cardBorder

  return (
    <Card tileId="ready-to-ship">
      <div style={{
        position: 'absolute', inset: 0, borderRadius: t.radius,
        background: tileBg,
        border: `1.5px solid ${borderColour}`,
        pointerEvents: 'none', transition: 'all 0.5s ease',
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <SourceTag label="Fulfilment" colour={accentColour} />
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: t.text3, fontWeight: 500, letterSpacing: '0.02em' }}>
            {isPast ? 'Next cutoff tomorrow' : 'Ship by 3:00 PM'}
          </div>
          <div style={{
            fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1,
            color: isPast && hasOrders ? t.red : isUrgent && hasOrders ? t.red : isWarning && hasOrders ? t.orange : t.text2,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {clockReady ? countdown : '--:--:--'}
          </div>
        </div>
      </div>
      <SectionTitle>Ready to Ship</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 50 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{
            fontSize: 48, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.03em',
            color: hasOrders ? accentColour : t.text3,
            transition: 'color 0.5s ease',
          }}>{fmt(qty)}</div>
          <div style={{ fontSize: 13, color: t.text2 }}>orders</div>
        </div>
      )}
      <div style={{ fontSize: 12, color: t.text3, marginTop: 10 }}>Wirral Warehouse — excludes FBA</div>
      {isPast && hasOrders && (
        <div style={{ fontSize: 12, fontWeight: 600, color: t.red, marginTop: 8 }}>
          Today&apos;s cutoff passed — {qty} orders still pending
        </div>
      )}
    </Card>
  )
}

function PreOrdersWidget({ count, loading }: { count?: number; loading: boolean }) {
  const showShimmer = loading && count == null
  const { fmt } = useDisplayFmt()
  const qty = count ?? 0
  return (
    <Card tileId="pre-orders">
      <SourceTag label="Pre-Orders" colour={t.purple} />
      <SectionTitle>Awaiting Fulfilment</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 50 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{
            fontSize: 48, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.03em',
            color: qty > 0 ? t.purple : t.text3,
          }}>{fmt(qty)}</div>
          <div style={{ fontSize: 13, color: t.text2 }}>orders</div>
        </div>
      )}
      <div style={{ fontSize: 12, color: t.text3, marginTop: 10 }}>Tagged pre-order with status ready to ship</div>
    </Card>
  )
}

function VeeqoChannelsWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  const showShimmer = loading && !data
  const { fmt, fmtRev, m, multiplier } = useDisplayFmt()
  const channels = data?.channels || []
  const totalRev = channels.reduce((s, c) => s + c.revenue, 0) * multiplier
  const palette = [t.blue, t.orange, t.purple, t.green, t.red, t.teal]
  return (
    <Card tileId="veeqo-channels">
      <SourceTag label="Veeqo" colour={sourceColours.veeqo} />
      <SectionTitle>Revenue by Channel</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !channels.length ? (
        <div style={{ fontSize: 13, color: t.text3 }}>No orders yet</div>
      ) : (
        <>
          {channels.map((ch, i) => {
            const share = totalRev ? (ch.revenue / totalRev) * 100 : 0
            return (
              <div key={ch.name} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 13, color: t.text2 }}>{ch.name}</span>
                  <span style={{ fontSize: 13, color: t.text1, fontWeight: 600, letterSpacing: '-0.01em' }}>{fmtRev(ch.revenue)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ProgressBar pct={share} colour={palette[i % palette.length]} />
                  <span style={{ fontSize: 11, color: t.text3, width: 36, textAlign: 'right', flexShrink: 0 }}>{share.toFixed(0)}%</span>
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
  const showShimmer = loading && !data
  const { fmt, fmtRev, m } = useDisplayFmt()
  const channels = data?.channels || []
  const palette = [t.blue, t.orange, t.purple, t.green, t.red, t.teal]
  const total = m(channels.reduce((s, c) => s + c.orders, 0))
  const pieData = channels.map((ch, i) => ({ name: ch.name, value: ch.orders, fill: palette[i % palette.length] }))

  return (
    <Card tileId="veeqo-orders-by-ch">
      <SourceTag label="Veeqo" colour={sourceColours.veeqo} />
      <SectionTitle>Orders by Channel</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !channels.length ? (
        <div style={{ fontSize: 13, color: t.text3 }}>No orders yet</div>
      ) : (
        <>
          <div style={{ width: '100%', height: 140, position: 'relative' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={38}
                  outerRadius={62}
                  paddingAngle={3}
                  dataKey="value"
                  stroke="none"
                  animationBegin={0}
                  animationDuration={800}
                  animationEasing="ease-out"
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'rgba(28,28,30,0.95)', border: `1px solid ${t.cardBorder}`, borderRadius: t.radiusSm, fontSize: 12, color: t.text1, backdropFilter: 'blur(20px)' }}
                  itemStyle={{ color: t.text2 }}
                  formatter={(value: number, name: string) => [`${value} orders`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: t.text1, letterSpacing: '-0.02em', lineHeight: 1 }}>{fmt(total)}</div>
              <div style={{ fontSize: 10, color: t.text3, marginTop: 2 }}>total</div>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            {channels.map((ch, i) => (
              <div key={ch.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: palette[i % palette.length], flexShrink: 0, display: 'inline-block' }} />
                  <span style={{ fontSize: 12, color: t.text2 }}>{ch.name}</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: t.text1 }}>{fmt(ch.orders)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

function VeeqoTopSkusWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  const { fmt, fmtRev } = useDisplayFmt()
  const showShimmer = loading && !data
  const skus = data?.topSkus || []
  return (
    <Card tileId="veeqo-top-skus">
      <SourceTag label="Veeqo" colour={sourceColours.veeqo} />
      <SectionTitle>Best Selling SKUs</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !skus.length ? (
        <div style={{ fontSize: 13, color: t.text3 }}>No sales yet</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Product', 'Qty', 'Revenue'].map(h => (
                <th key={h} style={{ fontSize: 11, fontWeight: 500, color: t.text3, textAlign: h === 'Product' ? 'left' : 'right', paddingBottom: 10, borderBottom: `1px solid ${t.separator}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skus.slice(0, 8).map((s, i) => (
              <tr key={i}>
                <td style={{ padding: '8px 8px 8px 0', borderBottom: `1px solid ${t.separator}`, color: t.text2, fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</td>
                <td style={{ padding: '8px 0', borderBottom: `1px solid ${t.separator}`, color: t.text1, fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{s.qty}</td>
                <td style={{ padding: '8px 0', borderBottom: `1px solid ${t.separator}`, color: t.blue, fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{fmtRev(s.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function VeeqoTopSkusByRevenueWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  const { fmt, fmtRev } = useDisplayFmt()
  const showShimmer = loading && !data
  const skus = data?.topSkusByRevenue || []
  return (
    <Card tileId="veeqo-top-skus-rev">
      <SourceTag label="Veeqo" colour={sourceColours.veeqo} />
      <SectionTitle>Top SKUs by Revenue</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !skus.length ? (
        <div style={{ fontSize: 13, color: t.text3 }}>No sales yet</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Product', 'Revenue', 'Qty'].map(h => (
                <th key={h} style={{ fontSize: 11, fontWeight: 500, color: t.text3, textAlign: h === 'Product' ? 'left' : 'right', paddingBottom: 10, borderBottom: `1px solid ${t.separator}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skus.slice(0, 8).map((s, i) => (
              <tr key={i}>
                <td style={{ padding: '8px 8px 8px 0', borderBottom: `1px solid ${t.separator}`, color: t.text2, fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</td>
                <td style={{ padding: '8px 0', borderBottom: `1px solid ${t.separator}`, color: t.green, fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{fmtRev(s.revenue)}</td>
                <td style={{ padding: '8px 0', borderBottom: `1px solid ${t.separator}`, color: t.text1, fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{s.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function UnitsSoldWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  const { fmt } = useDisplayFmt()
  const showShimmer = loading && !data
  const channels = data?.channels || []
  const totalUnits = data?.totalUnitsSold ?? 0
  const palette = [t.blue, t.orange, t.purple, t.green, t.red, t.teal]

  // Compute units per channel from order count (line items not available, so use orders as proxy)
  // Actually totalUnitsSold comes from line items, but per-channel breakdown we have order counts
  // We'll show the total prominently and channels below
  return (
    <Card tileId="units-sold">
      <SourceTag label="Veeqo" colour={sourceColours.veeqo} />
      <SectionTitle>Units Sold</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 50 }} />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: t.text1, lineHeight: 1, letterSpacing: '-0.03em' }}>{fmt(totalUnits)}</div>
            <div style={{ fontSize: 13, color: t.text2 }}>units</div>
          </div>
          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 12, color: t.text2, cursor: 'pointer', fontWeight: 500, listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: t.text3, transition: 'transform 0.2s' }}>&#9654;</span>
              Channel breakdown
            </summary>
            <div style={{ marginTop: 8 }}>
              {channels.map((ch, i) => (
                <div key={ch.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: palette[i % palette.length], flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ fontSize: 12, color: t.text2 }}>{ch.name}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: t.text1 }}>{fmt(ch.orders)} orders</span>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </Card>
  )
}

function VeeqoTopSkusByChannelWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  const { fmt, fmtRev } = useDisplayFmt()
  const showShimmer = loading && !data
  const byChannel = data?.topSkusByChannel || {}
  const channelNames = Object.keys(byChannel)
  const palette = [t.blue, t.orange, t.purple, t.green, t.red, t.teal]
  const channelColours: Record<string, string> = {}
  channelNames.forEach((n, i) => { channelColours[n] = palette[i % palette.length] })

  return (
    <Card tileId="veeqo-skus-by-ch">
      <SourceTag label="Veeqo" colour={sourceColours.veeqo} />
      <SectionTitle>Top SKUs by Channel</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !channelNames.length ? (
        <div style={{ fontSize: 13, color: t.text3 }}>No sales yet</div>
      ) : (
        <>
          {channelNames.map(ch => (
            <div key={ch} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: channelColours[ch], marginBottom: 8 }}>{ch}</div>
              {byChannel[ch].slice(0, 3).map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${t.separator}` }}>
                  <span style={{ fontSize: 12, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '50%' }}>{s.name}</span>
                  <span style={{ fontSize: 12, color: t.text3 }}>{s.qty} sold</span>
                  <span style={{ fontSize: 12, color: t.text1, fontWeight: 600 }}>{fmtRev(s.revenue)}</span>
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
  const { fmt } = useDisplayFmt()
  const showShimmer = loading && !data
  return (
    <Card tileId="veeqo-shift">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <SourceTag label="Veeqo" colour={sourceColours.veeqo} />
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: t.text3, fontWeight: 500 }}>Shift ends</div>
          <div style={{ fontSize: 17, color: t.blue, fontWeight: 700, letterSpacing: '-0.02em' }}>17:30</div>
        </div>
      </div>
      <SectionTitle>Warehouse Shift</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 60 }} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
            <MetricBlock label="Picks" value={fmt(data?.shift.picks)} sub={`${data?.shift.lists || 0} lists`} />
            <MetricBlock label="Packs" value={fmt(data?.shift.packs)} sub={pct(data?.shift.packs || 0, data?.shift.picks || 1) + ' done'} />
            <MetricBlock label="Errors" value={String(data?.shift.errors ?? '--')} subColour={t.red} />
          </div>
          <SectionTitle>Hourly Activity</SectionTitle>
          <Sparkline hourly={data?.orders.hourly || {}} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 11, color: t.text3 }}>08:00</span>
            <span style={{ fontSize: 11, color: t.text2 }}>Now</span>
            <span style={{ fontSize: 11, color: t.text3 }}>17:30</span>
          </div>
        </>
      )}
    </Card>
  )
}

function VeeqoStockWidget({ data, loading }: { data?: VeeqoData; loading: boolean }) {
  const { fmt } = useDisplayFmt()
  const showShimmer = loading && !data
  const rows = [
    { label: 'Critical', sub: 'Under 10 units', value: `${data?.stock.critical ?? '--'}`, colour: t.red },
    { label: 'Low', sub: 'Under 50 units', value: `${data?.stock.low ?? '--'}`, colour: t.orange },
    { label: 'Healthy', sub: '50+ units', value: `${fmt(data?.stock.healthy)}`, colour: t.green },
  ]
  return (
    <Card tileId="veeqo-stock">
      <SourceTag label="Inventory" colour={sourceColours.veeqo} />
      <SectionTitle>Stock Alerts</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : (
        <>
          {rows.map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${t.separator}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.colour, flexShrink: 0, display: 'inline-block' }} />
                <div>
                  <div style={{ fontSize: 13, color: t.text2 }}>{r.label}</div>
                  <div style={{ fontSize: 11, color: t.text3 }}>{r.sub}</div>
                </div>
              </div>
              <span style={{ fontSize: 17, fontWeight: 700, color: r.colour, letterSpacing: '-0.02em' }}>{r.value}</span>
            </div>
          ))}
          <div style={{ fontSize: 12, color: t.text3, marginTop: 10 }}>
            {fmt(data?.stock.total)} total SKUs
          </div>
          {(data?.stock.lowItems?.length ?? 0) > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 12, color: t.text2, cursor: 'pointer', fontWeight: 500 }}>View low stock items</summary>
              <div style={{ marginTop: 8 }}>
                {data!.stock.lowItems.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: t.text2, padding: '5px 0', borderBottom: `1px solid ${t.separator}` }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{item.name}</span>
                    <span style={{ color: item.qty < 10 ? t.red : t.orange, fontWeight: 600 }}>{item.qty}</span>
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
  const { fmt, fmtRev } = useDisplayFmt()
  const showShimmer = loading && !data
  const warehouses = data?.stockByWarehouse || []
  const total = data?.totalStockValue ?? 0
  const totalUnits = warehouses.reduce((s, w) => s + w.units, 0)
  const maxValue = Math.max(...warehouses.map(w => w.value), 1)
  return (
    <Card tileId="veeqo-stock-value">
      <SourceTag label="Inventory" colour={sourceColours.veeqo} />
      <SectionTitle>Stock Value</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !warehouses.length ? (
        <div style={{ fontSize: 13, color: t.text3 }}>No stock data</div>
      ) : (
        <>
          <div style={{ marginBottom: 18, paddingBottom: 14, borderBottom: `1px solid ${t.separator}` }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: t.text1, lineHeight: 1, letterSpacing: '-0.03em' }}>{fmtRev(total)}</div>
            <div style={{ fontSize: 13, color: t.text3, marginTop: 6 }}>{fmt(totalUnits)} units across {warehouses.length} locations</div>
          </div>
          {warehouses.map(wh => {
            const barPct = (wh.value / maxValue) * 100
            return (
              <div key={wh.name} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 13, color: t.text2 }}>{wh.name}</span>
                  <span style={{ fontSize: 13, color: t.text1, fontWeight: 600, letterSpacing: '-0.01em' }}>{fmtRev(wh.value)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ProgressBar pct={barPct} colour={t.blue} />
                  <span style={{ fontSize: 11, color: t.text3, width: 70, textAlign: 'right', flexShrink: 0 }}>{fmt(wh.units)} units</span>
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
  const { fmt, fmtRev } = useDisplayFmt()
  const showShimmer = loading && !data
  return (
    <Card tileId="amazon">
      <SourceTag label="Amazon" colour={sourceColours.amazon} />
      <SectionTitle>Orders & Revenue</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <MetricBlock label="Total Orders" value={fmt(data?.orders.total)} />
            <MetricBlock label="Revenue" value={fmtRev(data?.orders.revenue)} />
          </div>
          <Divider />
          <div style={{ paddingTop: 4 }}>
            {[
              { label: 'UK', orders: data?.orders.ukOrders, rev: data?.orders.ukRevenue },
              { label: 'EU', orders: data?.orders.euOrders, rev: data?.orders.euRevenue },
            ].map(ch => (
              <div key={ch.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${t.separator}`, fontSize: 13 }}>
                <span style={{ color: t.text2 }}>Amazon {ch.label}</span>
                <span style={{ color: t.orange }}>{fmt(ch.orders)} orders</span>
                <span style={{ color: t.text1, fontWeight: 600 }}>{fmtRev(ch.rev)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: t.text3, marginBottom: 3 }}>Cancelled</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: t.red, letterSpacing: '-0.02em' }}>{data?.returns.cancelled ?? '--'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: t.text3, marginBottom: 3 }}>Seller Rating</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: t.text1, letterSpacing: '-0.02em' }}>{data?.rating.score != null ? data.rating.score + '%' : '--'}</div>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}

function EbayWidget({ data, loading }: { data?: EbayData; loading: boolean }) {
  const { fmt, fmtRev } = useDisplayFmt()
  const showShimmer = loading && !data
  return (
    <Card tileId="ebay">
      <SourceTag label="eBay" colour={sourceColours.ebay} />
      <SectionTitle>Orders & Revenue</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <MetricBlock label="Orders" value={fmt(data?.orders.total)} />
            <MetricBlock label="Revenue" value={fmtRev(data?.orders.revenue)} />
          </div>
          <Divider />
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: t.text3, marginBottom: 3 }}>Returns</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: t.red, letterSpacing: '-0.02em' }}>{data?.returns.returns ?? '--'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: t.text3, marginBottom: 3 }}>Cancelled</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: t.red, letterSpacing: '-0.02em' }}>{data?.returns.cancelled ?? '--'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: t.text3, marginBottom: 3 }}>Feedback</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: t.green, letterSpacing: '-0.02em' }}>{data?.rating.score ?? '--'}%</div>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}

function SheetsWidget({ data, loading }: { data?: SheetsData; loading: boolean }) {
  const { fmt, fmtRev } = useDisplayFmt()
  const showShimmer = loading && !data
  const palette = [t.blue, t.purple, t.green, t.orange, t.red, t.teal]
  return (
    <Card tileId="sheets">
      <SourceTag label="Sheets" colour={sourceColours.sheets} />
      <SectionTitle>Targets vs Actual</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !data?.metrics.length ? (
        <div style={{ fontSize: 13, color: t.text3 }}>No data available</div>
      ) : (
        <>
          {data.metrics.map((m, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 13, color: t.text2 }}>{m.metric}</span>
                <span style={{ fontSize: 12, color: t.text3 }}>
                  {m.unit === '£' || m.unit === '$' ? m.unit : ''}{fmt(m.actual)} / {m.unit === '£' || m.unit === '$' ? m.unit : ''}{fmt(m.target)}{m.unit && m.unit !== '£' && m.unit !== '$' ? ' ' + m.unit : ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ProgressBar pct={m.pct} colour={palette[i % palette.length]} />
                <span style={{ fontSize: 12, fontWeight: 600, color: m.pct >= 90 ? t.green : m.pct >= 70 ? t.orange : t.red, width: 36, textAlign: 'right', flexShrink: 0 }}>{m.pct}%</span>
              </div>
            </div>
          ))}
          {data.lastSync && (
            <div style={{ fontSize: 11, color: t.text3, marginTop: 6 }}>
              Synced {new Date(data.lastSync).toLocaleTimeString('en-GB')}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function ReturnsWidget({ amazon, ebay, loading }: { amazon?: AmazonData; ebay?: EbayData; loading: boolean }) {
  const { fmt } = useDisplayFmt()
  const showShimmer = loading && !amazon && !ebay
  const rows = [
    { ch: 'Amazon UK', returns: 0, cancels: amazon?.returns.cancelled ?? 0 },
    { ch: 'eBay UK', returns: ebay?.returns.returns ?? 0, cancels: ebay?.returns.cancelled ?? 0 },
  ]
  const totalOrders = (amazon?.orders.total ?? 0) + (ebay?.orders.total ?? 0)
  const totalReturns = rows.reduce((s, r) => s + r.returns, 0)
  const returnRate = totalOrders ? ((totalReturns / totalOrders) * 100).toFixed(1) : '--'

  return (
    <Card tileId="returns">
      <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
        <SourceTag label="Amazon" colour={sourceColours.amazon} />
        <SourceTag label="eBay" colour={sourceColours.ebay} />
      </div>
      <SectionTitle>Returns & Cancellations</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 60 }} />
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['Channel','Returns','Cancels'].map(h => (
                <th key={h} style={{ fontSize: 11, fontWeight: 500, color: t.text3, textAlign: 'left', paddingBottom: 10, borderBottom: `1px solid ${t.separator}` }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ch}>
                  <td style={{ padding: '9px 0', borderBottom: `1px solid ${t.separator}`, color: t.text2 }}>{r.ch}</td>
                  <td style={{ padding: '9px 0', borderBottom: `1px solid ${t.separator}`, color: r.returns > 5 ? t.red : t.text2 }}>{r.returns}</td>
                  <td style={{ padding: '9px 0', borderBottom: `1px solid ${t.separator}`, color: r.cancels > 5 ? t.red : t.text1, textAlign: 'right', fontWeight: 600 }}>{r.cancels}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <span style={{ fontSize: 12, color: t.text3 }}>Return rate</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: t.orange, letterSpacing: '-0.02em' }}>{returnRate}{returnRate !== '--' ? '%' : ''}</span>
          </div>
        </>
      )}
    </Card>
  )
}

function GoogleAdsWidget({ data, loading }: { data?: GoogleAdsData; loading: boolean }) {
  const { fmt, fmtRev } = useDisplayFmt()
  const showShimmer = loading && !data
  const a = data?.account
  const campaigns = data?.campaigns || []

  return (
    <Card tileId="google-ads">
      <SourceTag label="Google Ads" colour="#4285F4" />
      <SectionTitle>Ad Performance</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !a ? (
        <div style={{ fontSize: 13, color: t.text3 }}>No data — check credentials</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            <MetricBlock label="Spend" value={fmtRev(a.spend)} />
            <MetricBlock label="Conversions" value={rawFmt(a.conversions)} sub={`${fmtRev(a.convValue)} value`} subColour={t.green} />
            <MetricBlock label="ROAS" value={`${a.roas}x`} subColour={a.roas >= 3 ? t.green : a.roas >= 1 ? t.orange : t.red} sub={a.roas >= 3 ? 'Strong' : a.roas >= 1 ? 'Break-even' : 'Below target'} />
          </div>
          <Divider />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: t.text3, marginBottom: 4 }}>Impressions</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: t.text1, letterSpacing: '-0.02em' }}>{fmt(a.impressions)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: t.text3, marginBottom: 4 }}>Clicks</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: t.text1, letterSpacing: '-0.02em' }}>{fmt(a.clicks)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: t.text3, marginBottom: 4 }}>CTR</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: t.text1, letterSpacing: '-0.02em' }}>{a.ctr}%</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: t.text3, marginBottom: 4 }}>Avg CPC</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: t.text1, letterSpacing: '-0.02em' }}>{fmtRev(a.avgCpc)}</div>
            </div>
          </div>
          {campaigns.length > 0 && (
            <>
              <Divider />
              <div style={{ fontSize: 12, color: t.text3, marginBottom: 8, marginTop: 8 }}>Top campaigns</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Campaign', 'Spend', 'Conv', 'ROAS'].map(h => (
                      <th key={h} style={{ fontSize: 11, fontWeight: 500, color: t.text3, textAlign: h === 'Campaign' ? 'left' : 'right', paddingBottom: 8, borderBottom: `1px solid ${t.separator}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {campaigns.slice(0, 6).map((c, i) => (
                    <tr key={i}>
                      <td style={{ padding: '7px 8px 7px 0', borderBottom: `1px solid ${t.separator}`, color: t.text2, fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</td>
                      <td style={{ padding: '7px 0', borderBottom: `1px solid ${t.separator}`, color: t.text1, fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{fmtRev(c.spend)}</td>
                      <td style={{ padding: '7px 0', borderBottom: `1px solid ${t.separator}`, color: t.text1, fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{rawFmt(c.conversions)}</td>
                      <td style={{ padding: '7px 0', borderBottom: `1px solid ${t.separator}`, fontSize: 12, fontWeight: 600, textAlign: 'right', color: c.roas >= 3 ? t.green : c.roas >= 1 ? t.orange : t.red }}>{c.roas}x</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </Card>
  )
}

function ShippingWidget({ data, loading }: { data?: ShippingData; loading: boolean }) {
  const showShimmer = loading && !data
  const upcoming = data?.upcoming || []
  const past = data?.past || []
  const nextArrival = data?.nextArrival

  const formatDate = (d: string) => {
    const date = new Date(d)
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  const daysLabel = (days: number) => {
    if (days === 0) return 'Today'
    if (days === 1) return 'Tomorrow'
    if (days < 0) return `${Math.abs(days)}d ago`
    return `${days}d`
  }

  const daysColour = (days: number, type: string) => {
    if (days < 0) return t.text3
    if (type === 'arrival') {
      if (days <= 3) return t.green
      if (days <= 7) return t.teal
      return t.text2
    }
    return t.text2
  }

  return (
    <Card tileId="shipping">
      <SourceTag label="Leda Shipping" colour={t.teal} />
      <SectionTitle>Container Tracking</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : !data?.events.length ? (
        <div style={{ fontSize: 13, color: t.text3 }}>No shipments found</div>
      ) : (
        <>
          {nextArrival && (
            <div style={{
              background: `${t.green}10`, border: `1px solid ${t.green}25`,
              borderRadius: t.radiusSm, padding: '12px 14px', marginBottom: 14
            }}>
              <div style={{ fontSize: 11, color: t.green, fontWeight: 600, marginBottom: 4 }}>Next Arrival</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: t.text1, letterSpacing: '-0.02em' }}>
                {formatDate(nextArrival.date)} <span style={{ fontSize: 13, fontWeight: 500, color: t.green }}>({daysLabel(nextArrival.daysAway)})</span>
              </div>
              <div style={{ fontSize: 12, color: t.text2, marginTop: 4 }}>
                {nextArrival.container ? nextArrival.container : 'Container TBC'} — {nextArrival.reference}
              </div>
            </div>
          )}
          {upcoming.map((e, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${t.separator}` }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: e.type === 'arrival' ? t.green : t.blue
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.type === 'arrival' ? 'Arriving' : 'Departing'} — {e.container || 'TBC'}{e.reference ? ` (${e.reference})` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: daysColour(e.daysAway, e.type) }}>{daysLabel(e.daysAway)}</div>
                <div style={{ fontSize: 10, color: t.text3 }}>{formatDate(e.date)}</div>
              </div>
            </div>
          ))}
          {past.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 12, color: t.text3, cursor: 'pointer', fontWeight: 500 }}>{past.length} past shipment{past.length !== 1 ? 's' : ''}</summary>
              <div style={{ marginTop: 6 }}>
                {past.map((e, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: t.text3, padding: '5px 0', borderBottom: `1px solid ${t.separator}` }}>
                    <span>{e.type === 'arrival' ? 'Arrived' : 'Departed'} — {e.container || 'TBC'}</span>
                    <span>{formatDate(e.date)}</span>
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

function CancellationsWidget({ data, loading }: { data?: CancellationsData; loading: boolean }) {
  const { fmt, fmtRev } = useDisplayFmt()
  const showShimmer = loading && !data
  const channels = data?.channels || []
  const palette = [t.blue, t.orange, t.purple, t.green, t.red, t.teal]

  return (
    <Card tileId="cancellations">
      <SourceTag label="Veeqo" colour={t.red} />
      <SectionTitle>Returns & Cancellations</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 80 }} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: t.text2, marginBottom: 6 }}>Cancelled</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: data?.total ? t.red : t.text3, lineHeight: 1, letterSpacing: '-0.02em' }}>{fmt(data?.total)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: t.text2, marginBottom: 6 }}>Lost Revenue</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: data?.totalValue ? t.red : t.text3, lineHeight: 1, letterSpacing: '-0.02em' }}>{fmtRev(data?.totalValue)}</div>
            </div>
          </div>
          {channels.length > 0 && (
            <>
              <Divider />
              <div style={{ fontSize: 12, color: t.text3, marginBottom: 8, marginTop: 8 }}>By channel</div>
              {channels.map((ch, i) => (
                <div key={ch.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${t.separator}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: palette[i % palette.length], flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ fontSize: 12, color: t.text2 }}>{ch.name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: t.text1 }}>{ch.count}</span>
                    <span style={{ fontSize: 12, color: t.text3, minWidth: 70, textAlign: 'right' }}>{fmtRev(ch.value)}</span>
                  </div>
                </div>
              ))}
            </>
          )}
          <div style={{ fontSize: 11, color: t.text3, marginTop: 12 }}>
            Amazon FBA returns managed by Amazon — not included here
          </div>
        </>
      )}
    </Card>
  )
}

function HistoryChartWidget({ data, loading }: { data?: HistoryData; loading: boolean }) {
  const { fmt, fmtRev, hideValues } = useDisplayFmt()
  const showShimmer = loading && !data
  const daily = data?.daily || []
  const [showRevNum, setShowRevNum] = useState(false)
  const revNumVisible = showRevNum && !hideValues

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'rgba(28,28,30,0.95)', border: `1px solid ${t.cardBorder}`, borderRadius: t.radiusSm, padding: '10px 14px', backdropFilter: 'blur(20px)', fontSize: 12 }}>
        <div style={{ color: t.text1, fontWeight: 600, marginBottom: 6 }}>{label}</div>
        <div style={{ color: t.blue, marginBottom: 3 }}>{payload.find((p: any) => p.dataKey === 'orders')?.value ?? 0} orders</div>
        <div style={{ color: t.teal, marginBottom: 3 }}>{payload.find((p: any) => p.dataKey === 'units')?.value ?? 0} units</div>
        {revNumVisible && (
          <div style={{ color: t.green }}>{CUR}{(payload.find((p: any) => p.dataKey === 'revenue')?.value ?? 0).toLocaleString('en-GB', { maximumFractionDigits: 0 })}</div>
        )}
      </div>
    )
  }

  const EyeIcon = ({ open }: { open: boolean }) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={open ? t.green : t.text3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {open ? (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      )}
    </svg>
  )

  return (
    <Card tileId="history-chart">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <SourceTag label="Veeqo" colour={sourceColours.veeqo} />
        {data && (
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', textAlign: 'right', marginRight: 28 }}>
            <div>
              <div style={{ fontSize: 11, color: t.text3 }}>30d Orders</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: t.text1, letterSpacing: '-0.02em' }}>{fmt(data.totalOrders)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: t.text3 }}>30d Units</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: t.teal, letterSpacing: '-0.02em' }}>{fmt(data.totalUnitsSold)}</div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 11, color: t.text3 }}>30d Revenue</span>
                <button
                  onClick={() => setShowRevNum(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', opacity: 0.8, transition: 'opacity 0.2s' }}
                  title={revNumVisible ? 'Hide revenue number' : 'Show revenue number'}
                >
                  <EyeIcon open={revNumVisible} />
                </button>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: revNumVisible ? t.green : t.text3, letterSpacing: '-0.02em', transition: 'color 0.2s' }}>
                {revNumVisible ? fmtRev(data.totalRevenue) : '******'}
              </div>
            </div>
          </div>
        )}
      </div>
      <SectionTitle>Last 30 Days</SectionTitle>
      {showShimmer ? (
        <div className="shimmer" style={{ height: 160 }} />
      ) : !daily.length ? (
        <div style={{ fontSize: 13, color: t.text3 }}>No data</div>
      ) : (
        <div style={{ width: '100%', height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={daily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="ordersFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={t.blue} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={t.blue} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="unitsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={t.teal} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={t.teal} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={t.green} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={t.green} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: t.text3 }}
                axisLine={false}
                tickLine={false}
                interval={Math.floor(daily.length / 6)}
              />
              <YAxis
                yAxisId="orders"
                tick={{ fontSize: 10, fill: t.text3 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="revenue"
                orientation="right"
                tick={{ fontSize: 10, fill: t.text3 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => revNumVisible ? CUR + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v)) : ''}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                yAxisId="orders"
                type="monotone"
                dataKey="orders"
                stroke={t.blue}
                strokeWidth={2}
                fill="url(#ordersFill)"
                animationDuration={1000}
                animationEasing="ease-out"
              />
              <Area
                yAxisId="orders"
                type="monotone"
                dataKey="units"
                stroke={t.teal}
                strokeWidth={1.5}
                fill="url(#unitsFill)"
                strokeDasharray="4 2"
                animationDuration={1000}
                animationEasing="ease-out"
              />
              <Area
                yAxisId="revenue"
                type="monotone"
                dataKey="revenue"
                stroke={t.green}
                strokeWidth={2}
                fill="url(#revenueFill)"
                animationDuration={1000}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {daily.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 3, borderRadius: 2, background: t.blue, display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: t.text3 }}>Orders</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 2, borderRadius: 2, background: t.teal, display: 'inline-block', borderTop: `1px dashed ${t.teal}` }} />
            <span style={{ fontSize: 11, color: t.text3 }}>Units</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 3, borderRadius: 2, background: t.green, display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: t.text3 }}>Revenue</span>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Default layouts ──────────────────────────────────────────────────────────
const defaultLayouts: Layouts = {
  lg: [
    { i: 'veeqo-orders',       x: 0, y: 0,  w: 4, h: 7 },
    { i: 'ready-to-ship',      x: 4, y: 0,  w: 2, h: 5 },
    { i: 'pre-orders',         x: 4, y: 5,  w: 2, h: 4 },
    { i: 'veeqo-channels',     x: 6, y: 0,  w: 3, h: 6 },
    { i: 'veeqo-orders-by-ch', x: 9, y: 0,  w: 3, h: 6 },
    { i: 'history-chart',       x: 0, y: 5,  w: 12, h: 9 },
    { i: 'veeqo-shift',        x: 0, y: 12, w: 4, h: 7 },
    { i: 'units-sold',          x: 4, y: 12, w: 2, h: 7 },
    { i: 'veeqo-top-skus',     x: 6, y: 12, w: 3, h: 7 },
    { i: 'veeqo-top-skus-rev', x: 9, y: 12, w: 3, h: 7 },
    { i: 'veeqo-skus-by-ch',   x: 0, y: 19, w: 4, h: 7 },
    { i: 'veeqo-stock',        x: 4, y: 19, w: 4, h: 7 },
    { i: 'veeqo-stock-value',  x: 8, y: 19, w: 4, h: 8 },
    { i: 'shipping',            x: 0, y: 26, w: 3, h: 8 },
    { i: 'google-ads',          x: 3, y: 26, w: 6, h: 9 },
    { i: 'cancellations',      x: 9, y: 26, w: 3, h: 7 },
    { i: 'amazon',             x: 0, y: 35, w: 4, h: 7 },
    { i: 'ebay',               x: 0, y: 35, w: 4, h: 5 },
    { i: 'returns',            x: 4, y: 35, w: 4, h: 5 },
    { i: 'sheets',             x: 8, y: 35, w: 4, h: 5 },
  ]
}
const LAYOUT_KEY = 'opscore_layout'

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [range, setRange] = useState<DateRange>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [layouts, setLayouts] = useState<Layouts>(defaultLayouts)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
    try {
      const saved = localStorage.getItem(LAYOUT_KEY)
      if (saved) setLayouts(JSON.parse(saved))
    } catch {}
  }, [])

  const [veeqoData, setVeeqoData]   = useState<VeeqoData>()
  const [amazonData, setAmazonData] = useState<AmazonData>()
  const [ebayData, setEbayData]     = useState<EbayData>()
  const [sheetsData, setSheetsData] = useState<SheetsData>()
  const [historyData, setHistoryData] = useState<HistoryData>()
  const [historyLoading, setHistoryLoading] = useState(false)
  const [readyToShip, setReadyToShip] = useState<number | undefined>()
  const [preOrders, setPreOrders] = useState<number | undefined>()
  const [readyLoading, setReadyLoading] = useState(false)
  const [cancellations, setCancellations] = useState<CancellationsData>()
  const [cancellationsLoading, setCancellationsLoading] = useState(false)
  const [googleAdsData, setGoogleAdsData] = useState<GoogleAdsData>()
  const [googleAdsLoading, setGoogleAdsLoading] = useState(false)
  const [shippingData, setShippingData] = useState<ShippingData>()
  const [shippingLoading, setShippingLoading] = useState(false)

  const [statuses, setStatuses] = useState<Record<string, ApiStatus>>({
    veeqo: 'idle', amazon: 'idle', ebay: 'idle', sheets: 'idle'
  })
  const [lastRefresh, setLastRefresh] = useState<string>('never')
  const [fetchKey, setFetchKey] = useState(0)
  const [hideValues, setHideValues] = useState(false)
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(false)
  const [hoaxMode, setHoaxMode] = useState(false)
  const multiplier = hoaxMode ? 3 : 1
  const [hiddenTiles, setHiddenTiles] = useState<Set<string>>(new Set())
  useEffect(() => {
    try {
      const saved = localStorage.getItem('opscore_hidden_tiles')
      if (saved) setHiddenTiles(new Set(JSON.parse(saved)))
    } catch {}
  }, [])
  const toggleTile = (id: string) => {
    setHiddenTiles(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      localStorage.setItem('opscore_hidden_tiles', JSON.stringify(Array.from(next)))
      return next
    })
  }
  const fetchAllRef = useRef<() => void>(() => {})
  const prevOrderCount = useRef<number | null>(null)

  const setStatus = (key: string, s: ApiStatus) =>
    setStatuses(prev => ({ ...prev, [key]: s }))

  useEffect(() => {
    const qs = range === 'custom' && customFrom && customTo
      ? `range=custom&since=${customFrom}&until=${customTo}`
      : `range=${range}`

    const doFetch = () => {
      setLastRefresh(new Date().toLocaleTimeString('en-GB'))

      setStatus('veeqo', 'loading')
      fetch(`/api/veeqo?${qs}`)
        .then(res => res.json())
        .then(d => {
          if (d.ok) {
            const newCount = d.orders?.total ?? 0
            if (prevOrderCount.current !== null && newCount > prevOrderCount.current && !mutedRef.current) {
              playDing()
            }
            prevOrderCount.current = newCount
            setVeeqoData(d)
            setStatus('veeqo', 'ok')
          } else { setStatus('veeqo', 'error'); console.error('Veeqo:', d.error) }
        })
        .catch(() => setStatus('veeqo', 'error'))

      setStatus('amazon', 'loading')
      fetch(`/api/amazon?${qs}`)
        .then(res => res.json())
        .then(d => { if (d.ok) { setAmazonData(d); setStatus('amazon', 'ok') } else { setStatus('amazon', 'error'); console.error('Amazon:', d.error) } })
        .catch(() => setStatus('amazon', 'error'))

      setStatus('ebay', 'loading')
      fetch(`/api/ebay?${qs}`)
        .then(res => res.json())
        .then(d => { if (d.ok) { setEbayData(d); setStatus('ebay', 'ok') } else { setStatus('ebay', 'error'); console.error('eBay:', d.error) } })
        .catch(() => setStatus('ebay', 'error'))

      setStatus('sheets', 'loading')
      fetch(`/api/sheets`)
        .then(res => res.json())
        .then(d => { if (d.ok) { setSheetsData(d); setStatus('sheets', 'ok') } else { setStatus('sheets', 'error'); console.error('Sheets:', d.error) } })
        .catch(() => setStatus('sheets', 'error'))

      // Shipping containers
      setShippingLoading(true)
      fetch('/api/shipping')
        .then(res => res.json())
        .then(d => { if (d.ok) setShippingData(d); setShippingLoading(false) })
        .catch(() => setShippingLoading(false))

      // Google Ads
      setGoogleAdsLoading(true)
      fetch(`/api/google-ads?${qs}`)
        .then(res => res.json())
        .then(d => { if (d.ok) setGoogleAdsData(d); setGoogleAdsLoading(false) })
        .catch(() => setGoogleAdsLoading(false))

      // Cancellations (date-filtered)
      setCancellationsLoading(true)
      fetch(`/api/veeqo/cancellations?${qs}`)
        .then(res => res.json())
        .then(d => { if (d.ok) setCancellations(d); setCancellationsLoading(false) })
        .catch(() => setCancellationsLoading(false))

      // Ready to ship (all unshipped non-FBA orders, no date filter)
      setReadyLoading(true)
      fetch('/api/veeqo/ready')
        .then(res => res.json())
        .then(d => { if (d.ok) { setReadyToShip(d.readyToShip); setPreOrders(d.preOrders) } setReadyLoading(false) })
        .catch(() => setReadyLoading(false))

      // 30-day history (cached server-side, always fetched)
      setHistoryLoading(true)
      fetch('/api/veeqo/history')
        .then(res => res.json())
        .then(d => { if (d.ok) setHistoryData(d); setHistoryLoading(false) })
        .catch(() => setHistoryLoading(false))
    }

    fetchAllRef.current = doFetch
    doFetch()
    const interval = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL || '60') * 1000
    const timer = setInterval(doFetch, interval)
    return () => clearInterval(timer)
  }, [range, customFrom, customTo, fetchKey])

  const handleRangeChange = (r: DateRange) => setRange(r)
  const handleCustomApply = () => { if (customFrom && customTo) setRange('custom') }

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

  const pillBase: React.CSSProperties = {
    fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 20,
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all 0.2s ease', letterSpacing: '0.01em'
  }

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '6px 10px', borderRadius: t.radiusSm,
    border: `1px solid ${t.cardBorder}`, background: 'rgba(255,255,255,0.06)', color: t.text1,
    fontFamily: 'inherit', outline: 'none', transition: 'border-color 0.2s'
  }

  if (!mounted) {
    return <div style={{ minHeight: '100vh', background: t.bg }} />
  }

  return (
    <div style={{ minHeight: '100vh', background: t.bg, padding: '24px 28px' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${t.separator}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Nav />
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${t.blue}, ${t.teal})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#000' }}>O</span>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: t.text1, letterSpacing: '-0.02em' }}>OpsCore</div>
            <div style={{ fontSize: 11, color: t.text3, fontWeight: 400 }}>Command Centre</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>

          {/* Preset pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 22, padding: 3 }}>
              {(Object.keys(presetLabels) as DateRange[]).map(r => (
                <button key={r} onClick={() => handleRangeChange(r)} style={{
                  ...pillBase,
                  background: range === r ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: range === r ? t.text1 : t.text2,
                }}>{presetLabels[r]}</button>
              ))}
            </div>
            {Object.values(statuses).some(s => s === 'loading') && (
              <svg width="16" height="16" viewBox="0 0 16 16" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
                <circle cx="8" cy="8" r="6" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
                <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke={t.blue} strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </div>

          {/* Custom date range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={inputStyle} />
            <span style={{ fontSize: 12, color: t.text3 }}>to</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={inputStyle} />
            <button onClick={handleCustomApply} style={{
              ...pillBase,
              background: range === 'custom' ? t.blue : 'rgba(255,255,255,0.06)',
              color: range === 'custom' ? '#fff' : t.text2,
              opacity: customFrom && customTo ? 1 : 0.35
            }}>Apply</button>
          </div>

          {/* Status dots */}
          <div style={{ display: 'flex', gap: 14, padding: '0 4px' }}>
            {(['veeqo','amazon','ebay','sheets'] as const).map(k => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.text2 }}>
                <StatusDot status={statuses[k]} />
                <span style={{ textTransform: 'capitalize' }}>{k}</span>
              </div>
            ))}
          </div>

          {/* Sound controls */}
          <button onClick={() => { setMuted(v => { mutedRef.current = !v; return !v }) }} style={{
            ...pillBase, background: muted ? 'rgba(255,69,58,0.15)' : 'rgba(255,255,255,0.06)',
            color: muted ? t.red : t.text2, display: 'flex', alignItems: 'center', gap: 6
          }} title={muted ? 'Unmute' : 'Mute'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {muted ? (
                <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
              ) : (
                <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></>
              )}
            </svg>
          </button>
          <button onClick={() => playDing()} style={{
            ...pillBase, background: 'rgba(255,255,255,0.06)', color: t.text3,
            display: 'flex', alignItems: 'center'
          }} title="Test ding sound">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>

          {/* Master eye toggle */}
          <button onClick={() => setHideValues(v => !v)} style={{
            ...pillBase, background: hideValues ? 'rgba(255,69,58,0.15)' : 'rgba(255,255,255,0.06)',
            color: hideValues ? t.red : t.text2, display: 'flex', alignItems: 'center', gap: 6
          }} title={hideValues ? 'Show values' : 'Hide values'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {hideValues ? (
                <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></>
              ) : (
                <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
              )}
            </svg>
            {hideValues ? 'Hidden' : 'Values'}
          </button>

          {/* Hoax mode */}
          <button onClick={() => setHoaxMode(v => !v)} style={{
            ...pillBase,
            background: hoaxMode ? `linear-gradient(135deg, ${t.purple}30, ${t.blue}30)` : 'rgba(255,255,255,0.06)',
            color: hoaxMode ? t.purple : t.text3,
            border: hoaxMode ? `1px solid ${t.purple}40` : 'none',
          }} title="Triple all numbers for presentations">
            {hoaxMode ? 'Hoax ON' : 'Hoax'}
          </button>

          <button onClick={() => setFetchKey(k => k + 1)} style={{
            ...pillBase, background: 'rgba(255,255,255,0.06)', color: t.text2
          }}>Refresh</button>
          <button onClick={resetLayout} style={{
            ...pillBase, background: 'transparent', color: t.text3
          }}>Reset</button>
          <span style={{ fontSize: 11, color: t.text3 }}>{lastRefresh}</span>
        </div>
      </div>

      {/* Grid */}
      <DisplayCtx.Provider value={{ hideValues, multiplier, hiddenTiles, toggleTile }}>
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        onLayoutChange={handleLayoutChange}
        breakpoints={{ lg: 1200, md: 996, sm: 768 }}
        cols={{ lg: 12, md: 8, sm: 4 }}
        rowHeight={40}
        draggableHandle=".drag-handle"
        margin={[12, 12]}
        compactType="vertical"
        preventCollision={false}
      >
        <div key="veeqo-orders">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <VeeqoOrdersWidget data={veeqoData} loading={isLoading('veeqo')} range={range} />
        </div>
        <div key="ready-to-ship">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <ReadyToShipWidget count={readyToShip} loading={readyLoading} />
        </div>
        <div key="pre-orders">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <PreOrdersWidget count={preOrders} loading={readyLoading} />
        </div>
        <div key="veeqo-channels">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <VeeqoChannelsWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="veeqo-orders-by-ch">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <VeeqoOrdersByChannelWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="history-chart">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <HistoryChartWidget data={historyData} loading={historyLoading} />
        </div>
        <div key="veeqo-shift">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <VeeqoShiftWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="units-sold">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <UnitsSoldWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="veeqo-top-skus">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <VeeqoTopSkusWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="veeqo-top-skus-rev">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <VeeqoTopSkusByRevenueWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="veeqo-skus-by-ch">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <VeeqoTopSkusByChannelWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="veeqo-stock">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <VeeqoStockWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="veeqo-stock-value">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <VeeqoStockValueWidget data={veeqoData} loading={isLoading('veeqo')} />
        </div>
        <div key="amazon">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <AmazonWidget data={amazonData} loading={isLoading('amazon')} />
        </div>
        <div key="shipping">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <ShippingWidget data={shippingData} loading={shippingLoading} />
        </div>
        <div key="google-ads">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <GoogleAdsWidget data={googleAdsData} loading={googleAdsLoading} />
        </div>
        <div key="cancellations">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <CancellationsWidget data={cancellations} loading={cancellationsLoading} />
        </div>
        <div key="ebay">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <EbayWidget data={ebayData} loading={isLoading('ebay')} />
        </div>
        <div key="returns">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <ReturnsWidget amazon={amazonData} ebay={ebayData} loading={isLoading('amazon') || isLoading('ebay')} />
        </div>
        <div key="sheets">
          <div className="drag-handle" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, zIndex: 1 }} />
          <SheetsWidget data={sheetsData} loading={isLoading('sheets')} />
        </div>
      </ResponsiveGridLayout>
      </DisplayCtx.Provider>
    </div>
  )
}
