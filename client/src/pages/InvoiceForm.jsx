import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, UserPlus, Truck } from 'lucide-react';
import { GST_RATES, UNITS, calcInvoice, calcLine, money, today } from '@shared/calc.js';
import { STATES } from '@shared/states.js';
import { api } from '../api.js';
import { Combobox } from '../components/Combobox.jsx';
import { PartyModal } from '../components/PartyModal.jsx';
import { ErrorBox, Loading, useToast } from '../components/ui.jsx';

const blankLine = () => ({ key: Math.random(), item_id: null, name: '', hsn: '', qty: '', unit: 'Pcs', price: '', discount_pct: '', gst_rate: 18 });

const blankInvoice = () => ({
  invoice_no: '',
  invoice_date: today(),
  party_id: null,
  party_name: '',
  party_phone: '',
  party_address: '',
  party_gstin: '',
  party_state: '',
  place_of_supply: '',
  description: '',
  vehicle_no: '',
  transporter: '',
  received: '',
  round_off_on: true,
  payments_total: 0,
  items: [blankLine(), blankLine()],
});

export default function InvoiceForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [parties, setParties] = useState([]);
  const [items, setItems] = useState([]);
  const [business, setBusiness] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [partyModal, setPartyModal] = useState(null);
  const [fullyPaid, setFullyPaid] = useState(false);
  const [numberTouched, setNumberTouched] = useState(false);
  const [bulkDiscount, setBulkDiscount] = useState('');
  const [vehicles, setVehicles] = useState([]);

  useEffect(() => {
    Promise.all([
      api.get('/parties'),
      api.get('/items'),
      api.get('/business'),
      id ? api.get(`/invoices/${id}`) : api.get('/invoices/next-number'),
      api.get('/vehicles'),
    ])
      .then(([p, it, b, inv, v]) => {
        setVehicles(v);
        setParties(p);
        setItems(it);
        setBusiness(b);
        if (id) {
          setForm({ ...inv, round_off_on: Boolean(inv.round_off_on), items: inv.items.map((l) => ({ ...l, key: Math.random() })) });
          setFullyPaid(inv.balance <= 0);
        } else {
          setForm({ ...blankInvoice(), invoice_no: inv.invoice_no, place_of_supply: b.state });
        }
      })
      .catch(setLoadError);
  }, [id]);

  const filledLines = useMemo(() => (form ? form.items.filter((l) => l.name.trim()) : []), [form]);
  const totals = useMemo(
    () =>
      form && business
        ? calcInvoice(filledLines, {
            businessState: business.state,
            placeOfSupply: form.place_of_supply || business.state,
            roundOff: form.round_off_on,
          })
        : null,
    [form, business, filledLines],
  );

  if (loadError) return <ErrorBox error={loadError} />;
  if (!form || !business) return <Loading />;

  const total = totals.total;
  // Payments recorded later (from the invoice page) stay as they are when editing.
  const later = form.payments_total || 0;
  const received = fullyPaid ? Math.max(0, Math.round((total - later) * 100) / 100) : parseFloat(form.received) || 0;
  const balance = Math.round((total - received - later) * 100) / 100;

  // With financial-year numbering the next number depends on the date.
  const changeDate = (date) => {
    set('invoice_date', date);
    if (!id && !numberTouched && business.fy_numbering && date) {
      api.get(`/invoices/next-number?date=${date}`).then(({ invoice_no }) => set('invoice_no', invoice_no)).catch(() => {});
    }
  };

  const applyDiscountToAll = () =>
    setForm((f) => ({ ...f, items: f.items.map((l) => (l.name.trim() ? { ...l, discount_pct: bulkDiscount } : l)) }));

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (key, patch) =>
    setForm((f) => ({ ...f, items: f.items.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const addLine = () => setForm((f) => ({ ...f, items: [...f.items, blankLine()] }));
  const removeLine = (key) =>
    setForm((f) => {
      const rest = f.items.filter((l) => l.key !== key);
      return { ...f, items: rest.length ? rest : [blankLine()] };
    });

  const pickParty = (p) =>
    setForm((f) => ({
      ...f,
      party_id: p.id,
      party_name: p.name,
      party_phone: p.phone,
      party_address: p.billing_address,
      party_gstin: p.gstin,
      party_state: p.state,
      place_of_supply: p.state || business.state,
    }));

  const pickItem = (key, it) =>
    setLine(key, { item_id: it.id, name: it.name, hsn: it.hsn, unit: it.unit, price: it.sale_price, gst_rate: it.gst_rate });

  const selectedParty = parties.find((p) => p.id === form.party_id);
  const isNewParty = form.party_name.trim() && !parties.some((p) => p.name.toLowerCase() === form.party_name.trim().toLowerCase());

  const remove = async () => {
    if (!confirm(`Delete sale #${form.invoice_no} for ${form.party_name}? This can't be undone.`)) return;
    setSaving(true);
    try {
      await api.del(`/invoices/${id}`);
      toast(`Sale #${form.invoice_no} deleted`);
      navigate('/sale');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const save = async (andNew) => {
    setError('');
    if (!form.party_name.trim()) return setError('Choose a customer, or type a new customer name.');
    if (!filledLines.length) return setError('Add at least one item.');
    if (filledLines.some((l) => !(parseFloat(l.qty) > 0))) return setError('Every item needs a quantity.');
    setSaving(true);
    const body = {
      ...form,
      place_of_supply: form.place_of_supply || business.state,
      received,
      items: filledLines,
    };
    try {
      let saved;
      try {
        saved = id ? await api.put(`/invoices/${id}`, body) : await api.post('/invoices', body);
      } catch (err) {
        // Another phone used this number while the form was open: take the next free one.
        if (id || numberTouched || err.status !== 409 || !/invoice number/i.test(err.message)) throw err;
        const { invoice_no } = await api.get(`/invoices/next-number?date=${form.invoice_date}`);
        saved = await api.post('/invoices', { ...body, invoice_no });
        set('invoice_no', invoice_no);
        toast(`Number ${form.invoice_no} was just used on another device, so this sale was saved as #${invoice_no}`);
      }
      toast(`Invoice #${saved.invoice_no} saved`);
      if (andNew) {
        const [{ invoice_no }, p, it, v] = await Promise.all([
          api.get(`/invoices/next-number?date=${today()}`),
          api.get('/parties'),
          api.get('/items'),
          api.get('/vehicles'),
        ]);
        setParties(p);
        setItems(it);
        setVehicles(v);
        setForm({ ...blankInvoice(), invoice_no, place_of_supply: business.state });
        setFullyPaid(false);
        setNumberTouched(false);
        setSaving(false);
        if (id) navigate('/sale/new');
      } else {
        navigate(`/sale/${saved.id}`);
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{id ? `Edit Sale #${form.invoice_no}` : 'Sale'}</h1>
      </div>

      {!business.name ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your business name and GSTIN aren't set yet, so the invoice header will be empty.{' '}
          <Link to="/settings" className="font-semibold underline">Add them in Settings</Link>.
        </div>
      ) : null}

      <div className="card">
        {/* Customer + invoice details */}
        <div className="grid grid-cols-1 gap-6 border-b border-slate-200 p-5 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 sm:max-w-md">
              <span className="label">Customer <span className="text-brand">*</span></span>
              <Combobox
                value={form.party_name}
                onChange={(v) => setForm((f) => ({ ...f, party_name: v, party_id: null }))}
                onSelect={pickParty}
                options={parties}
                searchText={(p) => `${p.name} ${p.phone}`}
                renderOption={(p) => (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{p.name}</div>
                      {p.phone ? <div className="text-xs text-slate-400">{p.phone}</div> : null}
                    </div>
                    <span className={`text-xs ${p.balance > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>₹ {money(p.balance)}</span>
                  </div>
                )}
                onAddNew={(name) => setPartyModal({ name })}
                addLabel="Add Party"
                placeholder="Search by name or phone"
                autoFocus={!id}
              />
              {isNewParty ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-link">
                  <UserPlus size={13} /> New customer — they'll be saved to your party list with this invoice.
                </p>
              ) : selectedParty && selectedParty.balance > 0 ? (
                <p className="mt-1 text-xs text-slate-500">Current balance: <span className="font-semibold text-emerald-700">₹ {money(selectedParty.balance)}</span></p>
              ) : null}
            </div>
            <label className="block">
              <span className="label">Phone No.</span>
              <input className="input" value={form.party_phone} onChange={(e) => set('party_phone', e.target.value)} />
            </label>
            <label className="block">
              <span className="label">GSTIN</span>
              <input className="input uppercase" value={form.party_gstin} maxLength={15}
                onChange={(e) => set('party_gstin', e.target.value.toUpperCase())} />
            </label>
            <label className="block sm:col-span-2">
              <span className="label">Billing Address</span>
              <textarea className="input" rows={2} value={form.party_address} onChange={(e) => set('party_address', e.target.value)} />
            </label>
          </div>

          <div className="grid content-start gap-4">
            <label className="block">
              <span className="label">Invoice Number</span>
              <div className="flex items-center gap-2">
                {business.invoice_prefix ? <span className="text-sm text-slate-500">{business.invoice_prefix}</span> : null}
                <input className="input" type="number" min="1" value={form.invoice_no} onChange={(e) => { setNumberTouched(true); set('invoice_no', e.target.value); }} />
              </div>
            </label>
            <label className="block">
              <span className="label">Invoice Date</span>
              <input className="input" type="date" value={form.invoice_date} onChange={(e) => changeDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">State of Supply</span>
              <select className="input" value={form.place_of_supply || business.state}
                onChange={(e) => setForm((f) => ({ ...f, place_of_supply: e.target.value, party_state: f.party_state || e.target.value }))}>
                <option value="">Select state</option>
                {STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
              {totals.inter ? <span className="mt-1 block text-xs text-amber-700">Other state — IGST will be charged</span> : null}
            </label>
          </div>
        </div>

        {/* Items */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
              <tr className="border-b border-slate-200">
                <th className="w-10 px-3 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Item</th>
                <th className="w-28 px-2 py-2 text-left">HSN/SAC</th>
                <th className="w-20 px-2 py-2 text-right">Qty</th>
                <th className="w-24 px-2 py-2 text-left">Unit</th>
                <th className="w-32 px-2 py-2 text-right">Price/Unit<div className="font-normal normal-case">without tax</div></th>
                <th className="w-24 px-2 py-2 text-right">Disc %</th>
                <th className="w-40 px-2 py-2 text-left">Tax</th>
                <th className="w-32 px-2 py-2 text-right">Amount</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {form.items.map((l, i) => {
                const { tax, amount, discount } = calcLine(l);
                return (
                  <tr key={l.key} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-2.5 text-slate-400">{i + 1}</td>
                    <td className="px-2 py-1.5">
                      <Combobox
                        value={l.name}
                        onChange={(v) => setLine(l.key, { name: v, item_id: null })}
                        onSelect={(it) => pickItem(l.key, it)}
                        options={items}
                        searchText={(it) => `${it.name} ${it.hsn}`}
                        renderOption={(it) => (
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium">{it.name}</span>
                            <span className="text-xs whitespace-nowrap text-slate-400">₹ {money(it.sale_price)} · Stock {it.stock}</span>
                          </div>
                        )}
                        placeholder="Type item name"
                        className="input py-1.5"
                      />
                      {l.name.trim() && !l.item_id && !items.some((it) => it.name.toLowerCase() === l.name.trim().toLowerCase()) ? (
                        <span className="mt-0.5 block text-[11px] text-link">New item — will be saved to your items</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">
                      <input className="input py-1.5" value={l.hsn} onChange={(e) => setLine(l.key, { hsn: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input className="input py-1.5 text-right" type="number" step="any" min="0" value={l.qty}
                        onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <select className="input py-1.5" value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })}>
                        {[...new Set([l.unit, ...UNITS])].filter(Boolean).map((u) => <option key={u}>{u}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input className="input py-1.5 text-right" type="number" step="0.01" min="0" value={l.price}
                        onChange={(e) => setLine(l.key, { price: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input className="input py-1.5 text-right" type="number" step="0.01" min="0" max="100" value={l.discount_pct ?? ''}
                        onChange={(e) => setLine(l.key, { discount_pct: e.target.value })} placeholder="0" />
                      {discount ? <span className="mt-0.5 block text-right text-[11px] text-slate-500">- {money(discount)}</span> : null}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <select className="input w-24 py-1.5" value={l.gst_rate} onChange={(e) => setLine(l.key, { gst_rate: e.target.value })}>
                          {GST_RATES.map((r) => <option key={r} value={r}>{r === 0 ? 'None' : `${r}%`}</option>)}
                        </select>
                        <span className="text-xs text-slate-500">{money(tax)}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right font-medium">{money(amount)}</td>
                    <td className="px-1 py-1.5">
                      <button className="btn-ghost text-slate-400 hover:text-red-600" onClick={() => removeLine(l.key)} aria-label="Remove row">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td className="px-3 py-2" colSpan={2}>
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="btn-outline py-1.5 text-link" onClick={addLine}><Plus size={15} /> Add Row</button>
                    <span className="ml-2 text-xs font-normal text-slate-500">Discount on all items</span>
                    <input className="input w-20 py-1 text-right" type="number" min="0" max="100" step="0.01" placeholder="%"
                      value={bulkDiscount} onChange={(e) => setBulkDiscount(e.target.value)} />
                    <button className="btn-ghost py-1 text-xs text-link" onClick={applyDiscountToAll}>Apply</button>
                  </div>
                </td>
                <td className="px-2 py-2 text-right text-xs text-slate-500 uppercase">Total</td>
                <td className="px-2 py-2 text-right">{totals.qty}</td>
                <td colSpan={2} />
                <td className="px-2 py-2 text-right text-xs">{totals.discount ? `- ${money(totals.discount)}` : ''}</td>
                <td className="px-2 py-2 text-xs">{money(totals.tax)}</td>
                <td className="px-2 py-2 text-right">{money(totals.total - totals.roundOff)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Description + totals */}
        <div className="grid grid-cols-1 gap-6 p-5 md:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <div className="rounded-md border border-slate-200 p-3">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><Truck size={16} /> Transportation</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <span className="label">Vehicle No.</span>
                  <Combobox
                    value={form.vehicle_no}
                    onChange={(v) => set('vehicle_no', v.toUpperCase())}
                    onSelect={(v) => setForm((f) => ({ ...f, vehicle_no: v.vehicle_no, transporter: f.transporter || v.transporter }))}
                    options={vehicles.map((v) => ({ ...v, id: v.vehicle_no, name: v.vehicle_no }))}
                    renderOption={(v) => (
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{v.vehicle_no}</span>
                        <span className="text-xs text-slate-400">{v.transporter || `used ${v.times}×`}</span>
                      </div>
                    )}
                    placeholder="e.g. TN64AH5064"
                    className="input uppercase"
                  />
                  {form.vehicle_no.trim() && !vehicles.some((v) => v.vehicle_no.replace(/\s/g, '') === form.vehicle_no.replace(/\s/g, '')) ? (
                    <span className="mt-0.5 block text-[11px] text-link">New vehicle — it will be suggested next time</span>
                  ) : null}
                </div>
                <label className="block">
                  <span className="label">Transporter / Driver (optional)</span>
                  <input className="input" value={form.transporter} onChange={(e) => set('transporter', e.target.value)} placeholder="e.g. Sri Balaji Transports" />
                </label>
              </div>
              <p className="mt-2 text-xs text-slate-400">Printed on the invoice above Terms and Conditions.</p>
            </div>
            <label className="block">
              <span className="label">Description</span>
              <textarea className="input" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)}
                placeholder="Any note to print on the invoice (optional)" />
            </label>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Sub Total</span><span>₹ {money(totals.subtotal)}</span></div>
            {totals.taxRows.map((r) => (
              <div key={r.label} className="flex justify-between"><span className="text-slate-500">{r.label}</span><span>₹ {money(r.amount)}</span></div>
            ))}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-slate-600">
                <input type="checkbox" checked={form.round_off_on} onChange={(e) => set('round_off_on', e.target.checked)} className="accent-link" />
                Round off
              </label>
              <span className="text-slate-500">{totals.roundOff ? `${totals.roundOff > 0 ? '+' : '-'} ₹ ${money(Math.abs(totals.roundOff))}` : '₹ 0.00'}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
              <span>Total</span><span>₹ {money(total)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-slate-600">
                <input type="checkbox" checked={fullyPaid} onChange={(e) => setFullyPaid(e.target.checked)} className="accent-link" />
                Received
              </label>
              <input className="input w-40 py-1.5 text-right" type="number" step="0.01" min="0"
                value={fullyPaid ? received : form.received} disabled={fullyPaid}
                onChange={(e) => set('received', e.target.value)} placeholder="0.00" />
            </div>
            {later ? (
              <div className="flex justify-between text-slate-500">
                <span>Payments recorded later</span><span>₹ {money(later)}</span>
              </div>
            ) : null}
            <div className="flex justify-between font-semibold">
              <span>Balance</span>
              <span className={balance > 0 ? 'text-red-600' : 'text-emerald-600'}>₹ {money(balance)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
          {error ? <p className="mr-auto text-sm text-red-600">{error}</p> : null}
          {id ? (
            <button className="btn-outline mr-auto border-red-200 text-red-600 hover:bg-red-50" onClick={remove} disabled={saving}>
              <Trash2 size={15} /> Delete Sale
            </button>
          ) : null}
          <button className="btn-outline" onClick={() => navigate(-1)} disabled={saving}>Cancel</button>
          <button className="btn-outline" onClick={() => save(true)} disabled={saving}>Save &amp; New</button>
          <button className="btn-primary px-8" onClick={() => save(false)} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {partyModal ? (
        <PartyModal
          initialName={partyModal.name}
          onClose={() => setPartyModal(null)}
          onSaved={(p) => {
            setParties((list) => [...list, { ...p }].sort((a, b) => a.name.localeCompare(b.name)));
            pickParty(p);
            setPartyModal(null);
          }}
        />
      ) : null}
    </div>
  );
}
