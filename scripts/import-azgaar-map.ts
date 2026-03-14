/**
 * Import script for Azgaar Fantasy Map Generator JSON exports.
 *
 * Reads the full Azgaar JSON and produces GeoJSON files that our
 * Leaflet-based MapPage can render directly.
 *
 * Usage:  npx tsx scripts/import-azgaar-map.ts <path-to-azgaar-json>
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ─── Types ───────────────────────────────────────────────────────────────────

interface AzgaarMap {
  info: { mapName: string; width: number; height: number; seed: string }
  pack: {
    cells: AzgaarCell[]
    vertices: AzgaarVertex[]
    features: (AzgaarFeature | 0)[]
    states: (AzgaarState | 0)[]
    provinces: (AzgaarProvince | 0)[]
    cultures: (AzgaarCulture | 0)[]
    burgs: (AzgaarBurg | 0)[]
    rivers: AzgaarRiver[]
    markers: AzgaarMarker[]
    routes: AzgaarRoute[]
    religions: (AzgaarReligion | 0)[]
  }
  biomesData: { name: string[] }
  notes: { id: string; name: string; legend: string }[]
}

interface AzgaarCell {
  i: number; v: number[]; c: number[]; p: [number, number]
  h: number; f: number; t: number; biome: number
  state: number; province: number; culture: number; religion: number
  burg: number; pop: number
}

interface AzgaarVertex {
  i: number; p: [number, number]; v: number[]; c: number[]
}

interface AzgaarFeature {
  i: number; type: string; land: boolean; cells: number
  vertices: number[]; group?: string; border?: boolean
}

interface AzgaarState {
  i: number; name: string; fullName: string; color: string
  form?: string; formName?: string; capital: number
  culture: number; burgs: number; cells: number
  provinces: number[]
}

interface AzgaarProvince {
  i: number; state: number; name: string; fullName: string
  formName: string; color: string; center: number; burg: number
}

interface AzgaarCulture {
  i: number; name: string; color?: string; type?: string
}

interface AzgaarBurg {
  i: number; name: string; x: number; y: number
  state: number; culture: number; population: number
  type: string; group: string; capital: number
  feature: number; port?: number
  citadel?: number; plaza?: number; walls?: number
  shanty?: number; temple?: number
  cell: number
}

interface AzgaarRiver {
  i: number; name: string; type: string
  source: number; mouth: number
  cells: number[]; discharge: number
  length: number; width: number; sourceWidth: number
  widthFactor: number; parent: number; basin: number
}

interface AzgaarMarker {
  i: number; x: number; y: number; cell: number
  type: string; icon: string
  dx?: number; dy?: number; px?: number
}

interface AzgaarRoute {
  i: number; group: string; feature: number
  points: [number, number, number][]
}

interface AzgaarReligion {
  i: number; name: string; type?: string; form?: string
  deity?: string; color?: string
}

type GeoJSONFeature = {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: { type: string; coordinates: unknown }
}

type FeatureCollection = {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function coord(p: [number, number]): [number, number] {
  return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]
}

function verticesToRing(vertexIndices: number[], vertices: AzgaarVertex[]): [number, number][] {
  const ring = vertexIndices.map(vi => {
    const v = vertices[vi]
    if (!v) return null
    return coord(v.p)
  }).filter((p): p is [number, number] => p !== null)

  if (ring.length > 2) {
    const [fx, fy] = ring[0]
    const [lx, ly] = ring[ring.length - 1]
    if (fx !== lx || fy !== ly) ring.push([...ring[0]] as [number, number])
  }
  return ring
}

/**
 * Extract the outer boundary of a set of cells as an ordered ring of vertex coordinates.
 *
 * Algorithm: For each cell in the set, iterate its vertices. An edge (pair of
 * consecutive vertices) is a boundary edge if the adjacent cell across that
 * edge does NOT belong to the same set. Collect all boundary edges and then
 * chain them into an ordered ring.
 */
