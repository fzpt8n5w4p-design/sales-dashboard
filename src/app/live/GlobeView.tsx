'use client'

// Thin wrapper around react-globe.gl. It's imported only here and this file is
// itself dynamically imported with { ssr: false } from page.tsx, so three.js /
// WebGL never executes on the server. Keeping the globe instance ref local lets
// us drive camera + lighting without fighting next/dynamic ref forwarding.

import { useEffect, useRef, useState } from 'react'
import Globe from 'react-globe.gl'
import * as THREE from 'three'

export interface GlobePoint { lat: number; lng: number; color: string; radius: number }
export interface GlobeRing {
  key: string; lat: number; lng: number
  color: (t: number) => string
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

const COUNTRIES_URL =
  '//unpkg.com/three-globe/example/datasets/ne_110m_admin_0_countries.geojson'

export default function GlobeView({ width, height, points, rings, arcs, focus }: Props) {
  const globeEl = useRef<any>(null)
  const ready = useRef(false)
  const focusRef = useRef(focus)
  focusRef.current = focus
  const [countries, setCountries] = useState<any[]>([])

  // Subtle country outlines give the dark globe clear, premium definition.
  useEffect(() => {
    fetch(COUNTRIES_URL)
      .then(r => r.json())
      .then(d => setCountries(d.features || []))
      .catch(() => {})
  }, [])

  // Configure camera, lighting and material once the globe is fully ready —
  // globeMaterial()/scene() aren't available until then.
  const handleReady = () => {
    const g = globeEl.current
    if (!g) return
    ready.current = true

    const controls = g.controls()
    controls.autoRotate = false // keep the camera parked on where orders happen
    controls.enableZoom = true

    // Brighten the scene so land/oceans read clearly (default lighting is dim).
    const scene = g.scene()
    scene.add(new THREE.AmbientLight(0xffffff, 1.4))
    const dir = new THREE.DirectionalLight(0xffffff, 0.7)
    dir.position.set(1, 1, 1)
    scene.add(dir)

    // Lift the globe material so the texture isn't crushed to black.
    if (typeof g.globeMaterial === 'function') {
      const mat = g.globeMaterial()
      if (mat) {
        mat.color = new THREE.Color(0x4a5a78)
        mat.emissive = new THREE.Color(0x0b1626)
        mat.emissiveIntensity = 0.45
        mat.shininess = 6
        mat.needsUpdate = true
      }
    }

    const f = focusRef.current
    g.pointOfView({ lat: f.lat, lng: f.lng, altitude: f.altitude }, 0)
  }

  // Pan + zoom to frame the live order region whenever it changes.
  useEffect(() => {
    const g = globeEl.current
    if (!g || !ready.current) return
    g.pointOfView({ lat: focus.lat, lng: focus.lng, altitude: focus.altitude }, 1400)
  }, [focus.lat, focus.lng, focus.altitude])

  return (
    <Globe
      ref={globeEl}
      onGlobeReady={handleReady}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
      atmosphereColor="#5b9dff"
      atmosphereAltitude={0.22}
      // Country outlines for definition
      polygonsData={countries}
      polygonCapColor={() => 'rgba(255,255,255,0.015)'}
      polygonSideColor={() => 'rgba(0,0,0,0)'}
      polygonStrokeColor={() => 'rgba(130,180,255,0.5)'}
      polygonAltitude={0.005}
      // Persistent order + visitor locations
      pointsData={points}
      pointLat="lat"
      pointLng="lng"
      pointColor="color"
      pointAltitude={0.01}
      pointRadius={(d: any) => d.radius}
      pointsMerge={false}
      // Clean fading pulses emitted per order / ambient tick
      ringsData={rings}
      ringLat="lat"
      ringLng="lng"
      ringColor={(d: any) => d.color}
      ringMaxRadius={(d: any) => d.maxR}
      ringPropagationSpeed={(d: any) => d.speed}
      ringRepeatPeriod={(d: any) => d.period}
      ringResolution={128}
      // Arcs flying each order into the warehouse, fading to a comet tail
      arcsData={arcs}
      arcStartLat="startLat"
      arcStartLng="startLng"
      arcEndLat="endLat"
      arcEndLng="endLng"
      arcColor={(d: any) => [d.color, 'rgba(255,255,255,0)']}
      arcDashLength={0.45}
      arcDashGap={0.6}
      arcDashInitialGap={1}
      arcDashAnimateTime={2200}
      arcStroke={0.45}
      arcAltitudeAutoScale={0.45}
    />
  )
}
