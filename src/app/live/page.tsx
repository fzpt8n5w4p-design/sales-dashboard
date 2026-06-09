'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Nav from '../components/Nav'
import type { GlobePoint, GlobeRing, GlobeArc } from './GlobeView'

// Globe is client-only (WebGL). ssr:false keeps three.js off the server.
const GlobeView = dynamic(() => import('./GlobeView'), {
  ssr: false,
  loading: () => null,
})

// ─── Design tokens (shared look with the main dashboard) ────────────────────
const t = {
  card: 'rgba(28, 28, 30, 0.72)',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
  text1: '#f5f5f7',
  text2: 'rgba(255, 255, 255, 0.55)',
  text3: 'rgba(255, 255, 255, 0.3)',
  blue: '#0A84FF',
  green: '#30D158',
  orange: '#FF9F0A',
  purple: '#BF5AF2',
  teal: '#64D2FF',
  pink: '#FF375F',
  yellow: '#FFD60A',
}
const CUR = process.env.NEXT_PUBLIC_CURRENCY || '£'
const REFRESH = (Number(process.env.NEXT_PUBLIC_REFRESH_INTERVAL) || 30) * 1000

// ─── API types ──────────────────────────────────────────────────────────────
interface Ping {
  id: string; lat: number; lng: number; channel: string; value: number
  city: string; country: string; product: string; createdAt: string
}
interface Stats {
  totalRevenue: number; totalOrders: number
  prevRevenue?: number; prevOrders?: number
  byChannel: { name: string; orders: number; revenue: number }[]
  topLocations: { label: string; orders: number }[]
  topProducts: { name: string; qty: number; image?: string }[]
}
interface LiveData {
  ok: boolean; fetchedAt: string
  warehouse: { lat: number; lng: number }
  pings: Ping[]; stats: Stats
}
interface VisitorPing { lat: number; lng: number; users: number; city: string; country: string }
interface VisitorData { ok: boolean; configured: boolean; total: number; today?: number; todayDelta?: number | null; pings: VisitorPing[] }

// Live storefront visitors render in a distinct dim cyan, separate from the
// channel-coloured order dots.
const VISITOR_COLOR = 'rgba(100, 210, 255, 0.55)'

// ─── Channel colours (match arcs/rings to the legend) ───────────────────────
// Each channel gets a distinct colour. Brand names claim a recognisable hue if
// it's still free; everyone else takes the next unused palette colour. First
// assignment is cached so colours stay stable across polls.
const t2 = { red: '#FF453A', indigo: '#5E5CE6', mint: '#66D4CF', brown: '#AC8E68' }
const BRAND: Record<string, string> = { amazon: t.orange, ebay: t.blue }
const PALETTE = [
  t.green, t.purple, t.teal, t.pink, t.yellow,
  t2.indigo, t2.mint, t2.red, t2.brown, t.orange, t.blue,
]
const assigned: Record<string, string> = {}
const usedColors = new Set<string>()
function channelColor(name: string): string {
  if (assigned[name]) return assigned[name]
  const key = name.toLowerCase()
  let chosen: string | undefined
  for (const b in BRAND) {
    if (key.includes(b) && !usedColors.has(BRAND[b])) { chosen = BRAND[b]; break }
  }
  if (!chosen) chosen = PALETTE.find(c => !usedColors.has(c))
  if (!chosen) {
    // More channels than distinct colours — fall back deterministically.
    let h = 0
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
    chosen = PALETTE[h % PALETTE.length]
  }
  assigned[name] = chosen
  usedColors.add(chosen)
  return chosen
}

// Compute a camera focus that frames where today's orders actually are, so the
// globe zooms to the UK/EU instead of showing empty oceans. Uses mean centre +
// average deviation so a lone far-flung order doesn't yank the view out.
function computeFocus(pings: Ping[]): { lat: number; lng: number; altitude: number } {
  if (!pings.length) return { lat: 54, lng: -2.5, altitude: 1.4 }
  let sLat = 0, sLng = 0
  for (const p of pings) { sLat += p.lat; sLng += p.lng }
  const mLat = sLat / pings.length, mLng = sLng / pings.length
  let dLat = 0, dLng = 0
  for (const p of pings) { dLat += Math.abs(p.lat - mLat); dLng += Math.abs(p.lng - mLng) }
  const spread = Math.max(dLat / pings.length, dLng / pings.length) * 2.5
  // Zoom in tight on the order region — the vector country outlines stay crisp
  // at this range, so we can frame the UK closely.
  const altitude = Math.min(2.0, Math.max(0.5, spread / 30 + 0.28))
  return { lat: mLat, lng: mLng, altitude }
}