function cellSetBoundary(
  cellIndices: Set<number>,
  cells: AzgaarCell[],
  vertices: AzgaarVertex[],
): [number, number][][] {
  const edgeMap = new Map<string, [number, number]>()

  for (const ci of cellIndices) {
    const cell = cells[ci]
    if (!cell) continue
    const verts = cell.v
    if (!verts || verts.length < 3) continue

    for (let j = 0; j < verts.length; j++) {
      const a = verts[j]
      const b = verts[(j + 1) % verts.length]

      const vertex = vertices[a]
      if (!vertex) continue
      const adjacentCells = vertex.c
      const neighborCell = adjacentCells.find(
        nc => nc !== ci && vertices[b]?.c.includes(nc),
      )

      if (neighborCell === undefined || !cellIndices.has(neighborCell)) {
        const key = `${a}-${b}`
        edgeMap.set(key, [a, b])
      }
    }
  }

  const edges = Array.from(edgeMap.values())
  const rings: [number, number][][] = []

  const adjacency = new Map<number, number[]>()
  for (const [a, b] of edges) {
    if (!adjacency.has(a)) adjacency.set(a, [])
    adjacency.get(a)!.push(b)
  }

  const usedEdges = new Set<string>()

  for (const [startA, startB] of edges) {
    const startKey = `${startA}-${startB}`
    if (usedEdges.has(startKey)) continue

    const ring: number[] = [startA, startB]
    usedEdges.add(startKey)
    let current = startB

    for (let safety = 0; safety < 50000; safety++) {
      const neighbors = adjacency.get(current)
      if (!neighbors) break

      let found = false
      for (const next of neighbors) {
        const key = `${current}-${next}`
        if (usedEdges.has(key)) continue
        usedEdges.add(key)
        if (next === ring[0]) {
          found = true
          break
        }
        ring.push(next)
        current = next
        found = true
        break
      }
      if (!found || current === ring[0]) break
      if (ring[ring.length - 1] === ring[0]) break
    }

    if (ring.length >= 3) {
      const coords = ring.map(vi => {
        const v = vertices[vi]
        return v ? coord(v.p) : null
      }).filter((p): p is [number, number] => p !== null)

      if (coords.length >= 3) {
        coords.push([...coords[0]] as [number, number])
        rings.push(coords)
      }
    }
  }

  return rings
}

function makeFeatureCollection(features: GeoJSONFeature[]): FeatureCollection {
  return { type: 'FeatureCollection', features }
}

