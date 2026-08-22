// functions/_lib/geocode.js
//
// Wraps a single Nominatim lookup. Called ONLY from signup/edit flows —
// never from search — to respect Nominatim's usage policy (max 1 request/sec,
// no bulk/live geocoding, and a real identifying User-Agent required).
// https://operations.osmfoundation.org/policies/nominatim/

// Replace with your actual project name/contact — Nominatim's policy
// requires a way to identify and reach the operator of automated requests.
const USER_AGENT = '3dnearme/1.0 (contact: isabelbarton33@gmail.com)';

/**
 * @param {string} suburb - free-text suburb/postcode the user typed
 * @param {string} countryCode - ISO 3166-1 alpha-2, restricts results to one country
 * @returns {Promise<{lat:number, lng:number, displayName:string} | null>}
 */
export async function geocodeSuburb(suburb, countryCode = 'au') {
  const query = suburb.trim();
  if (!query) return null;

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', countryCode);
  url.searchParams.set('q', query);

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`Nominatim request failed with status ${res.status}`);
  }

  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const [{ lat, lon, display_name }] = results;
  return {
    lat: parseFloat(lat),
    lng: parseFloat(lon),
    displayName: display_name,
  };
}
