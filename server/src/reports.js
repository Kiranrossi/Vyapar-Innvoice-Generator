import ExcelJS from 'exceljs';
import { db } from './db.js';
import { calcInvoice, calcLine, formatDate, round2 } from '../../shared/calc.js';

// Sales register, HSN summary and rate-wise totals: what a CA needs for GSTR-1.
export function gstReport(from, to) {
  const where = [];
  const params = {};
  if (from) {
    where.push('invoice_date >= :from');
    params.from = from;
  }
  if (to) {
    where.push('invoice_date <= :to');
    params.to = to;
  }
  const invoices = db
    .prepare(`SELECT * FROM invoices ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY invoice_date, invoice_no`)
    .all(params);
  const itemsFor = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position');

  const register = [];
  const hsn = new Map();
  const byRate = new Map();
  const totals = { invoices: invoices.length, b2b: 0, b2c: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, round_off: 0, value: 0 };

  for (const inv of invoices) {
    const items = itemsFor.all(inv.id);
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
  const hsnRows = [...hsn.values()].map(fix).sort((a, b) => a.hsn.localeCompare(b.hsn));
  const rateRows = [...byRate.values()].map(fix).sort((a, b) => a.rate - b.rate);
  const t = fix(totals);
  t.total_tax = round2(t.igst + t.cgst + t.sgst);
  return { from, to, totals: t, register, hsn: hsnRows, rates: rateRows };
}

const MONEY = '#,##0.00';

function sheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 14, style: c.money ? { numFmt: MONEY } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E6FA' } };
  ws.addRows(rows);
  return ws;
}

export async function gstWorkbook(report, business) {
  const wb = new ExcelJS.Workbook();
  wb.creator = business.name || 'Invoice Generator';
  const period = `${report.from ? formatDate(report.from) : 'Start'} to ${report.to ? formatDate(report.to) : 'Today'}`;
  const t = report.totals;

  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 32 }, { width: 18 }];
  summary.addRows([
    [business.name],
    [`GSTIN: ${business.gstin}`],
    [`Sales GST summary: ${period}`],
    [],
    ['Number of invoices', t.invoices],
    ['B2B invoices (customer has GSTIN)', t.b2b],
    ['B2C invoices (no GSTIN)', t.b2c],
    ['Taxable value', t.taxable],
    ['IGST', t.igst],
    ['CGST', t.cgst],
    ['SGST', t.sgst],
    ['Total GST', t.total_tax],
    ['Round off', t.round_off],
    ['Total invoice value', t.value],
    [],
    ['Rate-wise', ''],
  ]);
  summary.getRow(1).font = { bold: true, size: 14 };
  summary.getRow(16).font = { bold: true };
  for (let r = 8; r <= 14; r++) summary.getCell(r, 2).numFmt = MONEY;
  const rateHeader = summary.addRow(['GST rate', 'Taxable value', 'IGST', 'CGST', 'SGST']);
  rateHeader.font = { bold: true };
  for (const r of report.rates) {
    const row = summary.addRow([`${r.rate}%`, r.taxable, r.igst, r.cgst, r.sgst]);
    for (let c = 2; c <= 5; c++) row.getCell(c).numFmt = MONEY;
  }
  summary.getColumn(3).width = 14;
  summary.getColumn(4).width = 14;
  summary.getColumn(5).width = 14;

  sheet(wb, 'Sales Register', [
    { header: 'Invoice No', key: 'invoice_no', width: 11 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Customer', key: 'party', width: 32 },
    { header: 'GSTIN', key: 'gstin', width: 18 },
    { header: 'Type', key: 'type', width: 7 },
    { header: 'Place of Supply', key: 'place_of_supply', width: 20 },
    { header: 'GST Rate %', key: 'rate', width: 10 },
    { header: 'Taxable Value', key: 'taxable', money: true },
    { header: 'IGST', key: 'igst', money: true },
    { header: 'CGST', key: 'cgst', money: true },
    { header: 'SGST', key: 'sgst', money: true },
    { header: 'Invoice Value', key: 'invoice_value', money: true },
  ], report.register.map((r) => ({ ...r, date: formatDate(r.date) })));

  sheet(wb, 'HSN Summary', [
    { header: 'HSN/SAC', key: 'hsn', width: 12 },
    { header: 'Description', key: 'description', width: 32 },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'GST Rate %', key: 'rate', width: 10 },
    { header: 'Total Quantity', key: 'qty', width: 14 },
    { header: 'Taxable Value', key: 'taxable', money: true },
    { header: 'IGST', key: 'igst', money: true },
    { header: 'CGST', key: 'cgst', money: true },
    { header: 'SGST', key: 'sgst', money: true },
  ], report.hsn);

  return wb.xlsx.writeBuffer();
}
