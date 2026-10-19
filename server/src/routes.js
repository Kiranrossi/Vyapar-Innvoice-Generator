import express, { Router } from 'express';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, transaction } from './db.js';
import { writeBackup, restoreFrom } from './backup.js';
import { gstReport, gstWorkbook } from './reports.js';
import { calcInvoice, calcLine, financialYear, round2, today } from '../../shared/calc.js';
import { stateFromGstin } from '../../shared/states.js';

export const api = Router();

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const str = (v) => (v == null ? '' : String(v).trim());
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

// ---------- Business profile ----------

const BUSINESS_TEXT = ['name', 'address', 'phone', 'email', 'gstin', 'state', 'logo', 'signature', 'terms', 'theme_color',
  'invoice_prefix', 'bank_name', 'bank_account', 'bank_ifsc', 'bank_holder', 'upi_id'];
const BUSINESS_FIELDS = [...BUSINESS_TEXT, 'fy_numbering'];

export const getBusiness = () => {
  const { pin_hash, auth_secret, ...business } = db.prepare('SELECT * FROM business WHERE id = 1').get();
  return business;
};

api.get('/business', (req, res) => res.json(getBusiness()));

api.put('/business', (req, res) => {
  const current = getBusiness();
  const data = Object.fromEntries(BUSINESS_TEXT.map((f) => [f, f in req.body ? str(req.body[f]) : current[f]]));
  data.fy_numbering = 'fy_numbering' in req.body ? bool(req.body.fy_numbering) : current.fy_numbering;
  data.gstin = data.gstin.toUpperCase();
  data.bank_ifsc = data.bank_ifsc.toUpperCase();
  if (!data.state && data.gstin) data.state = stateFromGstin(data.gstin);
  if (!data.theme_color) data.theme_color = '#9590E0';
  db.prepare(`UPDATE business SET ${BUSINESS_FIELDS.map((f) => `${f} = :${f}`).join(', ')} WHERE id = 1`).run(data);
  res.json(getBusiness());
});

// ---------- Parties (customers) ----------

const PARTY_FIELDS = ['name', 'phone', 'email', 'gstin', 'billing_address', 'shipping_address', 'state', 'opening_balance'];

function cleanParty(body) {
  const p = Object.fromEntries(PARTY_FIELDS.map((f) => [f, str(body[f])]));
  p.gstin = p.gstin.toUpperCase();
  p.opening_balance = num(body.opening_balance);
  if (!p.state && p.gstin) p.state = stateFromGstin(p.gstin);
  if (!p.name) throw new HttpError(400, 'Party name is required');
  return p;
}

const PARTY_SELECT = `
  SELECT p.*,
    p.opening_balance + COALESCE((SELECT SUM(balance) FROM invoices i WHERE i.party_id = p.id), 0) AS balance,
    (SELECT COUNT(*) FROM invoices i WHERE i.party_id = p.id) AS invoice_count
  FROM parties p`;

const getParty = (id) => db.prepare(`${PARTY_SELECT} WHERE p.id = ?`).get(id);

