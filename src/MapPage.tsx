import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CRS, type LatLngBoundsExpression, type LatLng, type Layer, type LeafletMouseEvent, latLng, latLngBounds, icon, divIcon } from 'leaflet'
import { MapContainer, GeoJSON, Marker, Polyline, Polygon as LeafletPolygon, Popup, Tooltip, useMap, useMapEvents, CircleMarker } from 'react-leaflet'
import glify from 'leaflet.glify'
import { Button, Input, Switch, Typography } from 'antd'
import { EditOutlined, CopyOutlined, DeleteOutlined, UndoOutlined, CheckOutlined } from '@ant-design/icons'
import type { StoryContent } from './content/types'
import type { Feature, FeatureCollection } from 'geojson'
import 'leaflet/dist/leaflet.css'

glify.longitudeFirst()

const { Text } = Typography

const MAP_WIDTH = 1728
const MAP_HEIGHT = 963
const MAP_BOUNDS: LatLngBoundsExpression = [[0, 0], [MAP_HEIGHT, MAP_WIDTH]]

// ---------------------------------------------------------------------------
// Map content types & icons
// ---------------------------------------------------------------------------

type MapPlace = {
  name: string
  x: number
  y: number
  region: string
  type: string
  group: string
  population: number
  description: string
  icon?: string
  isCapital?: boolean
  stateId?: number
}

const INK = 'rgba(255, 255, 255, 0.82)'
const INK_LIGHT = 'rgba(255, 255, 255, 0.5)'
const INK_FAINT = 'rgba(255, 255, 255, 0.3)'
const PARCHMENT = '#03091c'

