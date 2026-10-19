import { formatDate } from '@shared/calc.js';
import { saveBlob } from './pdf/InvoicePDF.jsx';

const MONEY = '#,##0.00';

function sheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 14, style: c.money ? { numFmt: MONEY } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E6FA' } };
  ws.addRows(rows);
  return ws;
}

// Builds the GST workbook for the CA in the browser: Summary, Sales Register, HSN Summary.
export async function downloadGstExcel(report, business) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = business.name || 'Invoice Generator';
  const period = `${report.from ? formatDate(report.from) : 'Start'} to ${report.to ? formatDate(report.to) : 'Today'}`;
  const t = report.totals;

  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 32 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }];
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
  summary.addRow(['GST rate', 'Taxable value', 'IGST', 'CGST', 'SGST']).font = { bold: true };
  for (const r of report.rates) {
    const row = summary.addRow([`${r.rate}%`, r.taxable, r.igst, r.cgst, r.sgst]);
    for (let c = 2; c <= 5; c++) row.getCell(c).numFmt = MONEY;
  }

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

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveBlob(blob, `GST_Sales_${report.from || 'all'}_to_${report.to || 'all'}.xlsx`);
}
