'use client'

// Thin wrapper around react-globe.gl. It's imported only here and this file is
// itself dynamically imported with { ssr: false } from page.tsx, so three.js /
// WebGL never executes on the server. Keeping the globe instance ref local lets
// us drive camera auto-rotation without fighting next/dynamic ref forwarding.

import { useEffect, useRef } from 'react'
import Globe from 'react-globe.gl'

export interface GlobePoint { lat: number; lng: number; color: string }
export interface GlobeRing { key: string; lat: number; lng: number; color: string }
export interface GlobeArc {
  key: string
  startLat: number; startLng: number
  endLat: number; endLng: number
  color: string
}

interface Props {
  width: number
  height: number
  points: GlobePoint[]
  rings: GlobeRing[]
  arcs: GlobeArc[]
}

export default function GlobeView({ width, height, points, rings, arcs }: Props) {
  const globeEl = useRef<any>(null)

  useEffect(() => {
    const g = globeEl.current
    if (!g) return
    const controls = g.controls()
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.4
    controls.enableZoom = true
    // Frame on the UK/EU (primary market) at a comfortable distance.
    g.pointOfView({ lat: 35, lng: -5, altitude: 2.2 }, 0)
  }, [])

  return (
    <Globe
      ref={globeEl}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
      atmosphereColor="#3a86ff"
      atmosphereAltitude={0.18}
      // Persistent order locations (today)
      pointsData={points}
      pointLat="lat"
      pointLng="lng"
      pointColor="color"
      pointAltitude={0.008}
      pointRadius={0.22}
      pointsMerge={false}
      // Pulsing rings emitted per incoming order
      ringsData={rings}
      ringLat="lat"
      ringLng="lng"
      ringColor={(d: any) => d.color}
      ringMaxRadius={5}
      ringPropagationSpeed={3}
      ringRepeatPeriod={700}
      // Arcs flying each order into the warehouse
      arcsData={arcs}
      arcStartLat="startLat"
      arcStartLng="startLng"
      arcEndLat="endLat"
      arcEndLng="endLng"
      arcColor="color"
      arcDashLength={0.5}
      arcDashGap={0.25}
      arcDashAnimateTime={1500}
      arcStroke={0.4}
      arcAltitudeAutoScale={0.4}
    />
  )
}