const PLACE_TYPE_ICONS: Record<string, string> = {
  capital: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36"><path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.3 21.7 0 14 0z" fill="${INK}" stroke="${PARCHMENT}" stroke-width="2"/><circle cx="14" cy="14" r="6" fill="${PARCHMENT}"/><text x="14" y="18" text-anchor="middle" font-size="12" fill="${INK}">★</text></svg>`,
  city: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="${INK}" stroke="${PARCHMENT}" stroke-width="1.5"/><circle cx="12" cy="12" r="5" fill="${PARCHMENT}"/></svg>`,
  town: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="24" viewBox="0 0 18 24"><path d="M9 0C4 0 0 4 0 9c0 6.75 9 15 9 15s9-8.25 9-15C18 4 14 0 9 0z" fill="${INK_LIGHT}" stroke="${PARCHMENT}" stroke-width="1.2"/><circle cx="9" cy="9" r="3.5" fill="${PARCHMENT}"/></svg>`,
  village: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="${INK_LIGHT}" stroke="${PARCHMENT}" stroke-width="1.5"/></svg>`,
  castle: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30"><path d="M11 0C5 0 0 5 0 11c0 8.25 11 19 11 19s11-10.75 11-19C22 5 17 0 11 0z" fill="${INK}" stroke="${PARCHMENT}" stroke-width="1.5"/><rect x="7" y="7" width="8" height="8" rx="1" fill="${PARCHMENT}"/></svg>`,
  mountain: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="14" viewBox="0 0 16 14"><path d="M8 1L14 13H2Z" fill="none" stroke="${INK_LIGHT}" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  ruins: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="6" width="3" height="6" fill="none" stroke="${INK_FAINT}" stroke-width="1.2"/><rect x="9" y="4" width="3" height="8" fill="none" stroke="${INK_FAINT}" stroke-width="1.2"/></svg>`,
  dungeon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="${INK_LIGHT}" stroke-width="1.2"/><path d="M5 5l4 4M9 5l-4 4" stroke="${INK_LIGHT}" stroke-width="1"/></svg>`,
  library: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="3" width="10" height="8" rx="1" fill="none" stroke="${INK_FAINT}" stroke-width="1.2"/><line x1="5" y1="3" x2="5" y2="11" stroke="${INK_FAINT}" stroke-width="0.8"/><line x1="9" y1="3" x2="9" y2="11" stroke="${INK_FAINT}" stroke-width="0.8"/></svg>`,
}

const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.5" fill="${INK_FAINT}" stroke="${PARCHMENT}" stroke-width="1"/></svg>`

function makePlaceIcon(type: string) {
  const svg = PLACE_TYPE_ICONS[type] ?? DEFAULT_ICON_SVG
  const sizes: Record<string, { size: [number, number]; anchor: [number, number]; popup: [number, number] }> = {
    capital: { size: [28, 36], anchor: [14, 36], popup: [0, -32] },
    city: { size: [24, 32], anchor: [12, 32], popup: [0, -28] },
    castle: { size: [22, 30], anchor: [11, 30], popup: [0, -26] },
    town: { size: [18, 24], anchor: [9, 24], popup: [0, -20] },
    village: { size: [12, 12], anchor: [6, 6], popup: [0, -8] },
    mountain: { size: [16, 14], anchor: [8, 14], popup: [0, -10] },
    ruins: { size: [14, 14], anchor: [7, 7], popup: [0, -10] },
    dungeon: { size: [14, 14], anchor: [7, 7], popup: [0, -10] },
    library: { size: [14, 14], anchor: [7, 7], popup: [0, -10] },
  }
  const s = sizes[type] || { size: [10, 10], anchor: [5, 5], popup: [0, -8] }
  return icon({
    iconUrl: 'data:image/svg+xml,' + encodeURIComponent(svg),
    iconSize: s.size,
    iconAnchor: s.anchor,
    popupAnchor: s.popup,
  })
}

function xy(x: number, y: number) {
  return latLng(y, x)
}

function placeLabelClass(type: string): string {
  if (type === 'capital') return 'map-label-capital'
  if (type === 'city') return 'map-label-city'
  if (type === 'town') return 'map-label-town'
  return 'map-label-village'
}

function placeLabelOffset(type: string): [number, number] {
  if (type === 'capital') return [0, -28]
  if (type === 'city') return [0, -24]
  if (type === 'town') return [0, -18]
  return [0, -8]
}

// ---------------------------------------------------------------------------
// Layer styles
// ---------------------------------------------------------------------------

function coastlineStyle() {
  return {
    fillColor: '#0d1a33',
    fillOpacity: 1,
    color: 'rgba(100, 180, 255, 0.35)',
    weight: 1.8,
  }
}

function stateStyle() {
  return {
    fillColor: 'transparent',
    fillOpacity: 0,
    color: INK_LIGHT,
    weight: 1.4,
    dashArray: '8 4',
  }
}

function polygonBordersToLines(fc: FeatureCollection): FeatureCollection {
  const features: Feature[] = []
  for (const f of fc.features) {
    if (f.geometry.type === 'Polygon') {
      for (const ring of (f.geometry as GeoJSON.Polygon).coordinates) {
        features.push({ type: 'Feature', properties: f.properties, geometry: { type: 'LineString', coordinates: ring } })
      }
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const polygon of (f.geometry as GeoJSON.MultiPolygon).coordinates) {
        for (const ring of polygon) {
          features.push({ type: 'Feature', properties: f.properties, geometry: { type: 'LineString', coordinates: ring } })
        }
      }
    }
  }
  return { type: 'FeatureCollection', features }
}

const PROVINCE_BORDER_COLOR = { r: 1, g: 1, b: 1, a: 0.12 }

// Route color by group type (WebGL: 0-1 range)
function routeColor(_index: number, feature: Feature) {
  const group = feature?.properties?.group as string
  if (group === 'roads') return { r: 1, g: 1, b: 1, a: 0.35 }
  if (group === 'trails') return { r: 1, g: 1, b: 1, a: 0.18 }
  if (group === 'searoutes') return { r: 0.4, g: 0.7, b: 1, a: 0.15 }
  return { r: 1, g: 1, b: 1, a: 0.15 }
}

function routeWeight(_index: number, feature: Feature): number {
  const group = feature?.properties?.group as string
  if (group === 'roads') return 1.2
  if (group === 'trails') return 0.6
  return 0.5
}

