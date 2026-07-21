/**
 * Pure containment: the id-field keys of rows whose (lng,lat) satisfy `contains`.
 * ESRI-free — the caller supplies the geometry predicate (see EsriMapMolecule,
 * which builds it from geometryEngine.contains over a projected geometry).
 */
export function containedKeys(
  rows: Array<Record<string, unknown>>,
  idField: string,
  lngField: string,
  latField: string,
  contains: (lng: number, lat: number) => boolean
): string[] {
  const keys: string[] = []
  for (const row of rows) {
    const lng = Number(row[lngField])
    const lat = Number(row[latField])
    if (Number.isFinite(lng) && Number.isFinite(lat) && contains(lng, lat)) {
      keys.push(String(row[idField]))
    }
  }
  return keys
}
