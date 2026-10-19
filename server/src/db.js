import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { financialYear, isInterState } from '../../shared/calc.js';

const here = dirname(fileURLToPath(import.meta.url));
export const dbPath = process.env.DB_PATH || join(here, '..', 'data', 'invoices.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath, { timeout: 5000 });
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}


db.exec(`
CREATE TABLE IF NOT EXISTS business (
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
  invoice_prefix TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO business (id) VALUES (1);

CREATE TABLE IF NOT EXISTS parties (
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

CREATE TABLE IF NOT EXISTS items (
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
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no INTEGER NOT NULL,
  invoice_date TEXT NOT NULL,
  party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
  party_name TEXT NOT NULL,
  party_phone TEXT NOT NULL DEFAULT '',
  party_address TEXT NOT NULL DEFAULT '',
  party_gstin TEXT NOT NULL DEFAULT '',
  party_state TEXT NOT NULL DEFAULT '',
  place_of_supply TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  subtotal REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  received REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  hsn TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  gst_rate REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(party_id);

-- Money received after the sale, against a specific invoice.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  mode TEXT NOT NULL DEFAULT 'Cash',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
`);

// ---------- Upgrades for databases created by older versions ----------

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Invoice numbers used to be unique forever; with financial-year numbering
// #1 can appear once per year, so the table-level UNIQUE has to go.
const invoicesSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'invoices'").get().sql;
if (/invoice_no INTEGER NOT NULL UNIQUE/.test(invoicesSql)) {
  db.exec('PRAGMA foreign_keys = OFF');
  transaction(() => {
    db.exec(`CREATE TABLE invoices_new ${invoicesSql.slice(invoicesSql.indexOf('(')).replace('invoice_no INTEGER NOT NULL UNIQUE', 'invoice_no INTEGER NOT NULL')}`);
    db.exec('INSERT INTO invoices_new SELECT * FROM invoices');
    db.exec('DROP TABLE invoices');
    db.exec('ALTER TABLE invoices_new RENAME TO invoices');
    db.exec('CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(party_id)');
  });
  db.exec('PRAGMA foreign_keys = ON');
}

for (const [col, def] of [
  ['bank_name', "TEXT NOT NULL DEFAULT ''"],
  ['bank_account', "TEXT NOT NULL DEFAULT ''"],
  ['bank_ifsc', "TEXT NOT NULL DEFAULT ''"],
  ['bank_holder', "TEXT NOT NULL DEFAULT ''"],
  ['upi_id', "TEXT NOT NULL DEFAULT ''"],
  ['fy_numbering', 'INTEGER NOT NULL DEFAULT 0'],
  ['last_backup_at', "TEXT NOT NULL DEFAULT ''"],
  ['pin_hash', "TEXT NOT NULL DEFAULT ''"],
  ['auth_secret', "TEXT NOT NULL DEFAULT ''"],
]) ensureColumn('business', col, def);

for (const [col, def] of [
  ['fy', "TEXT NOT NULL DEFAULT ''"],
  ['is_inter', 'INTEGER NOT NULL DEFAULT 0'],
  ['discount', 'REAL NOT NULL DEFAULT 0'],
  ['round_off', 'REAL NOT NULL DEFAULT 0'],
  ['round_off_on', 'INTEGER NOT NULL DEFAULT 0'],
  ['vehicle_no', "TEXT NOT NULL DEFAULT ''"],
  ['transporter', "TEXT NOT NULL DEFAULT ''"],
]) ensureColumn('invoices', col, def);

ensureColumn('invoice_items', 'discount_pct', 'REAL NOT NULL DEFAULT 0');
ensureColumn('invoice_items', 'taxable', 'REAL NOT NULL DEFAULT 0');

db.exec('CREATE INDEX IF NOT EXISTS idx_invoices_fy_no ON invoices(fy, invoice_no)');


// Fill the new columns for invoices saved before they existed.
{
  const businessState = db.prepare('SELECT state FROM business WHERE id = 1').get().state;
  const old = db.prepare("SELECT id, invoice_date, place_of_supply FROM invoices WHERE fy = ''").all();
  for (const inv of old) {
    db.prepare('UPDATE invoices SET fy = ?, is_inter = ? WHERE id = ?').run(
      financialYear(inv.invoice_date),
      isInterState(businessState, inv.place_of_supply) ? 1 : 0,
      inv.id,
    );
  }
  db.exec('UPDATE invoice_items SET taxable = ROUND(qty * price, 2) WHERE taxable = 0 AND qty * price != 0');
}
