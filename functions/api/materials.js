// functions/api/materials.js
//
// GET /api/materials
// Returns every material name in the lookup table, e.g. ["ABS","Nylon","PETG",...]
// Lets signup.html build its chip list from the DB instead of a hardcoded array,
// so adding a new material only ever means one INSERT, not an HTML edit too.

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT name FROM materials ORDER BY name').all();
  return new Response(JSON.stringify(results.map((r) => r.name)), {
    headers: { 'Content-Type': 'application/json' },
  });
}