const RIVER_COLOR = { r: 0.31, g: 0.63, b: 1, a: 0.5 }
const LAKE_COLOR = { r: 0.16, g: 0.39, b: 0.78 }

type GlifyLayersProps = {
  rivers: FeatureCollection | null
  lakes: FeatureCollection | null
  provinceBorders: FeatureCollection | null
  routesData: FeatureCollection | null
  showTerrain: boolean
  showProvinces: boolean
  showRoutes: boolean
}

function GlifyLayers({ rivers, lakes, provinceBorders, routesData, showTerrain, showProvinces, showRoutes }: GlifyLayersProps) {
  const map = useMap()
  const layersRef = useRef<Array<{ remove(): void }>>([])

  useEffect(() => {
    for (const layer of layersRef.current) layer.remove()
    layersRef.current = []

    if (showProvinces && provinceBorders) {
      layersRef.current.push(
        glify.lines({
          map,
          data: provinceBorders,
          color: PROVINCE_BORDER_COLOR,
          weight: 0.6,
          opacity: 0.5,
        })
      )
    }

    if (showRoutes && routesData) {
      layersRef.current.push(
        glify.lines({
          map,
          data: routesData,
          color: routeColor,
          weight: routeWeight,
          opacity: 0.6,
        })
      )
    }

    if (showTerrain && rivers) {
      layersRef.current.push(
        glify.lines({
          map,
          data: rivers,
          color: RIVER_COLOR,
          weight: 2,
          opacity: 0.7,
        })
      )
    }

    if (showTerrain && lakes) {
      layersRef.current.push(
        glify.shapes({
          map,
          data: lakes,
          color: () => LAKE_COLOR,
          opacity: 0.55,
        })
      )
    }

    return () => {
      for (const layer of layersRef.current) layer.remove()
      layersRef.current = []
    }
  }, [map, rivers, lakes, provinceBorders, routesData, showTerrain, showProvinces, showRoutes])

  return null
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function MapFitAndLock() {
  const map = useMap()
  useEffect(() => {
    const bounds = latLngBounds([[0, 0], [MAP_HEIGHT, MAP_WIDTH]])
    map.fitBounds(bounds)
    requestAnimationFrame(() => {
      map.setMinZoom(map.getZoom())
    })
  }, [map])
  return null
}

type DrawingState = {
  active: boolean
  points: LatLng[]
  name: string
  exportedJson: string | null
}

function DrawClickHandler({ onMapClick }: { onMapClick: (latlng: LatLng) => void }) {
  useMapEvents({ click(e: LeafletMouseEvent) { onMapClick(e.latlng) } })
  return null
}

function ZoomTracker({ onZoomChange }: { onZoomChange: (z: number) => void }) {
  const map = useMap()
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null
    const handler = () => {
      if (timerId !== null) clearTimeout(timerId)
      timerId = setTimeout(() => onZoomChange(map.getZoom()), 150)
    }
    map.on('zoom', handler)
    onZoomChange(map.getZoom())
    return () => {
      map.off('zoom', handler)
      if (timerId !== null) clearTimeout(timerId)
    }
  }, [map, onZoomChange])
  return null
}

// ---------------------------------------------------------------------------
// MapPage
// ---------------------------------------------------------------------------

