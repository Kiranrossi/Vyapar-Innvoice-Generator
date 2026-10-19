import { useState } from 'react';
import { FileSpreadsheet, BarChart3 } from 'lucide-react';
import { financialYear, fyRange, formatDate, money, today } from '@shared/calc.js';
import { api } from '../api.js';
import { downloadGstExcel } from '../excel.js';
import { Empty, ErrorBox, Loading, PageHeader, useLoad } from '../components/ui.jsx';

const pad = (n) => String(n).padStart(2, '0');
const monthRange = (offset) => {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
  const iso = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  return [iso(first), iso(last)];
};
const monthName = (offset) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
};

// GSTR-1 is filed for the previous month, so that's the default.
const PERIODS = {
  lastMonth: { label: `Last month (${monthName(-1)})`, range: () => monthRange(-1) },
  month: { label: `This month (${monthName(0)})`, range: () => monthRange(0) },
  fy: { label: `This financial year (${financialYear(today())})`, range: () => fyRange(financialYear(today())) },
  custom: { label: 'Custom dates', range: null },
};

function Stat({ label, value }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

export default function Reports() {
  const [period, setPeriod] = useState('lastMonth');
  const [custom, setCustom] = useState({ from: monthRange(0)[0], to: today() });
  const [excelBusy, setExcelBusy] = useState(false);
  const [from, to] = period === 'custom' ? [custom.from, custom.to] : PERIODS[period].range();
  const { data, error } = useLoad(() => api.get(`/reports/gst?from=${from}&to=${to}`), [from, to]);

  const t = data?.totals;
  const th = 'px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase';
  const td = 'px-3 py-2';

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="GST Sales Report">
        <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {Object.entries(PERIODS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </select>
        {period === 'custom' ? (
          <>
            <input className="input w-auto" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="From date" />
            <input className="input w-auto" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="To date" />
          </>
        ) : null}
        <button className="btn bg-emerald-600 text-white hover:bg-emerald-700" disabled={!data || excelBusy}
          onClick={async () => {
            setExcelBusy(true);
            try {
              await downloadGstExcel(data, await api.get('/business'));
            } catch (err) {
              alert(err.message);
            }
            setExcelBusy(false);
          }}>
          <FileSpreadsheet size={16} /> {excelBusy ? 'Preparing…' : 'Download Excel for CA'}
        </button>
      </PageHeader>
      <p className="-mt-2 text-sm text-slate-500">
        {formatDate(from)} to {formatDate(to)}. The Excel file has a summary, a sales register (one row per invoice per GST rate) and an HSN summary, which is what your CA needs to file GSTR-1.
      </p>

      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : !t.invoices ? (
        <div className="card"><Empty icon={BarChart3} title="No sales in this period" text="Pick another period above." /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Invoices" value={`${t.invoices} (${t.b2b} B2B · ${t.b2c} B2C)`} />
            <Stat label="Taxable value" value={`₹ ${money(t.taxable)}`} />
            <Stat label="Total GST" value={`₹ ${money(t.total_tax)}`} />
            <Stat label="Total sales (incl. GST)" value={`₹ ${money(t.value)}`} />
          </div>

          <div className="card overflow-x-auto">
            <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Rate-wise summary</h2>
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-slate-50"><tr>
                <th className={th}>GST rate</th><th className={`${th} text-right`}>Taxable value</th>
                <th className={`${th} text-right`}>CGST</th><th className={`${th} text-right`}>SGST</th><th className={`${th} text-right`}>IGST</th>
              </tr></thead>
              <tbody>
                {data.rates.map((r) => (
                  <tr key={r.rate} className="border-t border-slate-100">
                    <td className={td}>{r.rate}%</td><td className={`${td} text-right`}>₹ {money(r.taxable)}</td>
                    <td className={`${td} text-right`}>₹ {money(r.cgst)}</td><td className={`${td} text-right`}>₹ {money(r.sgst)}</td>
                    <td className={`${td} text-right`}>₹ {money(r.igst)}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 font-semibold">
                  <td className={td}>Total</td><td className={`${td} text-right`}>₹ {money(t.taxable)}</td>
                  <td className={`${td} text-right`}>₹ {money(t.cgst)}</td><td className={`${td} text-right`}>₹ {money(t.sgst)}</td>
                  <td className={`${td} text-right`}>₹ {money(t.igst)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card overflow-x-auto">
            <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">HSN summary</h2>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50"><tr>
                <th className={th}>HSN/SAC</th><th className={th}>Item</th><th className={`${th} text-right`}>Qty</th>
                <th className={`${th} text-right`}>Rate</th><th className={`${th} text-right`}>Taxable value</th><th className={`${th} text-right`}>Tax</th>
              </tr></thead>
              <tbody>
                {data.hsn.map((h, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className={td}>{h.hsn || <span className="text-amber-600">Missing</span>}</td><td className={td}>{h.description}</td>
                    <td className={`${td} text-right`}>{h.qty} {h.unit}</td><td className={`${td} text-right`}>{h.rate}%</td>
                    <td className={`${td} text-right`}>₹ {money(h.taxable)}</td><td className={`${td} text-right`}>₹ {money(h.cgst + h.sgst + h.igst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card overflow-x-auto">
            <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Sales register</h2>
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-50"><tr>
                <th className={th}>Inv No</th><th className={th}>Date</th><th className={th}>Customer</th><th className={th}>GSTIN</th>
                <th className={`${th} text-right`}>Rate</th><th className={`${th} text-right`}>Taxable</th><th className={`${th} text-right`}>GST</th><th className={`${th} text-right`}>Invoice value</th>
              </tr></thead>
              <tbody>
                {data.register.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className={td}>{r.invoice_no}</td><td className={`${td} whitespace-nowrap`}>{formatDate(r.date)}</td>
                    <td className={td}>{r.party}</td><td className={`${td} text-xs`}>{r.gstin || 'B2C'}</td>
                    <td className={`${td} text-right`}>{r.rate}%</td><td className={`${td} text-right`}>₹ {money(r.taxable)}</td>
                    <td className={`${td} text-right`}>₹ {money(r.igst + r.cgst + r.sgst)}</td><td className={`${td} text-right`}>₹ {money(r.invoice_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
