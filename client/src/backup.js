import { api } from './api.js';
import { today } from '@shared/calc.js';
import { saveBlob } from './pdf/InvoicePDF.jsx';

const TABLES = ['business', 'parties', 'items', 'invoices', 'invoice_items', 'payments'];
const CHUNK = 100;
export const BACKUP_FORMAT = 'invoice-generator-backup';

// Downloads every table page by page and saves one JSON file.
export async function downloadBackup() {
  const data = {};
  for (const table of TABLES) {
    data[table] = [];
    let after = 0;
    for (;;) {
      const { rows, next } = await api.get(`/export?table=${table}&after=${after}`);
      data[table].push(...rows);
      if (next == null) break;
      after = next;
    }
  }
  const name = (data.business[0]?.name || 'invoices').replace(/[^\w]+/g, '_');
  const file = { format: BACKUP_FORMAT, version: 2, created_at: new Date().toISOString(), data };
  saveBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${name}_backup_${today()}.json`);
  await api.post('/backup/done');
  return data.invoices.length;
}

// Uploads a backup file in small pieces, then swaps it in all at once.
export async function restoreBackup(file, onProgress = () => {}) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('This file is not a backup from this app');
  }
  if (parsed?.format !== BACKUP_FORMAT || !parsed.data?.business?.length) throw new Error('This file is not a backup from this app');

  await api.post('/restore/start');
  const total = TABLES.reduce((n, t) => n + (parsed.data[t]?.length || 0), 0);
  let done = 0;
  for (const table of TABLES) {
    const rows = parsed.data[table] || [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      await api.post('/restore/chunk', { table, rows: rows.slice(i, i + CHUNK) });
      done += Math.min(CHUNK, rows.length - i);
      onProgress(Math.round((done / Math.max(total, 1)) * 100));
    }
  }
  return api.post('/restore/finish');
}