type MapPageProps = { content: StoryContent }

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function MapPage(_props: MapPageProps) {
  const [coastline, setCoastline] = useState<FeatureCollection | null>(null)
  const [statesData, setStatesData] = useState<FeatureCollection | null>(null)
  const [provincesData, setProvincesData] = useState<FeatureCollection | null>(null)
  const [terrain, setTerrain] = useState<FeatureCollection | null>(null)
  const [routesData, setRoutesData] = useState<FeatureCollection | null>(null)
  const [places, setPlaces] = useState<MapPlace[]>([])
  const [zoom, setZoom] = useState(0)

  const [showStates, setShowStates] = useState(true)
  const [showProvinces, setShowProvinces] = useState(false)
  const [showRoutes, setShowRoutes] = useState(true)
  const [showTerrain, setShowTerrain] = useState(true)

  const [drawing, setDrawing] = useState<DrawingState>({
    active: false, points: [], name: '', exportedJson: null,
  })

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/content/map/coastline.json').then(r => r.json()),
      fetch('/content/map/states.json').then(r => r.json()),
      fetch('/content/map/provinces.json').then(r => r.json()),
      fetch('/content/map/terrain.json').then(r => r.json()),
      fetch('/content/map/routes.json').then(r => r.json()),
      fetch('/content/map/places.json').then(r => r.json()),
    ]).then(([c, s, p, t, rt, pl]) => {
      if (cancelled) return
      setCoastline(c)
      setStatesData(s)
      setProvincesData(p)
      setTerrain(t)
      setRoutesData(rt)
      setPlaces(pl)
    })
    return () => { cancelled = true }
  }, [])

  const visiblePlaces = useMemo(() => {
    return places.filter(p => {
      if (p.group === 'capital' || p.isCapital) return true
      if (zoom >= 1 && (p.type === 'city' || p.type === 'capital')) return true
      if (zoom >= 2 && (p.type === 'town' || p.type === 'castle' || p.group === 'marker')) return true
      if (zoom >= 3) return true
      return false
    })
  }, [places, zoom])

  const stateLabels = useMemo<{ name: string; center: [number, number] }[]>(() => {
    if (!statesData) return []
    return statesData.features
      .filter((f: Feature) => f.properties?.name)
      .map((f: Feature) => {
        const name = (f.properties?.fullName as string) || (f.properties?.name as string) || ''
        let coords: number[][] = []
        if (f.geometry.type === 'Polygon') {
          coords = (f.geometry as GeoJSON.Polygon).coordinates[0]
        } else if (f.geometry.type === 'MultiPolygon') {
          const polys = (f.geometry as GeoJSON.MultiPolygon).coordinates
          let biggest = polys[0]
          for (const poly of polys) {
            if (poly[0].length > biggest[0].length) biggest = poly
          }
          coords = biggest[0]
        }
        if (coords.length === 0) return null
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (const [x, y] of coords) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
        return { name, center: [(minY + maxY) / 2, (minX + maxX) / 2] as [number, number] }
      })
      .filter((s: { name: string; center: [number, number] } | null): s is { name: string; center: [number, number] } => s !== null)
  }, [statesData])

  const stateLabelIcons = useMemo(() => {
    const map = new Map<string, ReturnType<typeof divIcon>>()
    for (const s of stateLabels) {
      map.set(s.name, divIcon({
        className: 'map-label-state',
        html: `<span>${s.name}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }))
    }
    return map
  }, [stateLabels])

  const placeIconMap = useMemo(() => {
    const iconMap = new Map<string, ReturnType<typeof icon>>()
    const allTypes = new Set(visiblePlaces.map(p => p.type))
    for (const type of allTypes) {
      iconMap.set(type, makePlaceIcon(type))
    }
    return iconMap
  }, [visiblePlaces])

  const getPlaceIcon = useCallback((type: string) => {
    return placeIconMap.get(type) ?? makePlaceIcon(type)
  }, [placeIconMap])

  const onEachState = useCallback((_feature: Feature, layer: Layer) => {
    const props = _feature.properties
    const name = props?.fullName as string || props?.name as string || ''
    const culture = props?.culture as string || ''
    const capital = props?.capital as string || ''
    const burgCount = props?.burgCount as number || 0

    if (name) {
      layer.bindTooltip(name, { sticky: true, className: 'map-region-tooltip', direction: 'top', offset: [0, -10] })
    }
    layer.on({
      mouseover: (e: LeafletMouseEvent) => {
        const t = e.target as Layer & { setStyle?: (s: Record<string, unknown>) => void }
        t.setStyle?.({ fillColor: 'rgba(100, 180, 255, 0.08)', fillOpacity: 1, weight: 2 })
      },
      mouseout: (e: LeafletMouseEvent) => {
        const t = e.target as Layer & { setStyle?: (s: Record<string, unknown>) => void }
        t.setStyle?.({ fillColor: 'transparent', fillOpacity: 0, weight: 1.4 })
      },
    })
    const desc = [
      capital ? `Capital: ${capital}` : '',
      culture ? `Culture: ${culture}` : '',
      burgCount ? `${burgCount} settlements` : '',
    ].filter(Boolean).join('<br/>')
    layer.bindPopup(`<div class="map-popup-content"><strong class="map-popup-name">${name}</strong><p class="map-popup-description">${desc}</p></div>`)
  }, [])

  const { rivers, lakes } = useMemo(() => {
    if (!terrain) return { rivers: null, lakes: null }
    return {
      rivers: {
        type: 'FeatureCollection' as const,
        features: terrain.features.filter((f: Feature) => f.properties?.kind === 'river'),
      },
      lakes: {
        type: 'FeatureCollection' as const,
        features: terrain.features.filter((f: Feature) => f.properties?.kind === 'lake'),
      },
    }
  }, [terrain])

  const provinceBorders = useMemo(
    () => provincesData ? polygonBordersToLines(provincesData) : null,
    [provincesData],
  )

  const handleDrawClick = useCallback((latlng: LatLng) => {
    setDrawing(prev => ({ ...prev, points: [...prev.points, latlng], exportedJson: null }))
  }, [])

  const handleDrawUndo = useCallback(() => {
    setDrawing(prev => ({ ...prev, points: prev.points.slice(0, -1), exportedJson: null }))
  }, [])

  const handleDrawClear = useCallback(() => {
    setDrawing(prev => ({ ...prev, points: [], exportedJson: null }))
  }, [])

  const handleDrawFinish = useCallback(() => {
    setDrawing(prev => {
      const coords = prev.points.map(p => [Math.round(p.lng * 100) / 100, Math.round(p.lat * 100) / 100])
      if (coords.length > 0) coords.push(coords[0])
      const json = JSON.stringify({ name: prev.name || 'Neue Region', coordinates: coords }, null, 2)
      return { ...prev, exportedJson: json }
    })
  }, [])

  const handleDrawToggle = useCallback(() => {
    setDrawing(prev => ({ active: !prev.active, points: [], name: '', exportedJson: null }))
  }, [])

  const handleCopyJson = useCallback(() => {
    if (drawing.exportedJson) navigator.clipboard.writeText(drawing.exportedJson)
  }, [drawing.exportedJson])

  const drawingPositions = useMemo(
    () => drawing.points.map((p): [number, number] => [p.lat, p.lng]),
    [drawing.points],
  )

  const handleZoomChange = useCallback((z: number) => setZoom(z), [])

  return (
    <div className="map-page-fullscreen">
      <div className="map-controls-panel">
        <div className="map-control-row">
          <Text className="map-control-label">States</Text>
          <Switch size="small" checked={showStates} onChange={setShowStates} />
        </div>
        <div className="map-control-row">
          <Text className="map-control-label">Provinces</Text>
          <Switch size="small" checked={showProvinces} onChange={setShowProvinces} />
        </div>
        <div className="map-control-row">
          <Text className="map-control-label">Routes</Text>
          <Switch size="small" checked={showRoutes} onChange={setShowRoutes} />
        </div>
        <div className="map-control-row">
          <Text className="map-control-label">Terrain</Text>
          <Switch size="small" checked={showTerrain} onChange={setShowTerrain} />
        </div>
        <div className="map-control-divider" />
        <div className="map-control-row">
          <EditOutlined />
          <Text className="map-control-label">Zeichnen</Text>
          <Switch size="small" checked={drawing.active} onChange={handleDrawToggle} />
        </div>
      </div>

      {drawing.active && (
        <div className="map-draw-panel">
          <div className="map-draw-header">
            <Text strong className="map-draw-title">Region zeichnen</Text>
            <Text className="map-draw-count">{drawing.points.length} Punkte</Text>
          </div>
          <Input
            placeholder="Name der Region"
            size="small"
            value={drawing.name}
            onChange={e => setDrawing(prev => ({ ...prev, name: e.target.value }))}
            className="map-draw-name-input"
          />
          <div className="map-draw-hint">
            Klicke auf die Karte um Punkte zu setzen.
          </div>
          <div className="map-draw-actions">
            <Button size="small" icon={<UndoOutlined />} onClick={handleDrawUndo} disabled={drawing.points.length === 0}>Zurueck</Button>
            <Button size="small" icon={<DeleteOutlined />} onClick={handleDrawClear} disabled={drawing.points.length === 0}>Loeschen</Button>
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={handleDrawFinish} disabled={drawing.points.length < 3}>Fertig</Button>
          </div>
          {drawing.exportedJson && (
            <div className="map-draw-export">
              <div className="map-draw-export-header">
                <Text strong className="map-draw-export-title">Koordinaten</Text>
                <Button size="small" icon={<CopyOutlined />} onClick={handleCopyJson}>Kopieren</Button>
              </div>
              <pre className="map-draw-export-json">{drawing.exportedJson}</pre>
            </div>
          )}
        </div>
      )}

      <MapContainer
        crs={CRS.Simple}
        center={xy(MAP_WIDTH / 2, MAP_HEIGHT / 2)}
        zoom={0}
        maxZoom={6}
        maxBounds={MAP_BOUNDS}
        maxBoundsViscosity={1.0}
        className={`map-leaflet-container ${drawing.active ? 'map-drawing-active' : ''}`}
        zoomControl={true}
        attributionControl={false}
        preferCanvas
        zoomSnap={0}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={60}
        bounceAtZoomLimits={false}
      >
        <MapFitAndLock />
        <ZoomTracker onZoomChange={handleZoomChange} />

        {coastline && (
          <GeoJSON key="coastline" data={coastline} style={coastlineStyle} />
        )}

        {showStates && statesData && (
          <GeoJSON key="states" data={statesData} style={stateStyle} onEachFeature={onEachState} />
        )}

        {showStates && stateLabels.map(s => (
          <Marker
            key={`state-label-${s.name}`}
            position={latLng(s.center[0], s.center[1])}
            icon={stateLabelIcons.get(s.name)!}
            interactive={false}
          />
        ))}

        <GlifyLayers
          rivers={rivers}
          lakes={lakes}
          provinceBorders={provinceBorders}
          routesData={routesData}
          showTerrain={showTerrain}
          showProvinces={showProvinces}
          showRoutes={showRoutes}
        />

        {drawing.active && <DrawClickHandler onMapClick={handleDrawClick} />}

        {drawing.active && drawingPositions.length >= 3 && (
          <LeafletPolygon
            positions={drawingPositions}
            pathOptions={{ color: 'rgba(100, 180, 255, 0.7)', weight: 2, fillColor: 'rgba(60, 161, 254, 0.12)', fillOpacity: 1, dashArray: '6 4' }}
          />
        )}
        {drawing.active && drawingPositions.length >= 2 && drawingPositions.length < 3 && (
          <Polyline positions={drawingPositions} pathOptions={{ color: 'rgba(100, 180, 255, 0.7)', weight: 2, dashArray: '6 4' }} />
        )}
        {drawing.active && drawing.points.map((p, i) => (
          <CircleMarker
            key={`draw-pt-${i}`}
            center={p}
            radius={4}
            pathOptions={{ color: 'rgba(100, 180, 255, 0.9)', weight: 2, fillColor: i === 0 ? 'rgba(60, 161, 254, 0.6)' : 'rgba(60, 161, 254, 0.9)', fillOpacity: 1 }}
          />
        ))}

        {visiblePlaces.map(place => (
          <Marker key={`${place.name}-${place.x}-${place.y}`} position={xy(place.x, place.y)} icon={getPlaceIcon(place.type)}>
            <Tooltip
              permanent
              direction="top"
              offset={placeLabelOffset(place.type)}
              className={placeLabelClass(place.type)}
            >
              {place.name}
            </Tooltip>
            <Popup>
              <div className="map-popup-content">
                <strong className="map-popup-name">{place.name}</strong>
                <span className="map-popup-region">{place.region}</span>
                <p className="map-popup-description">{place.description}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

export default MapPage