function writeJSON(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
  const size = readFileSync(path).length
  console.log(`  -> ${path} (${(size / 1024).toFixed(1)} KB)`)
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: npx tsx scripts/import-azgaar-map.ts <path-to-azgaar-json>')
    process.exit(1)
  }

  console.log(`Reading ${inputPath}...`)
  const raw = readFileSync(resolve(inputPath), 'utf8')
  const data: AzgaarMap = JSON.parse(raw)

  const { pack, biomesData } = data
  const { cells, vertices, features, states, burgs, rivers, markers, routes, provinces, cultures } = pack
  const outDir = resolve(dirname(inputPath), '..', 'Development/Storytime/website/public/content/map')
  const localOutDir = resolve(__dirname, '..', 'public/content/map')

  console.log(`\nMap: "${data.info.mapName}" (${data.info.width}x${data.info.height})`)
  console.log(`Cells: ${cells.length}, Vertices: ${vertices.length}`)
  console.log(`Features: ${features.length}, States: ${states.length}`)
  console.log(`Burgs: ${burgs.length}, Rivers: ${rivers.length}, Routes: ${routes.length}`)
  console.log(`Markers: ${markers.length}, Provinces: ${provinces.length}`)

  const stateMap = new Map<number, AzgaarState>()
  for (const s of states) {
    if (s && typeof s === 'object' && s.i > 0) stateMap.set(s.i, s)
  }

  const cultureMap = new Map<number, AzgaarCulture>()
  for (const c of cultures) {
    if (c && typeof c === 'object') cultureMap.set(c.i, c)
  }

  // ─── 1. Coastline ────────────────────────────────────────────────────────

  console.log('\n1. Generating coastline.json...')
  const coastlineFeatures: GeoJSONFeature[] = []

  const landFeatures = features.filter(
    (f): f is AzgaarFeature => !!f && typeof f === 'object' && f.land === true,
  ).sort((a, b) => b.cells - a.cells)

  let continentIndex = 0
  for (const feat of landFeatures) {
    if (!feat.vertices || feat.vertices.length < 3) continue
    const ring = verticesToRing(feat.vertices, vertices)
    if (ring.length < 4) continue

    let kind = feat.group || 'island'
    let name = `Island ${feat.i}`
    if (kind === 'continent') {
      continentIndex++
      name = continentIndex === 1 ? data.info.mapName : `Continent ${continentIndex}`
    } else if (kind === 'isle') {
      name = `Isle ${feat.i}`
    }

    coastlineFeatures.push({
      type: 'Feature',
      properties: { name, kind, cells: feat.cells, featureId: feat.i },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }

  writeJSON(resolve(localOutDir, 'coastline.json'), makeFeatureCollection(coastlineFeatures))

  // ─── 2. States ───────────────────────────────────────────────────────────

  console.log('\n2. Generating states.json...')
  const stateFeatures: GeoJSONFeature[] = []

  for (const [stateId, state] of stateMap) {
    const stateCells = new Set<number>()
    for (const cell of cells) {
      if (cell.state === stateId) stateCells.add(cell.i)
    }
    if (stateCells.size === 0) continue

    const rings = cellSetBoundary(stateCells, cells, vertices)
    if (rings.length === 0) continue

    const capitalBurg = burgs.find(
      (b): b is AzgaarBurg => !!b && typeof b === 'object' && b.i === state.capital,
    )

    const cultureName = cultureMap.get(state.culture)?.name || 'Unknown'

    const dominantBiome = (() => {
      const biomeCounts = new Map<number, number>()
      for (const ci of stateCells) {
        const b = cells[ci].biome
        biomeCounts.set(b, (biomeCounts.get(b) || 0) + 1)
      }
      let maxCount = 0
      let maxBiome = 0
      for (const [b, c] of biomeCounts) {
        if (c > maxCount) { maxCount = c; maxBiome = b }
      }
      return biomesData.name[maxBiome] || 'Unknown'
    })()

    const geom = rings.length === 1
      ? { type: 'Polygon', coordinates: [rings[0]] }
      : { type: 'MultiPolygon', coordinates: rings.map(r => [r]) }

    stateFeatures.push({
      type: 'Feature',
      properties: {
        name: state.name,
        fullName: state.fullName,
        color: state.color,
        form: state.form || null,
        formName: state.formName || null,
        culture: cultureName,
        biome: dominantBiome,
        capital: capitalBurg?.name || null,
        burgCount: state.burgs,
        stateId: state.i,
      },
      geometry: geom,
    })
  }

  writeJSON(resolve(localOutDir, 'states.json'), makeFeatureCollection(stateFeatures))

  // ─── 3. Provinces ────────────────────────────────────────────────────────

  console.log('\n3. Generating provinces.json...')
  const provinceFeatures: GeoJSONFeature[] = []

  const validProvinces = provinces.filter(
    (p): p is AzgaarProvince => !!p && typeof p === 'object' && p.i > 0,
  )

  for (const prov of validProvinces) {
    const provCells = new Set<number>()
    for (const cell of cells) {
      if (cell.province === prov.i) provCells.add(cell.i)
    }
    if (provCells.size === 0) continue

    const rings = cellSetBoundary(provCells, cells, vertices)
    if (rings.length === 0) continue

    const stateName = stateMap.get(prov.state)?.name || 'Unknown'

    const geom = rings.length === 1
      ? { type: 'Polygon', coordinates: [rings[0]] }
      : { type: 'MultiPolygon', coordinates: rings.map(r => [r]) }

    provinceFeatures.push({
      type: 'Feature',
      properties: {
        name: prov.name,
        fullName: prov.fullName,
        formName: prov.formName,
        state: stateName,
        color: prov.color,
        provinceId: prov.i,
      },
      geometry: geom,
    })
  }

  writeJSON(resolve(localOutDir, 'provinces.json'), makeFeatureCollection(provinceFeatures))

  // ─── 4. Terrain (Rivers + Lakes) ────────────────────────────────────────

  console.log('\n4. Generating terrain.json...')
  const terrainFeatures: GeoJSONFeature[] = []

  for (const river of rivers) {
    if (!river.cells || river.cells.length < 2) continue

    const coords: [number, number][] = river.cells
      .map(ci => {
        if (ci < 0 || ci >= cells.length) return null
        return coord(cells[ci].p)
      })
      .filter((p): p is [number, number] => p !== null)

    if (coords.length < 2) continue

    terrainFeatures.push({
      type: 'Feature',
      properties: {
        name: river.name,
        kind: 'river',
        riverType: river.type,
        discharge: river.discharge,
        width: river.width,
        length: river.length,
        riverId: river.i,
      },
      geometry: { type: 'LineString', coordinates: coords },
    })
  }

  const lakeFeatures = features.filter(
    (f): f is AzgaarFeature => !!f && typeof f === 'object' && f.type === 'lake',
  )

  for (const lake of lakeFeatures) {
    if (!lake.vertices || lake.vertices.length < 3) continue
    const ring = verticesToRing(lake.vertices, vertices)
    if (ring.length < 4) continue

    const lakeName = (() => {
      const note = data.notes.find(n => n.id === `lake${lake.i}`)
      return note?.name || `Lake ${lake.i}`
    })()

    terrainFeatures.push({
      type: 'Feature',
      properties: {
        name: lakeName,
        kind: 'lake',
        group: lake.group || 'freshwater',
        featureId: lake.i,
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }

  writeJSON(resolve(localOutDir, 'terrain.json'), makeFeatureCollection(terrainFeatures))

  // ─── 5. Routes ───────────────────────────────────────────────────────────

  console.log('\n5. Generating routes.json...')
  const routeFeatures: GeoJSONFeature[] = []

  for (const route of routes) {
    if (!route.points || route.points.length < 2) continue

    const coords: [number, number][] = route.points.map(
      ([x, y]) => coord([x, y]),
    )

    routeFeatures.push({
      type: 'Feature',
      properties: {
        group: route.group,
        feature: route.feature,
        routeId: route.i,
      },
      geometry: { type: 'LineString', coordinates: coords },
    })
  }

  writeJSON(resolve(localOutDir, 'routes.json'), makeFeatureCollection(routeFeatures))

  // ─── 6. Places ───────────────────────────────────────────────────────────

  console.log('\n6. Generating places.json...')

  const BURG_TYPE_MAP: Record<string, string> = {
    capital: 'capital',
    city: 'city',
    town: 'town',
    village: 'village',
    fort: 'castle',
  }

  const MARKER_TYPE_MAP: Record<string, string> = {
    volcanoes: 'mountain',
    'hot-springs': 'hot-spring',
    'water-sources': 'water-source',
    mines: 'mine',
    bridges: 'bridge',
    inns: 'inn',
    lighthouses: 'lighthouse',
    battlefields: 'battlefield',
    dungeons: 'dungeon',
    'lake-monsters': 'monster',
    'sea-monsters': 'monster',
    'hill-monsters': 'monster',
    'sacred-mountains': 'sacred-place',
    'sacred-forests': 'sacred-place',
    'sacred-pineries': 'sacred-place',
    brigands: 'danger',
    pirates: 'danger',
    statues: 'ruins',
    ruins: 'ruins',
    libraries: 'library',
    circuses: 'entertainment',
    jousts: 'entertainment',
    fairs: 'fair',
    canoes: 'port',
    migration: 'migration',
    mirage: 'mystery',
    caves: 'cave',
    necropolises: 'ruins',
    encounters: 'encounter',
  }

  interface PlaceOut {
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

  const placesOut: PlaceOut[] = []

  for (const burg of burgs) {
    if (!burg || typeof burg !== 'object' || !burg.i) continue

    const stateName = stateMap.get(burg.state)?.name || 'Wildlands'
    const stateFullName = stateMap.get(burg.state)?.fullName || stateName
    const type = BURG_TYPE_MAP[burg.group] || 'village'

    const features: string[] = []
    if (burg.citadel) features.push('Citadel')
    if (burg.walls) features.push('Walls')
    if (burg.temple) features.push('Temple')
    if (burg.plaza) features.push('Plaza')
    if (burg.port) features.push('Port')

    const pop = Math.round(burg.population * 1000)
    const desc = [
      `${burg.group === 'capital' ? 'Capital' : burg.group.charAt(0).toUpperCase() + burg.group.slice(1)} of ${stateFullName}.`,
      pop > 0 ? `Population: ~${pop.toLocaleString()}.` : '',
      features.length > 0 ? `Features: ${features.join(', ')}.` : '',
    ].filter(Boolean).join(' ')

    placesOut.push({
      name: burg.name,
      x: Math.round(burg.x * 100) / 100,
      y: Math.round(burg.y * 100) / 100,
      region: stateName,
      type,
      group: burg.group,
      population: pop,
      description: desc,
      isCapital: burg.capital === 1,
      stateId: burg.state,
    })
  }

  for (const marker of markers) {
    const type = MARKER_TYPE_MAP[marker.type] || marker.type
    const stateName = (() => {
      const cell = cells[marker.cell]
      if (!cell) return 'Wildlands'
      return stateMap.get(cell.state)?.name || 'Wildlands'
    })()

    placesOut.push({
      name: marker.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      x: Math.round(marker.x * 100) / 100,
      y: Math.round(marker.y * 100) / 100,
      region: stateName,
      type,
      group: 'marker',
      population: 0,
      description: `A notable ${marker.type.replace(/-/g, ' ')} location.`,
      icon: marker.icon,
    })
  }

  writeJSON(resolve(localOutDir, 'places.json'), placesOut)

  // ─── Summary ─────────────────────────────────────────────────────────────

  console.log('\n=== Import Summary ===')
  console.log(`Coastline features: ${coastlineFeatures.length}`)
  console.log(`State features: ${stateFeatures.length}`)
  console.log(`Province features: ${provinceFeatures.length}`)
  console.log(`Terrain features: ${terrainFeatures.length} (${rivers.length} rivers, ${lakeFeatures.length} lakes)`)
  console.log(`Route features: ${routeFeatures.length}`)
  console.log(`Places: ${placesOut.length} (${placesOut.filter(p => p.group !== 'marker').length} burgs, ${placesOut.filter(p => p.group === 'marker').length} markers)`)
  console.log('\nDone!')
}

main()
