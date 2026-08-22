// functions/_lib/crypto.js
//
// Password hashing with Web Crypto's PBKDF2 — no external dependencies,
// works natively in the Workers runtime. Shared by signup.js now and
// login.js later (stage 7), so the hash format only needs to be defined once.
//
// Stored format: "pbkdf2$<iterations>$<saltBase64>$<hashBase64>"
// Storing the iteration count alongside the hash means you can raise it
// later without invalidating passwords hashed under the old value.

const ITERATIONS = 100_000; // OWASP-recommended minimum for PBKDF2-SHA256.
const HASH_ALGO = 'SHA-256';
const KEY_LENGTH_BITS = 256;

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashBuffer = await deriveBits(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${bufferToBase64(salt)}$${bufferToBase64(hashBuffer)}`;
}

export async function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, iterationsStr, saltB64, hashB64] = parts;
  const iterations = parseInt(iterationsStr, 10);
  const salt = base64ToBuffer(saltB64);
  const expected = base64ToBuffer(hashB64);
  const actual = new Uint8Array(await deriveBits(password, salt, iterations));
  return timingSafeEqual(actual, expected);
}

async function deriveBits(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: HASH_ALGO },
    keyMaterial,
    KEY_LENGTH_BITS
  );
}

function bufferToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToBuffer(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Constant-time comparison so a failed check doesn't leak timing info
// about how many bytes matched before it diverged.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}
