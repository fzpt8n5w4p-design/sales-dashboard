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

// Self-hosted detailed (50m) country outlines — vector, so they stay crisp at
// any zoom (a raster earth texture goes blurry when magnified onto the UK).
const COUNTRIES_URL = '/countries-50m.geojson'

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

  // Configure camera, lighting and material once the globe instance and its
  // imperative methods are available. We poll instead of relying on
  // onGlobeReady, which can fire before the ref is attached (a race that left
  // the globe stuck at its default full-world view in production).
  useEffect(() => {
    let tries = 0
    let posed = false
    let tuned = false
    const tick = () => {
      const g = globeEl.current
      if (g && typeof g.controls === 'function') {
        // Camera + controls as soon as the instance exists — don't wait on the
        // texture, or a slow image load leaves the globe at its default view.
        if (!posed) {
          const controls = g.controls()
          controls.autoRotate = false
          controls.enableZoom = true
          ready.current = true
          const f = focusRef.current
          g.pointOfView({ lat: f.lat, lng: f.lng, altitude: f.altitude }, 0)
          posed = true
        }
        // Lighting + material once the material is available.
        const mat = typeof g.globeMaterial === 'function' ? g.globeMaterial() : null
        if (mat && !tuned) {
          const scene = g.scene()
          scene.add(new THREE.AmbientLight(0xffffff, 1.4))
          const dir = new THREE.DirectionalLight(0xffffff, 0.7)
          dir.position.set(1, 1, 1)
          scene.add(dir)
          mat.color = new THREE.Color(0x4a5a78)
          mat.emissive = new THREE.Color(0x0b1626)
          mat.emissiveIntensity = 0.45
          mat.shininess = 6
          if (mat.map && typeof g.renderer === 'function') {
            mat.map.anisotropy = g.renderer().capabilities.getMaxAnisotropy()
            mat.map.needsUpdate = true
          }
          mat.needsUpdate = true
          tuned = true
        }
      }
      if ((!posed || !tuned) && tries++ < 100) setTimeout(tick, 80)
    }
    tick()
  }, [])

  // Pan + zoom to frame the live order region whenever it changes. If the globe
  // isn't ready yet, the setup effect applies the latest focus when it finishes.
  useEffect(() => {
    const g = globeEl.current
    if (!g || !ready.current) return
    g.pointOfView({ lat: focus.lat, lng: focus.lng, altitude: focus.altitude }, 1400)
  }, [focus.lat, focus.lng, focus.altitude])

  return (
    <Globe
      ref={globeEl}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
      atmosphereColor="#5b9dff"
      atmosphereAltitude={0.22}
      // Country outlines for definition
      polygonsData={countries}
      polygonCapColor={() => 'rgba(90,120,170,0.10)'}
      polygonSideColor={() => 'rgba(0,0,0,0)'}
      polygonStrokeColor={() => 'rgba(150,200,255,0.65)'}
      polygonAltitude={0.006}
      // Persistent order + visitor locations
      pointsData={points}
      pointLat="lat"
      pointLng="lng"
      pointColor="color"
      pointAltitude={0.006}
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
