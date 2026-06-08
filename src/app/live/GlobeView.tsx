'use client'

// Thin wrapper around react-globe.gl. It's imported only here and this file is
// itself dynamically imported with { ssr: false } from page.tsx, so three.js /
// WebGL never executes on the server. Keeping the globe instance ref local lets
// us drive camera auto-rotation without fighting next/dynamic ref forwarding.

import { useEffect, useRef } from 'react'
import Globe from 'react-globe.gl'

export interface GlobePoint { lat: number; lng: number; color: string; radius: number }
export interface GlobeRing {
  key: string; lat: number; lng: number; color: string
  maxR: number; speed: number; period: number
}
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
  focus: { lat: number; lng: number; altitude: number }
}

export default function GlobeView({ width, height, points, rings, arcs, focus }: Props) {
  const globeEl = useRef<any>(null)

  useEffect(() => {
    const g = globeEl.current
    if (!g) return
    const controls = g.controls()
    // No auto-rotate: keep the camera parked on where orders are happening
    // rather than drifting off to empty ocean. User can still drag/zoom.
    controls.autoRotate = false
    controls.enableZoom = true
  }, [])

  // Pan + zoom to frame the live order region whenever it changes.
  useEffect(() => {
    const g = globeEl.current
    if (!g) return
    g.pointOfView({ lat: focus.lat, lng: focus.lng, altitude: focus.altitude }, 1200)
  }, [focus.lat, focus.lng, focus.altitude])

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
      pointRadius={(d: any) => d.radius}
      pointsMerge={false}
      // Pulsing rings emitted per incoming order
      ringsData={rings}
      ringLat="lat"
      ringLng="lng"
      ringColor={(d: any) => d.color}
      ringMaxRadius={(d: any) => d.maxR}
      ringPropagationSpeed={(d: any) => d.speed}
      ringRepeatPeriod={(d: any) => d.period}
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
