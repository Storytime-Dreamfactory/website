declare module 'leaflet.glify' {
  import type { Map as LeafletMap } from 'leaflet'
  import type { FeatureCollection, Feature } from 'geojson'

  interface IColor {
    r: number
    g: number
    b: number
    a?: number
  }

  interface IGlifyLayer {
    remove(): void
    render(): void
  }

  interface IShapesSettings {
    map: LeafletMap
    data: FeatureCollection
    color: IColor | ((index: number, feature: Feature) => IColor)
    opacity?: number
    click?: (e: unknown, feature: Feature) => void
    hover?: (e: unknown, feature: Feature) => void
  }

  interface ILinesSettings {
    map: LeafletMap
    data: FeatureCollection
    color: IColor | ((index: number, feature: Feature) => IColor)
    weight?: number | ((index: number, feature: Feature) => number)
    opacity?: number
    click?: (e: unknown, feature: Feature) => void
    hover?: (e: unknown, feature: Feature) => void
  }

  interface IPointsSettings {
    map: LeafletMap
    data: FeatureCollection
    color: IColor | ((index: number, feature: Feature) => IColor)
    size?: number | ((index: number, feature: Feature) => number)
    opacity?: number
    click?: (e: unknown, feature: Feature) => void
    hover?: (e: unknown, feature: Feature) => void
  }

  class Glify {
    longitudeFirst(): this
    latitudeFirst(): this
    shapes(settings: Partial<IShapesSettings>): IGlifyLayer
    lines(settings: Partial<ILinesSettings>): IGlifyLayer
    points(settings: Partial<IPointsSettings>): IGlifyLayer
  }

  const glify: Glify
  export default glify
  export { glify, Glify }
}
