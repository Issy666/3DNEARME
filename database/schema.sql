-- ==========================================================================
-- LOCALPRINT — D1 SCHEMA
-- SQLite dialect (Cloudflare D1). Apply with:
--   wrangler d1 execute localprint --file=./schema.sql --local   (local test)
--   wrangler d1 execute localprint --file=./schema.sql           (remote)
-- ==========================================================================

PRAGMA foreign_keys = ON;

-- --------------------------------------------------------------------------
-- users — one row per account. A printer profile belongs to a user.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,          -- store a salted hash (Web Crypto PBKDF2/bcrypt-style), never plaintext
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0,1)),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------------------------
-- sessions — auth tokens. id is the random session token itself (used as
-- a bearer/cookie value), so lookups are a single indexed primary-key hit.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,           -- random token, e.g. crypto.randomUUID()
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- --------------------------------------------------------------------------
-- printers — the public profile / listing. One user could own more than
-- one printer, so this is its own table rather than columns on users.
-- lat/lng are geocoded once at signup or profile-edit time (via Nominatim)
-- and cached here — never geocode on every search.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS printers (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  alias                TEXT NOT NULL,     -- display name, e.g. "Owen's Garage Print Co."
  suburb               TEXT NOT NULL,
  postcode             TEXT,
  lat                  REAL NOT NULL,
  lng                  REAL NOT NULL,

  printer_model        TEXT NOT NULL,     -- e.g. "Bambu Lab P1S"
  build_x_mm           INTEGER NOT NULL,
  build_y_mm           INTEGER NOT NULL,
  build_z_mm           INTEGER NOT NULL,

  about                TEXT,

  contact_email        TEXT NOT NULL,
  contact_phone        TEXT,

  accepts_submissions  INTEGER NOT NULL DEFAULT 0 CHECK (accepts_submissions IN (0,1)),
  offers_custom_design INTEGER NOT NULL DEFAULT 0 CHECK (offers_custom_design IN (0,1)),

  last_active_at       TEXT NOT NULL DEFAULT (datetime('now')), -- bump on login/edit; drives "Active this week"
  visible              INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0,1)), -- soft hide instead of deleting

  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Search-path indexes: suburb text search, and a lat/lng bounding-box
-- pre-filter (SQLite has no native geo/trig functions, so the exact
-- haversine distance gets calculated in the Worker after this narrows
-- the candidate set).
CREATE INDEX IF NOT EXISTS idx_printers_suburb  ON printers(suburb);
CREATE INDEX IF NOT EXISTS idx_printers_lat     ON printers(lat);
CREATE INDEX IF NOT EXISTS idx_printers_lng     ON printers(lng);
CREATE INDEX IF NOT EXISTS idx_printers_visible ON printers(visible);

-- --------------------------------------------------------------------------
-- materials — lookup table so material names are consistent and filterable
-- (rather than free-text per printer). Seed with common ones; printers can
-- only pick from this list via printer_materials.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materials (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE               -- "PLA", "PETG", "ABS", "TPU", "Resin", "Nylon", ...
);

-- --------------------------------------------------------------------------
-- printer_materials — many-to-many join. A printer can offer several
-- materials; a material is offered by many printers.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS printer_materials (
  printer_id  INTEGER NOT NULL REFERENCES printers(id)  ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  PRIMARY KEY (printer_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_printer_materials_material ON printer_materials(material_id);

-- --------------------------------------------------------------------------
-- catalogue_items — pre-made designs a printer already has ready to order.
-- Only relevant when the printer offers the "print from catalogue" service;
-- an empty result set for a printer means that service isn't offered.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalogue_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  printer_id INTEGER NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  url        TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_catalogue_items_printer ON catalogue_items(printer_id);