function insertParty(p) {
  const exists = db.prepare('SELECT id FROM parties WHERE name = ?').get(p.name);
  if (exists) throw new HttpError(409, `A party named "${p.name}" already exists`);
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO parties (${PARTY_FIELDS.join(', ')}) VALUES (${PARTY_FIELDS.map((f) => ':' + f).join(', ')})`)
    .run(p);
  return Number(lastInsertRowid);
}

api.get('/parties', (req, res) => {
  res.json(db.prepare(`${PARTY_SELECT} ORDER BY p.name COLLATE NOCASE`).all());
});

api.get('/parties/:id', (req, res) => {
  const party = getParty(req.params.id);
  if (!party) throw new HttpError(404, 'Party not found');
  res.json(party);
});

api.post('/parties', (req, res) => {
  const id = insertParty(cleanParty(req.body));
  res.status(201).json(getParty(id));
});

api.put('/parties/:id', (req, res) => {
  const p = cleanParty(req.body);
  const clash = db.prepare('SELECT id FROM parties WHERE name = ? AND id != ?').get(p.name, req.params.id);
  if (clash) throw new HttpError(409, `A party named "${p.name}" already exists`);
  const { changes } = db
    .prepare(`UPDATE parties SET ${PARTY_FIELDS.map((f) => `${f} = :${f}`).join(', ')} WHERE id = :id`)
    .run({ ...p, id: Number(req.params.id) });
  if (!changes) throw new HttpError(404, 'Party not found');
  res.json(getParty(req.params.id));
});

api.delete('/parties/:id', (req, res) => {
  const used = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE party_id = ?').get(req.params.id).n;
  if (used) throw new HttpError(409, `This party has ${used} invoice(s). Delete those first.`);
  db.prepare('DELETE FROM parties WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// Ledger for one customer: sales are debits, money received is credits.
api.get('/parties/:id/statement', (req, res) => {
  const party = getParty(req.params.id);
  if (!party) throw new HttpError(404, 'Party not found');
  const from = str(req.query.from) || '0000-01-01';
  const to = str(req.query.to) || '9999-12-31';

  const invoices = db.prepare('SELECT * FROM invoices WHERE party_id = ? ORDER BY invoice_date, invoice_no').all(party.id);
  const payments = db
    .prepare(`SELECT p.*, i.invoice_no FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE i.party_id = ? ORDER BY p.payment_date, p.id`)
    .all(party.id);

  const entries = [];
  for (const inv of invoices) {
    entries.push({ date: inv.invoice_date, type: 'Sale', ref: inv.invoice_no, debit: inv.total, credit: 0, order: 0 });
    if (inv.received > 0) {
      entries.push({ date: inv.invoice_date, type: 'Payment (at sale)', ref: inv.invoice_no, debit: 0, credit: inv.received, order: 1 });
    }
  }
  for (const p of payments) {
    entries.push({ date: p.payment_date, type: `Payment (${p.mode})`, ref: p.invoice_no, note: p.note, debit: 0, credit: p.amount, order: 2 });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  let opening = party.opening_balance;
  const rows = [];
  for (const e of entries) {
    if (e.date < from) opening += e.debit - e.credit;
    else if (e.date <= to) rows.push(e);
  }
  let running = opening;
  for (const r of rows) {
    running = round2(running + r.debit - r.credit);
    r.balance = running;
    delete r.order;
  }
  res.json({
    party,
    from: req.query.from || '',
    to: req.query.to || '',
    opening: round2(opening),
    rows,
    total_debit: round2(rows.reduce((a, r) => a + r.debit, 0)),
    total_credit: round2(rows.reduce((a, r) => a + r.credit, 0)),
    closing: round2(running),
  });
});

// ---------- Items ----------

const ITEM_FIELDS = ['name', 'hsn', 'unit', 'sale_price', 'purchase_price', 'gst_rate', 'stock'];

function cleanItem(body) {
  const it = {
    name: str(body.name),
    hsn: str(body.hsn),
    unit: str(body.unit) || 'Pcs',
    sale_price: num(body.sale_price),
    purchase_price: num(body.purchase_price),
    gst_rate: body.gst_rate === undefined || body.gst_rate === '' ? 18 : num(body.gst_rate),
    stock: num(body.stock),
  };
  if (!it.name) throw new HttpError(400, 'Item name is required');
  return it;
}

function insertItem(it) {
  const exists = db.prepare('SELECT id FROM items WHERE name = ?').get(it.name);
  if (exists) throw new HttpError(409, `An item named "${it.name}" already exists`);
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO items (${ITEM_FIELDS.join(', ')}) VALUES (${ITEM_FIELDS.map((f) => ':' + f).join(', ')})`)
    .run(it);
  return Number(lastInsertRowid);
}

const getItem = (id) => db.prepare('SELECT * FROM items WHERE id = ?').get(id);

api.get('/items', (req, res) => {
  res.json(db.prepare('SELECT * FROM items ORDER BY name COLLATE NOCASE').all());
});

api.post('/items', (req, res) => {
  const id = insertItem(cleanItem(req.body));
  res.status(201).json(getItem(id));
});

api.put('/items/:id', (req, res) => {
  const it = cleanItem(req.body);
  const clash = db.prepare('SELECT id FROM items WHERE name = ? AND id != ?').get(it.name, req.params.id);
  if (clash) throw new HttpError(409, `An item named "${it.name}" already exists`);
  const { changes } = db
    .prepare(`UPDATE items SET ${ITEM_FIELDS.map((f) => `${f} = :${f}`).join(', ')} WHERE id = :id`)
    .run({ ...it, id: Number(req.params.id) });
  if (!changes) throw new HttpError(404, 'Item not found');
  res.json(getItem(req.params.id));
});