// Parse a #RRGGBB or rgb(a) colour into [r,g,b].
function rgbTriplet(c: string): [number, number, number] {
  if (c.startsWith('#')) {
    const h = c.slice(1)
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  return m ? [+m[1], +m[2], +m[3]] : [255, 255, 255]
}

// Build a ring colour interpolator that fades smoothly from the centre (peak
// alpha) to the expanding edge (transparent) — clean, premium pulse.
function fade(c: string, peak: number): (t: number) => string {
  const [r, g, b] = rgbTriplet(c)
  return (t: number) => `rgba(${r},${g},${b},${(peak * (1 - t)).toFixed(3)})`
}

const fmtMoney = (n: number) =>
  `${CUR}${Math.round(n).toLocaleString('en-GB')}`

// % change of cur vs prev; null when there's no usable baseline.
const pct = (cur: number, prev?: number): number | null =>
  prev && prev > 0 ? ((cur - prev) / prev) * 100 : null

export default function LivePage() {
  const [points, setPoints] = useState<GlobePoint[]>([])
  const [rings, setRings] = useState<GlobeRing[]>([])
  const [arcs, setArcs] = useState<GlobeArc[]>([])
  const [visitorRings, setVisitorRings] = useState<GlobeRing[]>([]) // continuous visitor pulses
  const [stats, setStats] = useState<Stats | null>(null)
  const [meta, setMeta] = useState<{ fetchedAt: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const [recentOrders, setRecentOrders] = useState<Ping[]>([]) // newest first, max 3
  const [focus, setFocus] = useState({ lat: 54, lng: -2.5, altitude: 1.0 })
  const [visitorTotal, setVisitorTotal] = useState<number | null>(null) // null = GA4 not configured
  const [visitorToday, setVisitorToday] = useState<number>(0)
  const [visitorTodayDelta, setVisitorTodayDelta] = useState<number | null>(null)
  const [ads, setAds] = useState<{ spend: number; roas: number } | null>(null) // null = Google Ads not available
  const [ready, setReady] = useState<{ readyToShip: number; shippedYesterday: number } | null>(null)
  const [clock, setClock] = useState<Date | null>(null) // ticks each second for the cutoff countdown

  const seen = useRef<Set<string>>(new Set())
  const warehouse = useRef({ lat: 52.4862, lng: -1.8904 })
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([])
  const keyCounter = useRef(0)
  const pingsRef = useRef<Ping[]>([])
  const visitorsRef = useRef<VisitorPing[]>([])

  // Combine channel-coloured order dots with small cyan visitor anchors.
  const rebuildPoints = useCallback(() => {
    const orderPts: GlobePoint[] = pingsRef.current.map(p => ({
      lat: p.lat, lng: p.lng, color: channelColor(p.channel), radius: 0.13,
    }))
    const visitorPts: GlobePoint[] = visitorsRef.current.map(v => ({
      lat: v.lat, lng: v.lng, color: VISITOR_COLOR, radius: 0.06,
    }))
    setPoints([...visitorPts, ...orderPts])
  }, [])

  // Emit one ping: a single clean fading ring at the order + an arc into the
  // warehouse. Ring and arc have separate lifetimes so each finishes gracefully.
  const emitPing = useCallback((p: Ping) => {
    const color = channelColor(p.channel)
    const key = `${p.id}-${keyCounter.current++}`
    setRings(r => [...r, { key, lat: p.lat, lng: p.lng, color: fade(color, 0.9), maxR: 4, speed: 2.2, period: 2000 }])
    setArcs(a => [
      ...a,
      { key, startLat: p.lat, startLng: p.lng, endLat: warehouse.current.lat, endLng: warehouse.current.lng, color },
    ])
    setRecentOrders(prev => [p, ...prev].slice(0, 3))
    timeouts.current.push(setTimeout(() => setRings(r => r.filter(x => x.key !== key)), 2000))
    timeouts.current.push(setTimeout(() => setArcs(a => a.filter(x => x.key !== key)), 2800))
  }, [])

  // Subtle ambient pulse at a recent order or live-visitor location — keeps the
  // globe alive between real orders (which are sparse). Smaller, dimmer, no arc.
  const emitAmbient = useCallback(() => {
    // Orders only — visitors have their own continuous pulse rings.
    const pool = pingsRef.current.slice(0, 40).map(p => ({ lat: p.lat, lng: p.lng, color: channelColor(p.channel) }))
    if (!pool.length) return
    const p = pool[Math.floor(Math.random() * pool.length)]
    const key = `amb-${keyCounter.current++}`
    setRings(r => (r.length > 24 ? r : [...r, {
      key, lat: p.lat, lng: p.lng, color: fade(p.color, 0.3),
      maxR: 2.2, speed: 1.6, period: 2000,
    }]))
    const to = setTimeout(() => setRings(r => r.filter(x => x.key !== key)), 2000)
    timeouts.current.push(to)
  }, [])

  // Poll GA4 realtime visitors (no-op if not configured server-side).
  const loadVisitors = useCallback(async () => {
    try {
      const res = await fetch('/api/live/visitors', { cache: 'no-store' })
      const json: VisitorData = await res.json()
      if (!json.configured) { setVisitorTotal(null); return }
      visitorsRef.current = json.pings
      setVisitorTotal(json.total)
      setVisitorToday(json.today ?? 0)
      setVisitorTodayDelta(json.todayDelta ?? null)
      // One continuously-pulsing soft cyan ring per live visitor location.
      setVisitorRings(json.pings.map((v, i) => ({
        key: `vis-${i}-${v.city}`,
        lat: v.lat, lng: v.lng,
        color: fade(VISITOR_COLOR, 0.5),
        maxR: 1.8, speed: 1.2, period: 1800,
      })))
      rebuildPoints()
    } catch {
      /* visitors are best-effort; never block the page */
    }
  }, [rebuildPoints])

  // Poll Google Ads spend/ROAS (today). Changes slowly, so poll infrequently.
  const loadAds = useCallback(async () => {
    try {
      const res = await fetch('/api/google-ads', { cache: 'no-store' })
      const json = await res.json()
      if (json.ok && json.account) setAds({ spend: json.account.spend, roas: json.account.roas })
      else setAds(null)
    } catch {
      /* ad data is best-effort */
    }
  }, [])

  // Poll fulfilment (ready-to-ship + shipped yesterday) from the dedicated route.
  const loadReady = useCallback(async () => {
    try {
      const res = await fetch('/api/veeqo/ready', { cache: 'no-store' })
      const json = await res.json()
      if (json.ok) setReady({ readyToShip: json.readyToShip, shippedYesterday: json.shippedYesterday })
    } catch {
      /* fulfilment is best-effort */
    }
  }, [])

  const load = useCallback(async (isFirst: boolean) => {
    try {
      const res = await fetch('/api/live', { cache: 'no-store' })
      const json: LiveData = await res.json()
      if (!json.ok) { setError((json as any).error || 'Failed to load'); return }
      setError(null)
      warehouse.current = json.warehouse
      setStats(json.stats)
      setMeta({ fetchedAt: json.fetchedAt })
      // Assign colours biggest-channel-first so the legend ordering is stable.
      json.stats.byChannel.forEach(c => channelColor(c.name))
      setFocus(computeFocus(json.pings))
      pingsRef.current = json.pings
      rebuildPoints()

      if (isFirst) {
        // Replay today's orders, oldest → newest, spread over ~6s.
        const ordered = [...json.pings].reverse()
        const span = 6000
        ordered.forEach((p, i) => {
          seen.current.add(p.id)
          const delay = ordered.length > 1 ? (i / (ordered.length - 1)) * span : 0
          timeouts.current.push(setTimeout(() => emitPing(p), delay))
        })
      } else {
        // Only animate genuinely new orders since the last poll.
        const fresh = json.pings.filter(p => !seen.current.has(p.id))
        fresh.forEach((p, i) => {
          seen.current.add(p.id)
          timeouts.current.push(setTimeout(() => emitPing(p), i * 450))
        })
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
    }
  }, [emitPing, rebuildPoints])

  useEffect(() => {
    const setSize = () => setDims({ w: window.innerWidth, h: window.innerHeight })
    setSize()
    window.addEventListener('resize', setSize)
    load(true)
    loadVisitors()
    loadAds()
    loadReady()
    setClock(new Date())
    const iv = setInterval(() => load(false), REFRESH)
    const vv = setInterval(loadVisitors, REFRESH)
    const av = setInterval(loadAds, 5 * 60 * 1000) // ad spend changes slowly
    const rv = setInterval(loadReady, 5 * 60 * 1000) // fulfilment changes slowly + endpoint is heavy
    const ck = setInterval(() => setClock(new Date()), 1000) // cutoff countdown
    // Gentle ambient pulse every ~2s so the globe always feels alive.
    const amb = setInterval(emitAmbient, 2000)
    return () => {
      window.removeEventListener('resize', setSize)
      clearInterval(iv)
      clearInterval(vv)
      clearInterval(av)
      clearInterval(rv)
      clearInterval(ck)
      clearInterval(amb)
      timeouts.current.forEach(clearTimeout)
    }
  }, [load, loadVisitors, loadAds, loadReady, emitAmbient])

  return (
    <main style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
      {/* Globe fills the viewport behind the overlays */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {dims.w > 0 && (
          <GlobeView width={dims.w} height={dims.h} points={points} rings={[...visitorRings, ...rings]} arcs={arcs} focus={focus} />
        )}
      </div>

      {/* Header */}
      <header style={{
        position: 'absolute', top: 0, left: 0, right: 0, padding: '20px 28px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, pointerEvents: 'auto' }}>
          <Nav />
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, color: t.text1, letterSpacing: -0.3 }}>
              Live View
            </div>
            <div style={{ fontSize: 12, color: t.text2, marginTop: 2 }}>
              <span style={{
                display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                background: error ? t.pink : t.green, marginRight: 6,
                boxShadow: error ? 'none' : `0 0 8px ${t.green}`,
              }} />
              {error ? `Error: ${error}` : 'All channels · today'}
              {meta && !error && (
                <span style={{ color: t.text3 }}>
                  {'  ·  updated '}{new Date(meta.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Headline numbers */}
        <div style={{ display: 'flex', gap: 10, pointerEvents: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '64vw' }}>
          {visitorTotal !== null && (
            <Headline label="Visitors now" value={visitorTotal.toLocaleString('en-GB')} accent={t.teal} />
          )}
          {visitorTotal !== null && (
            <Headline label="Visitors today" value={visitorToday.toLocaleString('en-GB')} accent={t.teal} delta={visitorTodayDelta} />
          )}
          <Headline label="Total sales" value={stats ? fmtMoney(stats.totalRevenue) : '—'} delta={stats ? pct(stats.totalRevenue, stats.prevRevenue) : null} />
          <Headline label="Total orders" value={stats ? stats.totalOrders.toLocaleString('en-GB') : '—'} accent={t.blue} delta={stats ? pct(stats.totalOrders, stats.prevOrders) : null} />
          {ads && <Headline label="Ad spend today" value={fmtMoney(ads.spend)} accent={t.orange} />}
          {ads && <Headline label="ROAS" value={`${ads.roas.toFixed(1)}×`} accent={t.green} />}
        </div>
      </header>

      {/* Right rail: channels / locations / products */}
      <div style={{
        position: 'absolute', top: 110, right: 28, bottom: 28, width: 300,
        display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto',
        pointerEvents: 'auto',
      }}>
        <ReadyTile now={clock} data={ready} />

        <Panel title="Orders by channel">
          {stats?.byChannel.length
            ? stats.byChannel.map(c => (
                <Row key={c.name}
                  left={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: channelColor(c.name) }} />
                    {c.name}
                  </span>}
                  right={`${c.orders} · ${fmtMoney(c.revenue)}`}
                />
              ))
            : <Empty />}
        </Panel>

        <Panel title="Top locations">
          {stats?.topLocations.length
            ? stats.topLocations.map(l => (
                <Row key={l.label} left={l.label} right={`${l.orders}`} />
              ))
            : <Empty />}
        </Panel>

        <Panel title="Top products">
          {stats?.topProducts.length
            ? stats.topProducts.map(p => (
                <Row key={p.name}
                  left={<span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {p.image
                      ? <img src={p.image} alt="" width={24} height={24} loading="lazy"
                          style={{ borderRadius: 5, objectFit: 'cover', flexShrink: 0, background: 'rgba(255,255,255,0.06)' }}
                          onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }} />
                      : <span style={{ width: 24, height: 24, borderRadius: 5, flexShrink: 0, background: 'rgba(255,255,255,0.06)' }} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 158 }}>{p.name}</span>
                  </span>}
                  right={`${p.qty}`} />
              ))
            : <Empty />}
        </Panel>
      </div>

      {/* Recent orders — newest on top, older ones fade for a sense of history */}
      {recentOrders.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 24, left: 28, width: 360,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {recentOrders.map((o, i) => (
            <div key={`${o.id}-${i}`} style={{
              padding: '12px 16px', background: t.card, border: `1px solid ${t.cardBorder}`,
              borderRadius: 12, backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
              opacity: i === 0 ? 1 : i === 1 ? 0.66 : 0.42, transition: 'opacity 0.4s',
            }}>
              {i === 0 && (
                <div style={{ fontSize: 10, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
                  Latest orders
                </div>
              )}
              <div style={{ fontSize: 14, color: t.text1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: channelColor(o.channel) }} />
                <strong>{fmtMoney(o.value)}</strong>
                <span style={{ color: t.text2 }}>· {o.channel}</span>
              </div>
              <div style={{ fontSize: 12, color: t.text2, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[o.product, [o.city, o.country].filter(Boolean).join(', ')].filter(Boolean).join('  ·  ')}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

// ─── Small presentational helpers ───────────────────────────────────────────
function Headline({ label, value, accent, delta }: { label: string; value: string; accent?: string; delta?: number | null }) {
  const showDelta = typeof delta === 'number' && isFinite(delta)
  const up = (delta ?? 0) >= 0
  return (
    <div style={{
      background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 14,
      padding: '11px 16px', minWidth: 112, textAlign: 'right',
      backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
    }}>
      <div style={{ fontSize: 10, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 6, marginTop: 2 }}>
        <div style={{ fontSize: 26, fontWeight: 600, color: accent || t.text1, letterSpacing: -0.5 }}>{value}</div>
        {showDelta && (
          <span style={{ fontSize: 12, fontWeight: 600, color: up ? t.green : t.pink, whiteSpace: 'nowrap' }}>
            {up ? '▲' : '▼'} {Math.abs(delta as number).toFixed(0)}%{/* down uses pink */}
          </span>
        )}
      </div>
    </div>
  )
}

function ReadyTile({ now, data }: { now: Date | null; data: { readyToShip: number; shippedYesterday: number } | null }) {
  const qty = data?.readyToShip ?? 0
  const hasOrders = qty > 0
  const current = now ?? new Date()
  const cutoff = new Date(current); cutoff.setHours(15, 0, 0, 0)
  const isPast = current.getTime() > cutoff.getTime()
  const next = isPast ? new Date(cutoff.getTime() + 86400000) : cutoff
  const diff = next.getTime() - current.getTime()
  const urgent = !isPast && diff < 3600000
  const warning = !isPast && diff < 7200000
  const pad = (n: number) => String(n).padStart(2, '0')
  const countdown = now
    ? `${pad(Math.floor(diff / 3600000))}:${pad(Math.floor((diff % 3600000) / 60000))}:${pad(Math.floor((diff % 60000) / 1000))}`
    : '--:--:--'
  const accent = !hasOrders ? t.text3 : isPast || urgent ? t.pink : warning ? t.orange : t.green
  const bg = !hasOrders ? 'transparent' : isPast || urgent ? 'rgba(255,55,95,0.08)' : warning ? 'rgba(255,159,10,0.07)' : 'rgba(48,209,88,0.07)'
  const border = !hasOrders ? t.cardBorder : isPast || urgent ? 'rgba(255,55,95,0.25)' : warning ? 'rgba(255,159,10,0.2)' : 'rgba(48,209,88,0.18)'
  const timeColor = (isPast || urgent) && hasOrders ? t.pink : warning && hasOrders ? t.orange : t.text2
  return (
    <div style={{
      position: 'relative', overflow: 'hidden', background: t.card, border: `1px solid ${border}`,
      borderRadius: 14, padding: 14, backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
    }}>
      <div style={{ position: 'absolute', inset: 0, background: bg, pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, color: accent, border: `1px solid ${accent}`, borderRadius: 20, padding: '3px 9px' }}>Fulfilment</span>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{isPast ? 'Next cutoff tomorrow' : 'Ship by 3:00 PM'}</div>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2, color: timeColor, fontVariantNumeric: 'tabular-nums' }}>{countdown}</div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 10 }}>Ready to Ship</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
          <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, letterSpacing: -1, color: hasOrders ? accent : t.text3 }}>{qty.toLocaleString('en-GB')}</div>
          <div style={{ fontSize: 12, color: t.text2 }}>orders</div>
        </div>
        <div style={{ fontSize: 11, color: t.text3, marginTop: 8 }}>Wirral Warehouse — excludes FBA</div>
        {data && (
          <div style={{ fontSize: 12, color: t.text2, marginTop: 6 }}>
            <span style={{ fontWeight: 600, color: t.text1 }}>{data.shippedYesterday.toLocaleString('en-GB')}</span> shipped yesterday
          </div>
        )}
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 14,
      padding: 14, backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
    }}>
      <div style={{ fontSize: 11, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  )
}

function Row({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: t.text1, gap: 10 }}>
      <span style={{ color: t.text2, minWidth: 0 }}>{left}</span>
      <span style={{ color: t.text1, whiteSpace: 'nowrap' }}>{right}</span>
    </div>
  )
}

function Empty() {
  return <div style={{ fontSize: 12, color: t.text3 }}>No orders yet today</div>
}
