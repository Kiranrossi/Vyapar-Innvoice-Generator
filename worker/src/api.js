import { Hono } from 'hono';
import { HttpError, all, bool, isUniqueError, num, one, run, stmt, str } from './db.js';
import { gstReport } from './reports.js';
import { backupRoutes } from './backup.js';
import { calcInvoice, calcLine, financialYear, round2, today } from '../../shared/calc.js';
import { stateFromGstin } from '../../shared/states.js';

export const api = new Hono();

const body = (c) => c.req.json().catch(() => ({}));

// ---------- Business profile ----------

const BUSINESS_TEXT = ['name', 'address', 'phone', 'email', 'gstin', 'state', 'logo', 'signature', 'terms', 'theme_color',
  'invoice_prefix', 'bank_name', 'bank_account', 'bank_ifsc', 'bank_holder', 'upi_id'];
const BUSINESS_FIELDS = [...BUSINESS_TEXT, 'fy_numbering'];

export async function getBusiness(db) {
  const { pin_hash, auth_secret, ...business } = await one(db, 'SELECT * FROM business WHERE id = 1');
  return business;
}

api.get('/business', async (c) => c.json(await getBusiness(c.env.DB)));

api.put('/business', async (c) => {
  const db = c.env.DB;
  const b = await body(c);
  const current = await getBusiness(db);
  const data = Object.fromEntries(BUSINESS_TEXT.map((f) => [f, f in b ? str(b[f]) : current[f]]));
  data.fy_numbering = 'fy_numbering' in b ? bool(b.fy_numbering) : current.fy_numbering;
  data.gstin = data.gstin.toUpperCase();
  data.bank_ifsc = data.bank_ifsc.toUpperCase();
  if (!data.state && data.gstin) data.state = stateFromGstin(data.gstin);
  if (!data.theme_color) data.theme_color = '#9590E0';
  await run(db, `UPDATE business SET ${BUSINESS_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = 1`, ...BUSINESS_FIELDS.map((f) => data[f]));
  return c.json(await getBusiness(db));
});

// ---------- Parties (customers) ----------

const PARTY_FIELDS = ['name', 'phone', 'email', 'gstin', 'billing_address', 'shipping_address', 'state', 'opening_balance'];

function cleanParty(b) {
  const p = Object.fromEntries(PARTY_FIELDS.map((f) => [f, str(b[f])]));
  p.gstin = p.gstin.toUpperCase();
  p.opening_balance = num(b.opening_balance);
  if (!p.state && p.gstin) p.state = stateFromGstin(p.gstin);
  if (!p.name) throw new HttpError(400, 'Party name is required');
  return p;
}

const PARTY_SELECT = `
  SELECT p.*,
    p.opening_balance + COALESCE((SELECT SUM(balance) FROM invoices i WHERE i.party_id = p.id), 0) AS balance,
    (SELECT COUNT(*) FROM invoices i WHERE i.party_id = p.id) AS invoice_count
  FROM parties p`;

const getParty = (db, id) => one(db, `${PARTY_SELECT} WHERE p.id = ?`, Number(id));

async function insertParty(db, p) {
  if (await one(db, 'SELECT id FROM parties WHERE name = ?', p.name)) throw new HttpError(409, `A party named "${p.name}" already exists`);
  const { meta } = await run(db, `INSERT INTO parties (${PARTY_FIELDS.join(', ')}) VALUES (${PARTY_FIELDS.map(() => '?').join(', ')})`,
    ...PARTY_FIELDS.map((f) => p[f]));
  return meta.last_row_id;
}

api.get('/parties', async (c) => c.json(await all(c.env.DB, `${PARTY_SELECT} ORDER BY p.name COLLATE NOCASE`)));

api.get('/parties/:id', async (c) => {
  const party = await getParty(c.env.DB, c.req.param('id'));
  if (!party) throw new HttpError(404, 'Party not found');
  return c.json(party);
});

