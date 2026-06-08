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
  byChannel: { name: string; orders: number; revenue: number }[]
  topLocations: { label: string; orders: number }[]
  topProducts: { name: string; qty: number }[]
}
interface LiveData {
  ok: boolean; fetchedAt: string
  warehouse: { lat: number; lng: number }
  pings: Ping[]; stats: Stats
}

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
  const altitude = Math.min(2.5, Math.max(0.45, spread / 30 + 0.4))
  return { lat: mLat, lng: mLng, altitude }
}

const fmtMoney = (n: number) =>
  `${CUR}${Math.round(n).toLocaleString('en-GB')}`

export default function LivePage() {
  const [points, setPoints] = useState<GlobePoint[]>([])
  const [rings, setRings] = useState<GlobeRing[]>([])
  const [arcs, setArcs] = useState<GlobeArc[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [meta, setMeta] = useState<{ fetchedAt: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const [lastOrder, setLastOrder] = useState<Ping | null>(null)
  const [focus, setFocus] = useState({ lat: 54, lng: -2.5, altitude: 1.4 })

  const seen = useRef<Set<string>>(new Set())
  const warehouse = useRef({ lat: 52.4862, lng: -1.8904 })
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([])
  const keyCounter = useRef(0)

  // Emit one ping: a pulsing ring at the order + an arc into the warehouse.
  const emitPing = useCallback((p: Ping) => {
    const color = channelColor(p.channel)
    const key = `${p.id}-${keyCounter.current++}`
    setRings(r => [...r, { key, lat: p.lat, lng: p.lng, color }])
    setArcs(a => [
      ...a,
      { key, startLat: p.lat, startLng: p.lng, endLat: warehouse.current.lat, endLng: warehouse.current.lng, color },
    ])
    setLastOrder(p)
    const to = setTimeout(() => {
      setRings(r => r.filter(x => x.key !== key))
      setArcs(a => a.filter(x => x.key !== key))
    }, 3500)
    timeouts.current.push(to)
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
      setPoints(json.pings.map(p => ({ lat: p.lat, lng: p.lng, color: channelColor(p.channel) })))

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
  }, [emitPing])

  useEffect(() => {
    const setSize = () => setDims({ w: window.innerWidth, h: window.innerHeight })
    setSize()
    window.addEventListener('resize', setSize)
    load(true)
    const iv = setInterval(() => load(false), REFRESH)
    return () => {
      window.removeEventListener('resize', setSize)
      clearInterval(iv)
      timeouts.current.forEach(clearTimeout)
    }
  }, [load])

  return (
    <main style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
      {/* Globe fills the viewport behind the overlays */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {dims.w > 0 && (
          <GlobeView width={dims.w} height={dims.h} points={points} rings={rings} arcs={arcs} focus={focus} />
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
        <div style={{ display: 'flex', gap: 12, pointerEvents: 'auto' }}>
          <Headline label="Total sales" value={stats ? fmtMoney(stats.totalRevenue) : '—'} />
          <Headline label="Total orders" value={stats ? stats.totalOrders.toLocaleString('en-GB') : '—'} accent={t.blue} />
        </div>
      </header>

      {/* Right rail: channels / locations / products */}
      <div style={{
        position: 'absolute', top: 110, right: 28, bottom: 28, width: 300,
        display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto',
        pointerEvents: 'auto',
      }}>
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
                <Row key={p.name} left={<span style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190, display: 'inline-block',
                }}>{p.name}</span>} right={`${p.qty}`} />
              ))
            : <Empty />}
        </Panel>
      </div>

      {/* Latest order ticker */}
      {lastOrder && (
        <div style={{
          position: 'absolute', bottom: 24, left: 28, padding: '12px 16px',
          background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 12,
          backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
          maxWidth: 360,
        }}>
          <div style={{ fontSize: 10, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>Latest order</div>
          <div style={{ fontSize: 14, color: t.text1, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: channelColor(lastOrder.channel) }} />
            <strong>{fmtMoney(lastOrder.value)}</strong>
            <span style={{ color: t.text2 }}>· {lastOrder.channel}</span>
          </div>
          <div style={{ fontSize: 12, color: t.text2, marginTop: 2 }}>
            {[lastOrder.product, [lastOrder.city, lastOrder.country].filter(Boolean).join(', ')].filter(Boolean).join('  ·  ')}
          </div>
        </div>
      )}
    </main>
  )
}

// ─── Small presentational helpers ───────────────────────────────────────────
function Headline({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{
      background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 14,
      padding: '12px 18px', minWidth: 132, textAlign: 'right',
      backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
    }}>
      <div style={{ fontSize: 10, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color: accent || t.text1, marginTop: 2, letterSpacing: -0.5 }}>{value}</div>
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
