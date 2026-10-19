import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, FileText, Download, Pencil, Trash2, IndianRupee } from 'lucide-react';
import { formatDate, money, today } from '@shared/calc.js';
import { api } from '../api.js';
import { downloadInvoice } from '../pdf/InvoicePDF.jsx';
import { PaymentModal } from '../components/PaymentModal.jsx';
import { Empty, ErrorBox, Loading, PageHeader, StatusBadge, useLoad, useToast } from '../components/ui.jsx';

const PERIODS = {
  all: { label: 'All Sale Invoices', range: () => [null, null] },
  month: {
    label: 'This Month',
    range: () => {
      const t = today();
      return [t.slice(0, 8) + '01', t];
    },
  },
  lastMonth: {
    label: 'Last Month',
    range: () => {
      const d = new Date();
      const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const last = new Date(d.getFullYear(), d.getMonth(), 0);
      const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      return [iso(first), iso(last)];
    },
  },
  year: {
    label: 'This Year',
    range: () => {
      const t = today();
      return [t.slice(0, 4) + '-01-01', t];
    },
  },
};

export default function Invoices() {
  const navigate = useNavigate();
  const toast = useToast();
  const [period, setPeriod] = useState('all');
  const [q, setQ] = useState('');
  const [paying, setPaying] = useState(null);
  const { data, error, loading, reload } = useLoad(() => {
    const [from, to] = PERIODS[period].range();
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return Promise.all([api.get(`/invoices?${params}`), api.get('/business')]);
  }, [period]);

  const [invoices, business] = data || [[], null];
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return invoices;
    return invoices.filter((i) => `${i.invoice_no} ${i.party_name} ${i.party_phone}`.toLowerCase().includes(s));
  }, [invoices, q]);

  const sum = (k) => shown.reduce((a, i) => a + i[k], 0);

  const remove = async (e, inv) => {
    e.stopPropagation();
    if (!confirm(`Delete sale #${inv.invoice_no} for ${inv.party_name} (₹ ${money(inv.total)})? This can't be undone.`)) return;
    try {
      await api.del(`/invoices/${inv.id}`);
      toast(`Sale #${inv.invoice_no} deleted`);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const download = async (e, inv) => {
    e.stopPropagation();
    try {
      const full = await api.get(`/invoices/${inv.id}`);
      await downloadInvoice(full, business);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Sale Invoices">
        <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {Object.entries(PERIODS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </select>
        <Link to="/sale/new" className="btn-primary"><Plus size={16} /> Add Sale</Link>
      </PageHeader>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card border-l-4 border-l-emerald-500 p-4">
          <p className="text-xs font-medium text-slate-500">Received</p>
          <p className="text-lg font-semibold">₹ {money(sum('paid'))}</p>
        </div>
        <div className="card border-l-4 border-l-red-500 p-4">
          <p className="text-xs font-medium text-slate-500">Unpaid</p>
          <p className="text-lg font-semibold">₹ {money(sum('balance'))}</p>
        </div>
        <div className="card border-l-4 border-l-sky-500 p-4">
          <p className="text-xs font-medium text-slate-500">Total Sales</p>
          <p className="text-lg font-semibold">₹ {money(sum('total'))}</p>
        </div>
      </div>

      <div className="card">
        <div className="border-b border-slate-200 p-3">
          <div className="relative max-w-sm">
            <Search size={16} className="absolute top-2.5 left-3 text-slate-400" />
            <input className="input pl-9" placeholder="Search party, invoice no, phone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {error ? (
          <div className="p-4"><ErrorBox error={error} /></div>
        ) : loading && !data ? (
          <Loading />
        ) : !shown.length ? (
          <Empty icon={FileText} title={q ? 'No matching invoices' : 'No sales yet'}
            text={q ? 'Try a different search.' : 'Make your first sale invoice. Customers and items you type in are saved for next time.'}
            action={!q ? <Link to="/sale/new" className="btn-primary"><Plus size={16} /> Add Sale</Link> : null} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Invoice No.</th>
                  <th className="px-4 py-2">Party Name</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-right">Balance</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((inv) => (
                  <tr key={inv.id} onClick={() => navigate(`/sale/${inv.id}`)} className="cursor-pointer border-t border-slate-100 hover:bg-sky-50/50">
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                    <td className="px-4 py-2.5">{business?.invoice_prefix}{inv.invoice_no}</td>
                    <td className="px-4 py-2.5 font-medium">{inv.party_name}</td>
                    <td className="px-4 py-2.5 text-right">₹ {money(inv.total)}</td>
                    <td className="px-4 py-2.5 text-right">₹ {money(inv.balance)}</td>
                    <td className="px-4 py-2.5"><StatusBadge total={inv.total} balance={inv.balance} /></td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {inv.balance > 0 ? (
                        <button className="btn-ghost text-emerald-700" title="Record a payment for this sale" onClick={(e) => { e.stopPropagation(); setPaying(inv); }}>
                          <IndianRupee size={15} /> Payment
                        </button>
                      ) : null}
                      <button className="btn-ghost text-link" title="Edit this sale" onClick={(e) => { e.stopPropagation(); navigate(`/sale/${inv.id}/edit`); }}>
                        <Pencil size={15} /> Edit
                      </button>
                      <button className="btn-ghost text-red-600 hover:bg-red-50" title="Delete this sale" onClick={(e) => remove(e, inv)}>
                        <Trash2 size={15} /> Delete
                      </button>
                      <button className="btn-ghost" title="Download PDF" onClick={(e) => download(e, inv)}>
                        <Download size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {paying ? (
        <PaymentModal invoice={paying} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); reload(); }} />
      ) : null}
    </div>
  );
}