api.post('/parties', async (c) => {
  const id = await insertParty(c.env.DB, cleanParty(await body(c)));
  return c.json(await getParty(c.env.DB, id), 201);
});

api.put('/parties/:id', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const p = cleanParty(await body(c));
  if (await one(db, 'SELECT id FROM parties WHERE name = ? AND id != ?', p.name, id)) throw new HttpError(409, `A party named "${p.name}" already exists`);
  const { meta } = await run(db, `UPDATE parties SET ${PARTY_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, ...PARTY_FIELDS.map((f) => p[f]), id);
  if (!meta.changes) throw new HttpError(404, 'Party not found');
  return c.json(await getParty(db, id));
});

api.delete('/parties/:id', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const used = (await one(db, 'SELECT COUNT(*) AS n FROM invoices WHERE party_id = ?', id)).n;
  if (used) throw new HttpError(409, `This party has ${used} invoice(s). Delete those first.`);
  await run(db, 'DELETE FROM parties WHERE id = ?', id);
  return c.body(null, 204);
});

// Ledger for one customer: sales are debits, money received is credits.
api.get('/parties/:id/statement', async (c) => {
  const db = c.env.DB;
  const party = await getParty(db, c.req.param('id'));
  if (!party) throw new HttpError(404, 'Party not found');
  const from = str(c.req.query('from')) || '0000-01-01';
  const to = str(c.req.query('to')) || '9999-12-31';

  const [invoices, payments] = await Promise.all([
    all(db, 'SELECT invoice_no, invoice_date, total, received FROM invoices WHERE party_id = ? ORDER BY invoice_date, invoice_no', party.id),
    all(db, `SELECT p.payment_date, p.amount, p.mode, p.note, i.invoice_no FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE i.party_id = ? ORDER BY p.payment_date, p.id`, party.id),
  ]);

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
  return c.json({
    party,
    from: c.req.query('from') || '',
    to: c.req.query('to') || '',
    opening: round2(opening),
    rows,
    total_debit: round2(rows.reduce((a, r) => a + r.debit, 0)),
    total_credit: round2(rows.reduce((a, r) => a + r.credit, 0)),
    closing: round2(running),
  });
});

// ---------- Items ----------

const ITEM_FIELDS = ['name', 'hsn', 'unit', 'sale_price', 'purchase_price', 'gst_rate', 'stock'];

function cleanItem(b) {
  const it = {
    name: str(b.name),
    hsn: str(b.hsn),
    unit: str(b.unit) || 'Pcs',
    sale_price: num(b.sale_price),
    purchase_price: num(b.purchase_price),
    gst_rate: b.gst_rate === undefined || b.gst_rate === '' ? 18 : num(b.gst_rate),
    stock: num(b.stock),
  };
  if (!it.name) throw new HttpError(400, 'Item name is required');
  return it;
}

async function insertItem(db, it) {
  if (await one(db, 'SELECT id FROM items WHERE name = ?', it.name)) throw new HttpError(409, `An item named "${it.name}" already exists`);
  const { meta } = await run(db, `INSERT INTO items (${ITEM_FIELDS.join(', ')}) VALUES (${ITEM_FIELDS.map(() => '?').join(', ')})`,
    ...ITEM_FIELDS.map((f) => it[f]));
  return meta.last_row_id;
}

const getItem = (db, id) => one(db, 'SELECT * FROM items WHERE id = ?', Number(id));

api.get('/items', async (c) => c.json(await all(c.env.DB, 'SELECT * FROM items ORDER BY name COLLATE NOCASE')));

api.post('/items', async (c) => {
  const id = await insertItem(c.env.DB, cleanItem(await body(c)));
  return c.json(await getItem(c.env.DB, id), 201);
});

api.put('/items/:id', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const it = cleanItem(await body(c));
  if (await one(db, 'SELECT id FROM items WHERE name = ? AND id != ?', it.name, id)) throw new HttpError(409, `An item named "${it.name}" already exists`);
  const { meta } = await run(db, `UPDATE items SET ${ITEM_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, ...ITEM_FIELDS.map((f) => it[f]), id);
  if (!meta.changes) throw new HttpError(404, 'Item not found');
  return c.json(await getItem(db, id));
});

