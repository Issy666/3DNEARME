// functions/api/printers/[id].js
//
// GET /api/printers/:id
// GET /api/printers/:id?lat=-27.48&lng=153.01   (adds distanceKm from that point)
//
// The optional lat/lng lets a profile page show "2.4km from your suburb"
// when it was reached via a search — search.html passes its geocoded
// center through as query params on the "View profile" link.

import { haversineKm } from '../_lib/geo.js';

export async function onRequestGet({ request, env, params }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ error: 'Invalid printer id.' }, 400);
  }

  const printer = await env.DB.prepare(
    `SELECT id, alias, suburb, lat, lng, printer_model,
            build_x_mm, build_y_mm, build_z_mm, min_layer_height_mm,
            turnaround_days_min, turnaround_days_max, about,
            contact_email, contact_phone, accepts_submissions, offers_custom_design,
            last_active_at, visible
     FROM printers WHERE id = ?1`
  )
    .bind(id)
    .first();

  if (!printer || !printer.visible) {
    return json({ error: 'Printer not found.' }, 404);
  }

  const [materialsResult, catalogueResult] = await Promise.all([
    env.DB.prepare(
      `SELECT m.name FROM printer_materials pm
       JOIN materials m ON m.id = pm.material_id
       WHERE pm.printer_id = ?1`
    )
      .bind(id)
      .all(),
    env.DB.prepare(
      `SELECT name, url FROM catalogue_items WHERE printer_id = ?1 ORDER BY sort_order ASC`
    )
      .bind(id)
      .all(),
  ]);

  const url = new URL(request.url);
  const fromLat = Number(url.searchParams.get('lat'));
  const fromLng = Number(url.searchParams.get('lng'));
  const distanceKm =
    Number.isFinite(fromLat) && Number.isFinite(fromLng)
      ? Math.round(haversineKm(fromLat, fromLng, printer.lat, printer.lng) * 10) / 10
      : null;

  const online =
    Date.now() - new Date(`${printer.last_active_at}Z`).getTime() < 7 * 24 * 60 * 60 * 1000;

  return json({
    id: printer.id,
    alias: printer.alias,
    suburb: printer.suburb,
    lat: printer.lat,
    lng: printer.lng,
    distanceKm,
    printerModel: printer.printer_model,
    buildVolume: `${printer.build_x_mm}×${printer.build_y_mm}×${printer.build_z_mm}mm`,
    minLayerHeightMm: printer.min_layer_height_mm,
    turnaroundDaysMin: printer.turnaround_days_min,
    turnaroundDaysMax: printer.turnaround_days_max,
    about: printer.about,
    contactEmail: printer.contact_email,
    contactPhone: printer.contact_phone,
    acceptsSubmissions: !!printer.accepts_submissions,
    offersCustomDesign: !!printer.offers_custom_design,
    online,
    materials: materialsResult.results.map((r) => r.name),
    catalogue: catalogueResult.results,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
