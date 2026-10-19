-- Same data model as the original SQLite app, created fresh for D1.

CREATE TABLE business (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  logo TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT 'Thank you for doing business with us.',
  theme_color TEXT NOT NULL DEFAULT '#9590E0',
  invoice_prefix TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  bank_account TEXT NOT NULL DEFAULT '',
  bank_ifsc TEXT NOT NULL DEFAULT '',
  bank_holder TEXT NOT NULL DEFAULT '',
  upi_id TEXT NOT NULL DEFAULT '',
  fy_numbering INTEGER NOT NULL DEFAULT 0,
  last_backup_at TEXT NOT NULL DEFAULT '',
  pin_hash TEXT NOT NULL DEFAULT '',
  auth_secret TEXT NOT NULL DEFAULT ''
);
INSERT INTO business (id) VALUES (1);

CREATE TABLE parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '',
  billing_address TEXT NOT NULL DEFAULT '',
  shipping_address TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  opening_balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  hsn TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'Pcs',
  sale_price REAL NOT NULL DEFAULT 0,
  purchase_price REAL NOT NULL DEFAULT 0,
  gst_rate REAL NOT NULL DEFAULT 18,
  stock REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Party details are copied onto the invoice so old invoices print exactly as
-- issued even if the party is edited later.
-- uid: lets the invoice lines in the same batch find their invoice.
-- num_key: "7" or "2026-27:7" (financial-year numbering); UNIQUE stops two
-- phones saving the same invoice number at the same moment.
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  num_key TEXT NOT NULL UNIQUE,
  invoice_no INTEGER NOT NULL,
  invoice_date TEXT NOT NULL,
  fy TEXT NOT NULL DEFAULT '',
  party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
  party_name TEXT NOT NULL,
  party_phone TEXT NOT NULL DEFAULT '',
  party_address TEXT NOT NULL DEFAULT '',
  party_gstin TEXT NOT NULL DEFAULT '',
  party_state TEXT NOT NULL DEFAULT '',
  place_of_supply TEXT NOT NULL DEFAULT '',
  is_inter INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  vehicle_no TEXT NOT NULL DEFAULT '',
  transporter TEXT NOT NULL DEFAULT '',
  discount REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  round_off REAL NOT NULL DEFAULT 0,
  round_off_on INTEGER NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  received REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_invoices_party ON invoices(party_id);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_fy_no ON invoices(fy, invoice_no);

CREATE TABLE invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  hsn TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  gst_rate REAL NOT NULL DEFAULT 0,
  taxable REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);

-- Money received after the sale, against a specific invoice.
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  mode TEXT NOT NULL DEFAULT 'Cash',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

-- Wrong-PIN counters (per IP, plus '*' for all devices together).
CREATE TABLE auth_failures (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  until INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT 0
);