api.delete('/items/:id', async (c) => {
  await run(c.env.DB, 'DELETE FROM items WHERE id = ?', Number(c.req.param('id')));
  return c.body(null, 204);
});

// ---------- Invoices ----------

// With financial-year numbering on, numbers restart at 1 every April.
async function nextInvoiceNo(db, business, date) {
  const row = business.fy_numbering
    ? await one(db, 'SELECT COALESCE(MAX(invoice_no), 0) + 1 AS n FROM invoices WHERE fy = ?', financialYear(date || today()))
    : await one(db, 'SELECT COALESCE(MAX(invoice_no), 0) + 1 AS n FROM invoices');
  return row.n;
}

const numKey = (business, fy, no) => (business.fy_numbering ? `${fy}:${no}` : String(no));

const paymentsTotal = async (db, invoiceId) =>
  (await one(db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE invoice_id = ?', invoiceId)).n;

async function getInvoice(db, id) {
  const invoice = await one(db, 'SELECT * FROM invoices WHERE id = ?', Number(id));
  if (!invoice) return null;
  const [items, payments] = await Promise.all([
    all(db, 'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position', invoice.id),
    all(db, 'SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date, id', invoice.id),
  ]);
  invoice.items = items;
  invoice.payments = payments;
  invoice.payments_total = round2(payments.reduce((a, p) => a + p.amount, 0));
  invoice.paid = round2(invoice.received + invoice.payments_total);
  return invoice;
}

const refreshBalance = (db, invoiceId) =>
  stmt(db, `UPDATE invoices SET balance = ROUND(total - received - (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = ?), 2)
    WHERE id = ?`, invoiceId, invoiceId);

api.get('/invoices', async (c) => {
  const where = [];
  const params = [];
  if (c.req.query('party_id')) {
    where.push('party_id = ?');
    params.push(Number(c.req.query('party_id')));
  }
  if (c.req.query('from')) {
    where.push('invoice_date >= ?');
    params.push(c.req.query('from'));
  }
  if (c.req.query('to')) {
    where.push('invoice_date <= ?');
    params.push(c.req.query('to'));
  }
  const sql = `SELECT id, invoice_no, invoice_date, party_id, party_name, party_phone, total, received, balance,
      ROUND(total - balance, 2) AS paid FROM invoices
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY invoice_date DESC, invoice_no DESC`;
  return c.json(await all(c.env.DB, sql, ...params));
});

api.get('/invoices/next-number', async (c) => {
  const db = c.env.DB;
  return c.json({ invoice_no: await nextInvoiceNo(db, await getBusiness(db), str(c.req.query('date'))) });
});

// Vehicle numbers used on earlier invoices, newest first, so he can pick instead of retyping.
api.get('/vehicles', async (c) => {
  return c.json(await all(c.env.DB, `SELECT vehicle_no, transporter, MAX(invoice_date) AS last_used, COUNT(*) AS times
    FROM invoices WHERE vehicle_no != '' GROUP BY vehicle_no ORDER BY last_used DESC, times DESC`));
});

api.get('/invoices/:id', async (c) => {
  const invoice = await getInvoice(c.env.DB, c.req.param('id'));
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  return c.json(invoice);
});

// Find the party by id or name, creating it if it's new. This is what makes a
// customer typed on the sale screen show up in the list next time.
async function resolveParty(db, b) {
  const name = str(b.party_name);
  if (!name) throw new HttpError(400, 'Choose or enter a customer name');
  let party = b.party_id ? await one(db, 'SELECT * FROM parties WHERE id = ?', Number(b.party_id)) : null;
  if (!party) party = await one(db, 'SELECT * FROM parties WHERE name = ?', name);
  if (!party) {
    const id = await insertParty(db, cleanParty({
      name,
      phone: b.party_phone,
      gstin: b.party_gstin,
      billing_address: b.party_address,
      state: b.party_state,
    }));
    party = await one(db, 'SELECT * FROM parties WHERE id = ?', id);
  }
  return party;
}

// Same idea for items: a new item name on the sale screen is saved to the item list.
async function resolveItem(db, line) {
  let item = line.item_id ? await getItem(db, line.item_id) : null;
  if (!item) item = await one(db, 'SELECT * FROM items WHERE name = ?', line.name);
  if (!item) {
    const id = await insertItem(db, {
      name: line.name, hsn: line.hsn, unit: line.unit || 'Pcs', sale_price: line.price, purchase_price: 0, gst_rate: line.gst_rate, stock: 0,
    });
    item = await getItem(db, id);
  }
  return item;
}

async function saveInvoice(db, b, existingId) {
  const business = await getBusiness(db);
  const lines = (Array.isArray(b.items) ? b.items : [])
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

  const existing = existingId ? await one(db, 'SELECT id, uid FROM invoices WHERE id = ?', existingId) : null;
  if (existingId && !existing) throw new HttpError(404, 'Invoice not found');

  const invoiceDate = str(b.invoice_date) || today();
  const fy = financialYear(invoiceDate);
  const autoNumber = !b.invoice_no;
  let invoiceNo = autoNumber ? await nextInvoiceNo(db, business, invoiceDate) : parseInt(b.invoice_no, 10);
  if (!Number.isInteger(invoiceNo) || invoiceNo < 1) throw new HttpError(400, 'Invoice number must be a positive whole number');
  const clash = business.fy_numbering
    ? await one(db, 'SELECT id FROM invoices WHERE invoice_no = ? AND fy = ? AND id != ?', invoiceNo, fy, existingId || 0)
    : await one(db, 'SELECT id FROM invoices WHERE invoice_no = ? AND id != ?', invoiceNo, existingId || 0);
  if (clash) throw new HttpError(409, `Invoice number ${invoiceNo} is already used${business.fy_numbering ? ` in ${fy}` : ''}`);

  const party = await resolveParty(db, b);
  const partyState = str(b.party_state) || party.state;
  const placeOfSupply = str(b.place_of_supply) || partyState || business.state;
  const laterPayments = existingId ? await paymentsTotal(db, existingId) : 0;
  const received = round2(Math.max(num(b.received), 0));
  const roundOffOn = bool(b.round_off_on);
  const totals = calcInvoice(lines, { businessState: business.state, placeOfSupply, received: received + laterPayments, roundOff: roundOffOn });
  if (totals.balance < -0.005) {
    throw new HttpError(400, laterPayments
      ? `Received + later payments (₹${round2(received + laterPayments)}) is more than the invoice total (₹${totals.total})`
      : `Received (₹${received}) is more than the invoice total (₹${totals.total})`);
  }

  for (const line of lines) {
    const item = await resolveItem(db, line);
    line.item_id = item.id;
    if (!line.unit) line.unit = item.unit;
  }

  const uid = existing?.uid || crypto.randomUUID();
  const row = {
    invoice_no: invoiceNo,
    num_key: numKey(business, fy, invoiceNo),
    invoice_date: invoiceDate,
    fy,
    party_id: party.id,
    party_name: party.name,
    party_phone: str(b.party_phone) || party.phone,
    party_address: str(b.party_address) || party.billing_address,
    party_gstin: (str(b.party_gstin) || party.gstin).toUpperCase(),
    party_state: partyState,
    place_of_supply: placeOfSupply,
    is_inter: totals.inter ? 1 : 0,
    description: str(b.description),
    vehicle_no: str(b.vehicle_no).toUpperCase().replace(/\s+/g, ' '),
    transporter: str(b.transporter),
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

  // Everything below is written in one atomic batch.
  const statements = [];
  if (existing) {
    // Put back the stock taken by the old version of this invoice.
    for (const old of await all(db, 'SELECT item_id, qty FROM invoice_items WHERE invoice_id = ? AND item_id IS NOT NULL', existing.id)) {
      statements.push(stmt(db, 'UPDATE items SET stock = stock + ? WHERE id = ?', old.qty, old.item_id));
    }
    statements.push(stmt(db, 'DELETE FROM invoice_items WHERE invoice_id = ?', existing.id));
    statements.push(stmt(db, `UPDATE invoices SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      ...cols.map((c) => row[c]), existing.id));
  } else {
    statements.push(stmt(db, `INSERT INTO invoices (uid, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
      uid, ...cols.map((c) => row[c])));
  }
  lines.forEach((l, i) => {
    const { taxable, tax, amount } = calcLine(l);
    statements.push(stmt(db, `INSERT INTO invoice_items
      (invoice_id, position, item_id, name, hsn, qty, unit, price, discount_pct, gst_rate, taxable, tax, amount)
      VALUES ((SELECT id FROM invoices WHERE uid = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid, i, l.item_id, l.name, l.hsn, l.qty, l.unit, l.price, l.discount_pct, l.gst_rate, taxable, tax, amount));
    statements.push(stmt(db, 'UPDATE items SET stock = stock - ? WHERE id = ?', l.qty, l.item_id));
  });

  try {
    await db.batch(statements);
  } catch (err) {
    // Another phone took this number a moment ago.
    if (isUniqueError(err)) throw new HttpError(409, `Invoice number ${invoiceNo} was just used on another device. Please save again.`);
    throw err;
  }
  const saved = await one(db, 'SELECT id FROM invoices WHERE uid = ?', uid);
  return getInvoice(db, saved.id);
}

api.post('/invoices', async (c) => c.json(await saveInvoice(c.env.DB, await body(c)), 201));

api.put('/invoices/:id', async (c) => c.json(await saveInvoice(c.env.DB, await body(c), Number(c.req.param('id')))));

api.delete('/invoices/:id', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const statements = (await all(db, 'SELECT item_id, qty FROM invoice_items WHERE invoice_id = ? AND item_id IS NOT NULL', id))
    .map((old) => stmt(db, 'UPDATE items SET stock = stock + ? WHERE id = ?', old.qty, old.item_id));
  statements.push(stmt(db, 'DELETE FROM invoices WHERE id = ?', id));
  await db.batch(statements);
  return c.body(null, 204);
});

// ---------- Payments received later ----------

const PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card', 'Other'];

api.post('/invoices/:id/payments', async (c) => {
  const db = c.env.DB;
  const invoice = await one(db, 'SELECT id, balance FROM invoices WHERE id = ?', Number(c.req.param('id')));
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  const b = await body(c);
  const amount = round2(num(b.amount));
  if (amount <= 0) throw new HttpError(400, 'Enter the amount received');
  if (amount > invoice.balance + 0.005) throw new HttpError(400, `Only ₹${invoice.balance} is due on this invoice`);
  const mode = PAYMENT_MODES.includes(b.mode) ? b.mode : 'Cash';
  await db.batch([
    stmt(db, 'INSERT INTO payments (invoice_id, payment_date, amount, mode, note) VALUES (?, ?, ?, ?, ?)',
      invoice.id, str(b.payment_date) || today(), amount, mode, str(b.note)),
    refreshBalance(db, invoice.id),
  ]);
  return c.json(await getInvoice(db, invoice.id), 201);
});

api.delete('/payments/:id', async (c) => {
  const db = c.env.DB;
  const payment = await one(db, 'SELECT * FROM payments WHERE id = ?', Number(c.req.param('id')));
  if (!payment) throw new HttpError(404, 'Payment not found');
  await db.batch([stmt(db, 'DELETE FROM payments WHERE id = ?', payment.id), refreshBalance(db, payment.invoice_id)]);
  return c.json(await getInvoice(db, payment.invoice_id));
});

// ---------- Reports ----------

api.get('/reports/gst', async (c) => c.json(await gstReport(c.env.DB, str(c.req.query('from')), str(c.req.query('to')))));

// ---------- Dashboard ----------

api.get('/dashboard', async (c) => {
  const db = c.env.DB;
  const month = today().slice(0, 7);
  const [totals, monthSales, opening, recent, counts] = await Promise.all([
    one(db, 'SELECT COALESCE(SUM(total), 0) AS sales, COALESCE(SUM(balance), 0) AS receivable, COUNT(*) AS count FROM invoices'),
    one(db, 'SELECT COALESCE(SUM(total), 0) AS sales, COUNT(*) AS count FROM invoices WHERE substr(invoice_date, 1, 7) = ?', month),
    one(db, 'SELECT COALESCE(SUM(opening_balance), 0) AS n FROM parties'),
    all(db, `SELECT id, invoice_no, invoice_date, party_name, total, balance FROM invoices
      ORDER BY invoice_date DESC, invoice_no DESC LIMIT 8`),
    one(db, 'SELECT (SELECT COUNT(*) FROM parties) AS parties, (SELECT COUNT(*) FROM items) AS items'),
  ]);
  const owes = await all(db, `${PARTY_SELECT} ORDER BY balance DESC LIMIT 5`);
  return c.json({
    ...totals,
    receivable: totals.receivable + opening.n,
    month_sales: monthSales.sales,
    month_count: monthSales.count,
    ...counts,
    recent,
    owes: owes.filter((p) => p.balance > 0.005).map(({ id, name, phone, balance }) => ({ id, name, phone, balance })),
  });
});

// Chart data for one period: sales per day or month, collected vs due, top customers and items.
// All the adding-up is done by the database, which keeps each request tiny.
api.get('/dashboard/charts', async (c) => {
  const db = c.env.DB;
  const from = str(c.req.query('from')) || '0000-01-01';
  const to = str(c.req.query('to')) || '9999-12-31';
  const keyLen = c.req.query('group') === 'month' ? 7 : 10;
  const [series, money, customers, items] = await Promise.all([
    all(db, `SELECT substr(invoice_date, 1, ${keyLen}) AS key, ROUND(SUM(total), 2) AS total, COUNT(*) AS count
      FROM invoices WHERE invoice_date BETWEEN ? AND ? GROUP BY key ORDER BY key`, from, to),
    one(db, `SELECT ROUND(COALESCE(SUM(total), 0), 2) AS total, ROUND(COALESCE(SUM(total - balance), 0), 2) AS received,
      ROUND(COALESCE(SUM(balance), 0), 2) AS due, COUNT(*) AS count FROM invoices WHERE invoice_date BETWEEN ? AND ?`, from, to),
    all(db, `SELECT party_id AS id, party_name AS name, ROUND(SUM(total), 2) AS total, COUNT(*) AS count
      FROM invoices WHERE invoice_date BETWEEN ? AND ? GROUP BY COALESCE(party_id, party_name) ORDER BY total DESC LIMIT 5`, from, to),
    all(db, `SELECT ii.name, ii.unit, ROUND(SUM(ii.qty), 2) AS qty, ROUND(SUM(ii.amount), 2) AS total
      FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.invoice_date BETWEEN ? AND ? GROUP BY COALESCE(ii.item_id, ii.name) ORDER BY total DESC LIMIT 5`, from, to),
  ]);
  return c.json({ from, to, series, ...money, customers, items });
});

// ---------- Backup & restore ----------

api.route('/', backupRoutes);
