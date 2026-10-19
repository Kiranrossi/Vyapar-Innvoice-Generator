import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { db, dbPath, transaction } from './db.js';
import { today } from '../../shared/calc.js';

export const backupDir = join(dirname(dbPath), 'backups');
const KEEP = 30;

// VACUUM INTO writes a clean, consistent copy even while the app is in use.
export function writeBackup(file) {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

// One automatic copy per day in server/data/backups, keeping the last 30.
export function dailyBackup() {
  try {
    const file = join(backupDir, `auto-${today()}.db`);
    if (!existsSync(file)) writeBackup(file);
    const autos = readdirSync(backupDir).filter((f) => f.startsWith('auto-')).sort();
    for (const old of autos.slice(0, Math.max(0, autos.length - KEEP))) rmSync(join(backupDir, old));
  } catch (err) {
    console.error('Automatic backup failed:', err.message);
  }
}

// Child tables first when deleting, parents first when inserting.
const TABLES = ['business', 'parties', 'items', 'invoices', 'invoice_items', 'payments'];

export function restoreFrom(file) {
  const check = new DatabaseSync(file, { readOnly: true });
  try {
    const names = check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    if (!['business', 'invoices', 'invoice_items'].every((t) => names.includes(t))) {
      throw Object.assign(new Error('This file is not a backup from this app'), { status: 400 });
    }
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(new Error('This file is not a backup from this app'), { status: 400 });
  } finally {
    check.close();
  }

  writeBackup(join(backupDir, `before-restore-${Date.now()}.db`));
  const auth = db.prepare('SELECT pin_hash, auth_secret FROM business WHERE id = 1').get();
  db.exec(`ATTACH DATABASE '${file.replace(/'/g, "''")}' AS src`);
  try {
    transaction(() => {
      for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM main.${t}`);
      for (const t of TABLES) {
        const srcCols = db.prepare(`PRAGMA src.table_info(${t})`).all().map((c) => c.name);
        if (!srcCols.length) continue;
        const mainCols = db.prepare(`PRAGMA main.table_info(${t})`).all().map((c) => c.name);
        const cols = mainCols.filter((c) => srcCols.includes(c)).join(', ');
        db.exec(`INSERT INTO main.${t} (${cols}) SELECT ${cols} FROM src.${t}`);
      }
      db.prepare('UPDATE business SET pin_hash = ?, auth_secret = ? WHERE id = 1').run(auth.pin_hash, auth.auth_secret);
    });
  } finally {
    db.exec('DETACH DATABASE src');
  }
}
