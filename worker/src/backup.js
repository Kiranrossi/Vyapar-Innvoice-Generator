import { Hono } from 'hono';
import { HttpError, all, num, one, run, stmt } from './db.js';

// Backups are plain JSON built by the browser page by page, and restores are
// uploaded in chunks into staging tables and swapped in with one atomic batch.
// Small requests keep each one inside the free plan's CPU limit.

// Parents first (for inserting); reversed for deleting.
export const TABLES = ['business', 'parties', 'items', 'invoices', 'invoice_items', 'payments'];
const PAGE = 500;
const CHUNK = 100;

export const backupRoutes = new Hono();

const columns = async (db, table) => (await all(db, `PRAGMA table_info(${table})`)).map((c) => c.name);

function checkTable(table) {
  if (!TABLES.includes(table)) throw new HttpError(400, 'Unknown table');
  return table;
}

// GET /export?table=invoices&after=0 → { rows, next } (next is null at the end)
backupRoutes.get('/export', async (c) => {
  const db = c.env.DB;
  const table = checkTable(c.req.query('table'));
  const after = num(c.req.query('after'));
  const cols = (await columns(db, table)).filter((col) => col !== 'pin_hash' && col !== 'auth_secret');
  const rows = await all(db, `SELECT ${cols.join(', ')} FROM ${table} WHERE id > ? ORDER BY id LIMIT ${PAGE}`, after);
  return c.json({ rows, next: rows.length === PAGE ? rows[rows.length - 1].id : null });
});

backupRoutes.post('/backup/done', async (c) => {
  await run(c.env.DB, "UPDATE business SET last_backup_at = datetime('now') WHERE id = 1");
  return c.json({ ok: true });
});

backupRoutes.post('/restore/start', async (c) => {
  const db = c.env.DB;
  await db.batch(TABLES.flatMap((t) => [
    db.prepare(`DROP TABLE IF EXISTS restore_${t}`),
    db.prepare(`CREATE TABLE restore_${t} AS SELECT * FROM ${t} WHERE 0`),
  ]));
  return c.json({ ok: true });
});

backupRoutes.post('/restore/chunk', async (c) => {
  const db = c.env.DB;
  const { table, rows } = await c.req.json();
  checkTable(table);
  if (!Array.isArray(rows) || rows.length > CHUNK) throw new HttpError(400, `Send up to ${CHUNK} rows at a time`);
  if (!rows.length) return c.json({ ok: true });
  const known = await columns(db, `restore_${table}`);
  const statements = rows.map((row) => {
    const cols = known.filter((col) => col in row && col !== 'pin_hash' && col !== 'auth_secret');
    return stmt(db, `INSERT INTO restore_${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ...cols.map((col) => row[col]));
  });
  await db.batch(statements);
  return c.json({ ok: true, count: rows.length });
});

backupRoutes.post('/restore/finish', async (c) => {
  const db = c.env.DB;
  const staged = await one(db, 'SELECT COUNT(*) AS n FROM restore_business');
  if (!staged?.n) throw new HttpError(400, 'This backup has no business details, so it was not restored');

  const auth = await one(db, 'SELECT pin_hash, auth_secret FROM business WHERE id = 1');
  const statements = [
    // Backups from the first version had no uid / num_key.
    db.prepare("UPDATE restore_invoices SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL OR uid = ''"),
    db.prepare(`UPDATE restore_invoices SET num_key = CASE
        WHEN (SELECT fy_numbering FROM restore_business LIMIT 1) = 1 THEN fy || ':' || invoice_no
        ELSE CAST(invoice_no AS TEXT) END
      WHERE num_key IS NULL OR num_key = ''`),
  ];
  for (const t of [...TABLES].reverse()) statements.push(db.prepare(`DELETE FROM ${t}`));
  for (const t of TABLES) {
    // Columns missing from older backups arrive as NULL; fall back to the column default.
    const info = (await all(db, `PRAGMA table_info(${t})`)).filter((col) => col.name !== 'pin_hash' && col.name !== 'auth_secret');
    const names = info.map((col) => col.name).join(', ');
    const values = info
      .map((col) => (col.notnull && col.dflt_value != null ? `COALESCE(${col.name}, ${col.dflt_value})` : col.name))
      .join(', ');
    statements.push(db.prepare(`INSERT INTO ${t} (${names}) SELECT ${values} FROM restore_${t}`));
  }
  statements.push(stmt(db, 'UPDATE business SET pin_hash = ?, auth_secret = ? WHERE id = 1', auth.pin_hash, auth.auth_secret));
  await db.batch(statements);
  await db.batch(TABLES.map((t) => db.prepare(`DROP TABLE IF EXISTS restore_${t}`)));
  const counts = await one(db, 'SELECT (SELECT COUNT(*) FROM invoices) AS invoices, (SELECT COUNT(*) FROM parties) AS parties');
  return c.json({ ok: true, ...counts });
});
