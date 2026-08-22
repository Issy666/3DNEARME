// functions/_lib/geo.js
//
// Pure math, no I/O — shared by search.js (bounding box + sort) and
// printers/[id].js (optional distance-from-a-point).

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * A lat/lng box roughly `radiusKm` around a center point, for a cheap
 * indexed SQL pre-filter before the precise haversine calc + sort.
 * ~111km per degree of latitude everywhere; longitude degrees shrink
 * toward the poles, so they're scaled by cos(latitude).
 */
export function boundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos(toRad(lat)) || 1);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}
