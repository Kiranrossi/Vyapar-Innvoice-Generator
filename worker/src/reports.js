import { all } from './db.js';
import { calcInvoice, calcLine, round2 } from '../../shared/calc.js';

// Sales register, HSN summary and rate-wise totals: what a CA needs for GSTR-1.
// (The Excel file itself is built in the browser from this data.)
export async function gstReport(db, from, to) {
  const where = [];
  const params = [];
  if (from) {
    where.push('invoice_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('invoice_date <= ?');
    params.push(to);
  }
  const filter = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [invoices, lines] = await Promise.all([
    all(db, `SELECT id, invoice_no, invoice_date, party_name, party_gstin, place_of_supply, is_inter, round_off, round_off_on, total
      FROM invoices ${filter} ORDER BY invoice_date, invoice_no`, ...params),
    all(db, `SELECT invoice_id, name, hsn, qty, unit, price, discount_pct, gst_rate FROM invoice_items
      WHERE invoice_id IN (SELECT id FROM invoices ${filter}) ORDER BY invoice_id, position`, ...params),
  ]);
  const linesByInvoice = new Map();
  for (const l of lines) {
    if (!linesByInvoice.has(l.invoice_id)) linesByInvoice.set(l.invoice_id, []);
    linesByInvoice.get(l.invoice_id).push(l);
  }

  const register = [];
  const hsn = new Map();
  const byRate = new Map();
  const totals = { invoices: invoices.length, b2b: 0, b2c: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, round_off: 0, value: 0 };

  for (const inv of invoices) {
    const items = linesByInvoice.get(inv.id) || [];
    const calc = calcInvoice(items, { inter: Boolean(inv.is_inter), roundOff: Boolean(inv.round_off_on) });
    const type = inv.party_gstin ? 'B2B' : 'B2C';
    totals[type.toLowerCase()] += 1;
    totals.round_off += inv.round_off;
    totals.value += inv.total;

    for (const r of calc.rates) {
      register.push({
        invoice_no: inv.invoice_no,
        date: inv.invoice_date,
        party: inv.party_name,
        gstin: inv.party_gstin,
        type,
        place_of_supply: inv.place_of_supply,
        rate: r.rate,
        taxable: r.taxable,
        igst: r.igst,
        cgst: r.cgst,
        sgst: r.sgst,
        invoice_value: inv.total,
      });
      const t = byRate.get(r.rate) || { rate: r.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      for (const k of ['taxable', 'igst', 'cgst', 'sgst']) t[k] += r[k];
      byRate.set(r.rate, t);
      totals.taxable += r.taxable;
      totals.igst += r.igst;
      totals.cgst += r.cgst;
      totals.sgst += r.sgst;
    }

    for (const it of items) {
      const { taxable, tax } = calcLine(it);
      const key = `${it.hsn}|${it.unit}|${it.gst_rate}`;
      const h = hsn.get(key) || { hsn: it.hsn, description: it.name, unit: it.unit, rate: it.gst_rate, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      h.qty += it.qty;
      h.taxable += taxable;
      if (inv.is_inter) h.igst += tax;
      else {
        const half = round2(tax / 2);
        h.sgst += half;
        h.cgst += round2(tax - half);
      }
      hsn.set(key, h);
    }
  }

  const fix = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? round2(v) : v]));
  const t = fix(totals);
  t.total_tax = round2(t.igst + t.cgst + t.sgst);
  return {
    from,
    to,
    totals: t,
    register,
    hsn: [...hsn.values()].map(fix).sort((a, b) => a.hsn.localeCompare(b.hsn)),
    rates: [...byRate.values()].map(fix).sort((a, b) => a.rate - b.rate),
  };
}
