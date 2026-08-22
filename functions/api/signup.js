// functions/api/signup.js
//
// POST /api/signup
// Creates a user account + printer profile in one request, geocoding the
// suburb exactly once at signup time (never on search) and hashing the
// password with Web Crypto before anything touches D1.
//
// Expected JSON body:
// {
//   email, password,                              // account
//   alias, suburb, printer_model,                 // printer basics
//   build_x_mm, build_y_mm, build_z_mm,            // required numbers
//   min_layer_height_mm, turnaround_days_min, turnaround_days_max, about, // optional
//   contact_email, contact_phone,                  // contact
//   accepts_submissions, offers_custom_design,      // booleans
//   materials: ["PLA", "PETG", ...]                 // must match names in the materials table
// }

import { hashPassword } from '../_lib/crypto.js';
import { geocodeSuburb } from '../_lib/geocode.js';

const SESSION_DAYS = 30;

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }

  const errors = validate(body);
  if (errors.length) {
    return json({ error: 'Invalid input', details: errors }, 400);
  }

  const email = body.email.trim().toLowerCase();

  // ---- Reject duplicate accounts early ----
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first();
  if (existing) {
    return json({ error: 'An account with this email already exists.' }, 409);
  }

  // ---- Geocode BEFORE writing anything. If the suburb can't be found,
  // nothing has been created yet, so there's no cleanup to do. ----
  let location;
  try {
    location = await geocodeSuburb(body.suburb);
  } catch (err) {
    console.error('Geocoding request failed:', err);
    return json({ error: 'Could not reach the geocoding service. Please try again shortly.' }, 502);
  }
  if (!location) {
    return json(
      { error: `Could not find "${body.suburb}". Try a more specific suburb name.` },
      400
    );
  }

  // ---- Hash the password ----
  const passwordHash = await hashPassword(body.password);

  // ---- Insert the user ----
  const userInsert = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, email_verified) VALUES (?, ?, 0)'
  )
    .bind(email, passwordHash)
    .run();
  const userId = userInsert.meta.last_row_id;

  try {
    // ---- Insert the printer profile ----
    const printerInsert = await env.DB.prepare(
      `INSERT INTO printers (
         user_id, alias, suburb, lat, lng, printer_model,
         build_x_mm, build_y_mm, build_z_mm, about,
         contact_email, contact_phone, accepts_submissions, offers_custom_design
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        userId,
        body.alias.trim(),
        body.suburb.trim(),
        location.lat,
        location.lng,
        body.printer_model.trim(),
        Number(body.build_x_mm),
        Number(body.build_y_mm),
        Number(body.build_z_mm),
        body.about ? body.about.trim() : null,
        body.contact_email.trim().toLowerCase(),
        body.contact_phone ? body.contact_phone.trim() : null,
        body.accepts_submissions ? 1 : 0,
        body.offers_custom_design ? 1 : 0
      )
      .run();
    const printerId = printerInsert.meta.last_row_id;

    // ---- Link chosen materials (silently skips names not in the materials table) ----
    if (Array.isArray(body.materials) && body.materials.length > 0) {
      const placeholders = body.materials.map(() => '?').join(',');
      const matches = await env.DB.prepare(
        `SELECT id FROM materials WHERE name IN (${placeholders})`
      )
        .bind(...body.materials)
        .all();

      for (const row of matches.results) {
        await env.DB.prepare(
          'INSERT INTO printer_materials (printer_id, material_id) VALUES (?, ?)'
        )
          .bind(printerId, row.id)
          .run();
      }
    }

    // ---- Log them in immediately with a session cookie ----
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(token, userId, expiresAt)
      .run();

    return json(
      {
        id: printerId,
        alias: body.alias.trim(),
        suburb: body.suburb.trim(),
        lat: location.lat,
        lng: location.lng,
      },
      201,
      {
        'Set-Cookie': `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${
          SESSION_DAYS * 24 * 60 * 60
        }`,
      }
    );
  } catch (err) {
    // Something after the user row failed — remove the orphaned account
    // rather than leaving a user with no printer profile attached.
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
    console.error('Signup failed after user creation, rolled back:', err);
    return json({ error: 'Something went wrong creating your listing. Please try again.' }, 500);
  }
}

function validate(body) {
  const errors = [];
  const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  if (!isEmail(body.email)) errors.push('A valid email is required.');
  if (typeof body.password !== 'string' || body.password.length < 8) {
    errors.push('Password must be at least 8 characters.');
  }
  if (!body.alias || !body.alias.trim()) errors.push('A display name is required.');
  if (!body.suburb || !body.suburb.trim()) errors.push('Suburb is required.');
  if (!body.printer_model || !body.printer_model.trim()) errors.push('Printer model is required.');
  if (!isEmail(body.contact_email)) errors.push('A valid contact email is required.');

  for (const dim of ['build_x_mm', 'build_y_mm', 'build_z_mm']) {
    const n = Number(body[dim]);
    if (!Number.isFinite(n) || n <= 0) errors.push(`${dim} must be a positive number.`);
  }

  return errors;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