api.delete('/items/:id', (req, res) => {
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Invoices ----------

// With financial-year numbering on, numbers restart at 1 every April.
function nextInvoiceNo(date) {
  const business = getBusiness();
  const row = business.fy_numbering
    ? db.prepare('SELECT COALESCE(MAX(invoice_no), 0) + 1 AS n FROM invoices WHERE fy = ?').get(financialYear(date || today()))
    : db.prepare('SELECT COALESCE(MAX(invoice_no), 0) + 1 AS n FROM invoices').get();
  return row.n;
}

const paymentsTotal = (invoiceId) =>
  db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE invoice_id = ?').get(invoiceId).n;

function getInvoice(id) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!invoice) return null;
  invoice.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position').all(id);
  invoice.payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date, id').all(id);
  invoice.payments_total = round2(invoice.payments.reduce((a, p) => a + p.amount, 0));
  invoice.paid = round2(invoice.received + invoice.payments_total);
  return invoice;
}

function refreshBalance(invoiceId) {
  db.prepare(`UPDATE invoices SET balance = ROUND(total - received - ?, 2) WHERE id = ?`).run(paymentsTotal(invoiceId), invoiceId);
}

api.get('/invoices', (req, res) => {
  const where = [];
  const params = {};
  if (req.query.party_id) {
    where.push('party_id = :party_id');
    params.party_id = Number(req.query.party_id);
  }
  if (req.query.from) {
    where.push('invoice_date >= :from');
    params.from = req.query.from;
  }
  if (req.query.to) {
    where.push('invoice_date <= :to');
    params.to = req.query.to;
  }
  const sql = `SELECT *, ROUND(total - balance, 2) AS paid FROM invoices
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY invoice_date DESC, invoice_no DESC`;
  res.json(db.prepare(sql).all(params));
});

// Vehicle numbers used on earlier invoices, newest first, so he can pick instead of retyping.
api.get('/vehicles', (req, res) => {
  res.json(db.prepare(`SELECT vehicle_no, transporter, MAX(invoice_date) AS last_used, COUNT(*) AS times
    FROM invoices WHERE vehicle_no != '' GROUP BY vehicle_no ORDER BY last_used DESC, times DESC`).all());
});

api.get('/invoices/next-number', (req, res) => res.json({ invoice_no: nextInvoiceNo(str(req.query.date)) }));

api.get('/invoices/:id', (req, res) => {
  const invoice = getInvoice(req.params.id);
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  res.json(invoice);
});

// Find the party by id or name, creating it if it's new. This is what makes a
// customer typed on the sale screen show up in the list next time.
function resolveParty(body) {
  const name = str(body.party_name);
  if (!name) throw new HttpError(400, 'Choose or enter a customer name');
  let party = body.party_id ? db.prepare('SELECT * FROM parties WHERE id = ?').get(body.party_id) : null;
  if (!party) party = db.prepare('SELECT * FROM parties WHERE name = ?').get(name);
  if (!party) {
    const id = insertParty(
      cleanParty({
        name,
        phone: body.party_phone,
        gstin: body.party_gstin,
        billing_address: body.party_address,
        state: body.party_state,
      }),
    );
    party = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
  }
  return party;
}

// Same idea for items: a new item name on the sale screen is saved to the item list.
function resolveItem(line) {
  let item = line.item_id ? getItem(line.item_id) : null;
  if (!item) item = db.prepare('SELECT * FROM items WHERE name = ?').get(line.name);
  if (!item) {
    const id = insertItem({
      name: line.name,
      hsn: line.hsn,
      unit: line.unit || 'Pcs',
      sale_price: line.price,
      purchase_price: 0,
      gst_rate: line.gst_rate,
      stock: 0,
    });
    item = getItem(id);
  }
  return item;
}

const adjustStock = (itemId, delta) => {
  if (itemId) db.prepare('UPDATE items SET stock = stock + ? WHERE id = ?').run(delta, itemId);
};

