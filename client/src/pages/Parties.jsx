import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Users, Pencil, Trash2, Phone, Mail, MapPin, FileText } from 'lucide-react';
import { formatDate, money } from '@shared/calc.js';
import { api } from '../api.js';
import { PartyModal } from '../components/PartyModal.jsx';
import { StatementModal } from '../components/StatementModal.jsx';
import { Empty, ErrorBox, Loading, StatusBadge, useLoad, useToast } from '../components/ui.jsx';

export default function Parties() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: parties, error, reload } = useLoad(() => api.get('/parties'));
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState(() => (params.get('party') ? Number(params.get('party')) : null));
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [statementFor, setStatementFor] = useState(null);
  const [invoices, setInvoices] = useState([]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (parties || []).filter((p) => !s || `${p.name} ${p.phone} ${p.gstin}`.toLowerCase().includes(s));
  }, [parties, q]);

  const selected = parties?.find((p) => p.id === selectedId) || shown[0];

  useEffect(() => {
    if (!selected) return setInvoices([]);
    api.get(`/invoices?party_id=${selected.id}`).then(setInvoices).catch(() => setInvoices([]));
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from Home ("Who owes the most"): show that party's statement straight away.
  useEffect(() => {
    if (!parties || params.get('statement') !== '1') return;
    const p = parties.find((x) => x.id === Number(params.get('party')));
    if (p) setStatementFor(p);
    setParams({}, { replace: true });
  }, [parties]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorBox error={error} />;
  if (!parties) return <Loading />;

  const remove = async () => {
    if (!confirm(`Delete ${selected.name}?`)) return;
    try {
      await api.del(`/parties/${selected.id}`);
      toast('Party deleted');
      setSelectedId(null);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Parties</h1>
        <button className="btn-primary" onClick={() => setModal({})}><Plus size={16} /> Add Party</button>
      </div>

      {!parties.length ? (
        <div className="card">
          <Empty icon={Users} title="No parties yet"
            text="Add your customers here, or just type a new name when making a sale — it gets saved automatically."
            action={<button className="btn-primary" onClick={() => setModal({})}><Plus size={16} /> Add Party</button>} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="card flex max-h-[75vh] flex-col">
            <div className="border-b border-slate-200 p-3">
              <div className="relative">
                <Search size={16} className="absolute top-2.5 left-3 text-slate-400" />
                <input className="input pl-9" placeholder="Search parties" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-between px-4 py-2 text-xs font-semibold text-slate-500 uppercase">
              <span>Party Name</span><span>Amount</span>
            </div>
            <ul className="flex-1 overflow-y-auto">
              {shown.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setSelectedId(p.id)}
                    className={`flex w-full items-center justify-between gap-2 border-l-4 px-4 py-2.5 text-left text-sm ${
                      selected?.id === p.id ? 'border-l-link bg-sky-50' : 'border-l-transparent hover:bg-slate-50'
                    }`}>
                    <span className="truncate font-medium">{p.name}</span>
                    <span className={p.balance > 0 ? 'text-emerald-600' : 'text-slate-400'}>{money(p.balance)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {selected ? (
            <div className="card">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-5">
                <div>
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                  <div className="mt-2 grid gap-1 text-sm text-slate-600">
                    {selected.phone ? <span className="flex items-center gap-2"><Phone size={14} /> {selected.phone}</span> : null}
                    {selected.email ? <span className="flex items-center gap-2"><Mail size={14} /> {selected.email}</span> : null}
                    {selected.billing_address ? <span className="flex items-start gap-2 whitespace-pre-line"><MapPin size={14} className="mt-0.5 shrink-0" /> {selected.billing_address}</span> : null}
                    {selected.gstin ? <span>GSTIN: {selected.gstin}</span> : null}
                    {selected.state ? <span>State: {selected.state}</span> : null}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">{selected.balance >= 0 ? 'You will receive' : 'You will pay'}</p>
                  <p className={`text-xl font-semibold ${selected.balance > 0 ? 'text-emerald-600' : 'text-slate-700'}`}>₹ {money(Math.abs(selected.balance))}</p>
                  <div className="mt-2 flex justify-end gap-1">
                    <button className="btn-blue py-1.5" onClick={() => setStatementFor(selected)}><FileText size={14} /> Statement</button>
                    <button className="btn-outline py-1.5" onClick={() => setModal(selected)}><Pencil size={14} /> Edit</button>
                    <button className="btn-ghost text-red-600 hover:bg-red-50" onClick={remove} aria-label="Delete party"><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <h3 className="text-sm font-semibold">Transactions</h3>
                <Link to="/sale/new" className="btn-outline py-1.5"><Plus size={14} /> Add Sale</Link>
              </div>
              {invoices.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase">
                      <tr>
                        <th className="px-5 py-2">Type</th>
                        <th className="px-5 py-2">No.</th>
                        <th className="px-5 py-2">Date</th>
                        <th className="px-5 py-2 text-right">Total</th>
                        <th className="px-5 py-2 text-right">Balance</th>
                        <th className="px-5 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.id} onClick={() => navigate(`/sale/${inv.id}`)} className="cursor-pointer border-t border-slate-100 hover:bg-sky-50/50">
                          <td className="px-5 py-2.5">Sale</td>
                          <td className="px-5 py-2.5">{inv.invoice_no}</td>
                          <td className="px-5 py-2.5">{formatDate(inv.invoice_date)}</td>
                          <td className="px-5 py-2.5 text-right">₹ {money(inv.total)}</td>
                          <td className="px-5 py-2.5 text-right">₹ {money(inv.balance)}</td>
                          <td className="px-5 py-2.5"><StatusBadge total={inv.total} balance={inv.balance} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-5 pb-6 text-sm text-slate-500">No invoices for this party yet.</p>
              )}
            </div>
          ) : (
            <div className="card"><Empty title="No party matches your search" /></div>
          )}
        </div>
      )}

      {statementFor ? <StatementModal party={statementFor} onClose={() => setStatementFor(null)} /> : null}
      {modal ? (
        <PartyModal
          party={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={(p) => {
            setModal(null);
            setSelectedId(p.id);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
