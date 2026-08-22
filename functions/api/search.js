// functions/api/search.js
//
// GET /api/search?suburb=West+End&radius=25&material=PLA
//
// 1. Check KV for a cached geocode of this suburb — only call Nominatim
//    on a cache miss, respecting its rate limits.
// 2. Bounding-box pre-filter in SQL (indexed, cheap), then compute exact
//    haversine distance in JS and sort by it.
//
// Requires two bindings in wrangler.toml:
//   [[d1_databases]]     binding = "DB"
//   [[kv_namespaces]]    binding = "GEOCODE_CACHE"

import { geocodeSuburb } from '../_lib/geocode.js';
import { haversineKm, boundingBox } from '../_lib/geo.js';

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — suburb coordinates don't move
const DEFAULT_RADIUS_KM = 25;
const MAX_RADIUS_KM = 100;
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // "Active this week"

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const suburbParam = (url.searchParams.get('suburb') || '').trim();
  const radiusKm = clampRadius(Number(url.searchParams.get('radius')));
  const materialFilter = url.searchParams.get('material');

  if (!suburbParam) {
    return json({ error: 'A suburb is required.' }, 400);
  }

  const cacheKey = `geocode:${normalizeSuburbKey(suburbParam)}`;

  // ---- Geocode, via KV cache first ----
  let location = await env.GEOCODE_CACHE.get(cacheKey, 'json');
  if (!location) {
    try {
      location = await geocodeSuburb(suburbParam);
    } catch (err) {
      console.error('Geocoding request failed:', err);
      return json({ error: 'Could not reach the geocoding service. Please try again shortly.' }, 502);
    }
    if (!location) {
      return json({ error: `Could not find "${suburbParam}". Try a more specific suburb name.` }, 404);
    }
    await env.GEOCODE_CACHE.put(cacheKey, JSON.stringify(location), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  }

  // ---- Bounding-box pre-filter, then exact distance + sort in JS ----
  const { minLat, maxLat, minLng, maxLng } = boundingBox(location.lat, location.lng, radiusKm);

  let sql = `
    SELECT p.id, p.alias, p.suburb, p.lat, p.lng, p.printer_model,
           p.build_x_mm, p.build_y_mm, p.build_z_mm,
           p.accepts_submissions, p.offers_custom_design, p.last_active_at,
           GROUP_CONCAT(DISTINCT m.name) AS materials,
           (SELECT COUNT(*) FROM catalogue_items c WHERE c.printer_id = p.id) AS catalogue_count
    FROM printers p
    LEFT JOIN printer_materials pm ON pm.printer_id = p.id
    LEFT JOIN materials m ON m.id = pm.material_id
    WHERE p.visible = 1
      AND p.lat BETWEEN ?1 AND ?2
      AND p.lng BETWEEN ?3 AND ?4
    GROUP BY p.id
  `;
  const bindings = [minLat, maxLat, minLng, maxLng];

  if (materialFilter) {
    sql += ` HAVING materials LIKE ?5`;
    bindings.push(`%${materialFilter}%`);
  }

  const { results } = await env.DB.prepare(sql).bind(...bindings).all();

  const now = Date.now();
  const withDistance = results
    .map((row) => ({
      id: row.id,
      alias: row.alias,
      suburb: row.suburb,
      lat: row.lat,
      lng: row.lng,
      distanceKm: round1(haversineKm(location.lat, location.lng, row.lat, row.lng)),
      printerModel: row.printer_model,
      buildVolume: `${row.build_x_mm}×${row.build_y_mm}×${row.build_z_mm}mm`,
      materials: row.materials ? row.materials.split(',') : [],
      acceptsSubmissions: !!row.accepts_submissions,
      offersCustomDesign: !!row.offers_custom_design,
      hasCatalogue: row.catalogue_count > 0,
      online: now - new Date(`${row.last_active_at}Z`).getTime() < ACTIVE_WINDOW_MS,
    }))
    // the bounding box is a rectangle, not a circle — trim corners the
    // radius wouldn't actually reach
    .filter((p) => p.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return json({
    suburb: suburbParam,
    center: { lat: location.lat, lng: location.lng },
    radiusKm,
    results: withDistance,
  });
}

function clampRadius(km) {
  if (!Number.isFinite(km) || km <= 0) return DEFAULT_RADIUS_KM;
  return Math.min(km, MAX_RADIUS_KM);
}

function normalizeSuburbKey(suburb) {
  return suburb.trim().toLowerCase().replace(/\s+/g, ' ');
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