function saveInvoice(body, existingId) {
  return transaction(() => {
    const business = getBusiness();
    const lines = (Array.isArray(body.items) ? body.items : [])
      .map((l) => ({
        item_id: l.item_id || null,
        name: str(l.name),
        hsn: str(l.hsn),
        qty: num(l.qty),
        unit: str(l.unit),
        price: num(l.price),
        discount_pct: Math.min(Math.max(num(l.discount_pct), 0), 100),
        gst_rate: num(l.gst_rate),
      }))
      .filter((l) => l.name);
    if (!lines.length) throw new HttpError(400, 'Add at least one item');
    if (lines.some((l) => l.qty <= 0)) throw new HttpError(400, 'Every item needs a quantity above zero');

    const invoiceDate = str(body.invoice_date) || today();
    const fy = financialYear(invoiceDate);
    const invoiceNo = body.invoice_no ? parseInt(body.invoice_no, 10) : nextInvoiceNo(invoiceDate);
    if (!Number.isInteger(invoiceNo) || invoiceNo < 1) throw new HttpError(400, 'Invoice number must be a positive whole number');
    const clash = business.fy_numbering
      ? db.prepare('SELECT id FROM invoices WHERE invoice_no = ? AND fy = ? AND id != ?').get(invoiceNo, fy, existingId || 0)
      : db.prepare('SELECT id FROM invoices WHERE invoice_no = ? AND id != ?').get(invoiceNo, existingId || 0);
    if (clash) {
      throw new HttpError(409, `Invoice number ${invoiceNo} is already used${business.fy_numbering ? ` in ${fy}` : ''}`);
    }

    const party = resolveParty(body);
    const partyState = str(body.party_state) || party.state;
    const placeOfSupply = str(body.place_of_supply) || partyState || business.state;
    const laterPayments = existingId ? paymentsTotal(existingId) : 0;
    const received = round2(Math.max(num(body.received), 0));
    const roundOffOn = bool(body.round_off_on);
    const totals = calcInvoice(lines, {
      businessState: business.state,
      placeOfSupply,
      received: received + laterPayments,
      roundOff: roundOffOn,
    });
    if (totals.balance < -0.005) {
      throw new HttpError(400, laterPayments
        ? `Received + later payments (₹${round2(received + laterPayments)}) is more than the invoice total (₹${totals.total})`
        : `Received (₹${received}) is more than the invoice total (₹${totals.total})`);
    }

    for (const line of lines) {
      const item = resolveItem(line);
      line.item_id = item.id;
      if (!line.unit) line.unit = item.unit;
    }

    const row = {
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      fy,
      party_id: party.id,
      party_name: party.name,
      party_phone: str(body.party_phone) || party.phone,
      party_address: str(body.party_address) || party.billing_address,
      party_gstin: (str(body.party_gstin) || party.gstin).toUpperCase(),
      party_state: partyState,
      place_of_supply: placeOfSupply,
      is_inter: totals.inter ? 1 : 0,
      description: str(body.description),
      vehicle_no: str(body.vehicle_no).toUpperCase().replace(/\s+/g, ' '),
      transporter: str(body.transporter),
      discount: totals.discount,
      subtotal: totals.subtotal,
      tax: totals.tax,
      round_off: totals.roundOff,
      round_off_on: roundOffOn,
      total: totals.total,
      received,
      balance: totals.balance,
    };
    const cols = Object.keys(row);

    let id = existingId;
    if (existingId) {
      // Put back the stock taken by the old version of this invoice.
      for (const old of db.prepare('SELECT item_id, qty FROM invoice_items WHERE invoice_id = ?').all(id)) {
        adjustStock(old.item_id, old.qty);
      }
      db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(id);
      db.prepare(`UPDATE invoices SET ${cols.map((c) => `${c} = :${c}`).join(', ')}, updated_at = datetime('now') WHERE id = :id`)
        .run({ ...row, id });
    } else {
      id = Number(
        db.prepare(`INSERT INTO invoices (${cols.join(', ')}) VALUES (${cols.map((c) => ':' + c).join(', ')})`).run(row)
          .lastInsertRowid,
      );
    }

    const insertLine = db.prepare(`INSERT INTO invoice_items
      (invoice_id, position, item_id, name, hsn, qty, unit, price, discount_pct, gst_rate, taxable, tax, amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    lines.forEach((l, i) => {
      const { taxable, tax, amount } = calcLine(l);
      insertLine.run(id, i, l.item_id, l.name, l.hsn, l.qty, l.unit, l.price, l.discount_pct, l.gst_rate, taxable, tax, amount);
      adjustStock(l.item_id, -l.qty);
    });

    return getInvoice(id);
  });
}

api.post('/invoices', (req, res) => res.status(201).json(saveInvoice(req.body)));

api.put('/invoices/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM invoices WHERE id = ?').get(id)) throw new HttpError(404, 'Invoice not found');
  res.json(saveInvoice(req.body, id));
});

api.delete('/invoices/:id', (req, res) => {
  transaction(() => {
    for (const old of db.prepare('SELECT item_id, qty FROM invoice_items WHERE invoice_id = ?').all(req.params.id)) {
      adjustStock(old.item_id, old.qty);
    }
    db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  });
  res.status(204).end();
});

// ---------- Payments received later ----------

const PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card', 'Other'];

api.post('/invoices/:id/payments', (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  const amount = round2(num(req.body.amount));
  if (amount <= 0) throw new HttpError(400, 'Enter the amount received');
  if (amount > invoice.balance + 0.005) {
    throw new HttpError(400, `Only ₹${invoice.balance} is due on this invoice`);
  }
  const mode = PAYMENT_MODES.includes(req.body.mode) ? req.body.mode : 'Cash';
  transaction(() => {
    db.prepare('INSERT INTO payments (invoice_id, payment_date, amount, mode, note) VALUES (?, ?, ?, ?, ?)')
      .run(invoice.id, str(req.body.payment_date) || today(), amount, mode, str(req.body.note));
    refreshBalance(invoice.id);
  });
  res.status(201).json(getInvoice(invoice.id));
});

api.delete('/payments/:id', (req, res) => {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!payment) throw new HttpError(404, 'Payment not found');
  transaction(() => {
    db.prepare('DELETE FROM payments WHERE id = ?').run(payment.id);
    refreshBalance(payment.invoice_id);
  });
  res.json(getInvoice(payment.invoice_id));
});

// ---------- Reports ----------

api.get('/reports/gst', (req, res) => {
  res.json(gstReport(str(req.query.from), str(req.query.to)));
});

api.get('/reports/gst.xlsx', async (req, res) => {
  const from = str(req.query.from);
  const to = str(req.query.to);
  const buffer = await gstWorkbook(gstReport(from, to), getBusiness());
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="GST_Sales_${from || 'all'}_to_${to || 'all'}.xlsx"`);
  res.send(Buffer.from(buffer));
});

// ---------- Backup & restore ----------

api.get('/backup', (req, res) => {
  const name = `${(getBusiness().name || 'invoices').replace(/[^\w]+/g, '_')}_backup_${today()}.db`;
  // Record the date first so the backup itself remembers when it was taken.
  db.prepare("UPDATE business SET last_backup_at = datetime('now') WHERE id = 1").run();
  const file = writeBackup(join(tmpdir(), `invoice-backup-${Date.now()}.db`));
  res.download(file, name, () => rmSync(file, { force: true }));
});

api.post('/restore', express.raw({ type: 'application/octet-stream', limit: '200mb' }), (req, res) => {
  if (!req.body?.length) throw new HttpError(400, 'Choose a backup file');
  if (req.body.subarray(0, 15).toString() !== 'SQLite format 3') throw new HttpError(400, 'This file is not a backup from this app');
  const file = join(tmpdir(), `invoice-restore-${Date.now()}.db`);
  writeFileSync(file, req.body);
  try {
    restoreFrom(file);
  } finally {
    rmSync(file, { force: true });
  }
  res.json({ ok: true, invoices: db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n });
});

// ---------- Dashboard ----------

api.get('/dashboard', (req, res) => {
  const month = today().slice(0, 7);
  const totals = db
    .prepare(`SELECT COALESCE(SUM(total), 0) AS sales, COALESCE(SUM(balance), 0) AS receivable,
      COUNT(*) AS count FROM invoices`)
    .get();
  const monthSales = db
    .prepare(`SELECT COALESCE(SUM(total), 0) AS sales, COUNT(*) AS count FROM invoices WHERE substr(invoice_date, 1, 7) = ?`)
    .get(month);
  const opening = db.prepare('SELECT COALESCE(SUM(opening_balance), 0) AS n FROM parties').get().n;
  const recent = db.prepare('SELECT * FROM invoices ORDER BY invoice_date DESC, invoice_no DESC LIMIT 8').all();
  const counts = db.prepare('SELECT (SELECT COUNT(*) FROM parties) AS parties, (SELECT COUNT(*) FROM items) AS items').get();
  res.json({
    ...totals,
    receivable: totals.receivable + opening,
    month_sales: monthSales.sales,
    month_count: monthSales.count,
    ...counts,
    recent,
  });
});

// ---------- Errors ----------

api.use((req, res) => res.status(404).json({ error: 'Not found' }));

api.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Upload is too large' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});
