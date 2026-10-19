import { useState } from 'react';
import { money, today } from '@shared/calc.js';
import { api } from '../api.js';
import { Field, Modal, useToast } from './ui.jsx';

export const PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card', 'Other'];

// Record money received after the sale against one invoice.
export function PaymentModal({ invoice, onClose, onSaved }) {
  const [form, setForm] = useState({ payment_date: today(), amount: invoice.balance, mode: 'Cash', note: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await api.post(`/invoices/${invoice.id}/payments`, form);
      toast(`₹ ${money(form.amount)} received from ${invoice.party_name}`);
      onSaved(updated);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Payment In"
      onClose={onClose}
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Payment'}</button>
        </>
      }
    >
      <div className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm">
        <div className="font-semibold">{invoice.party_name}</div>
        <div className="text-slate-500">
          Invoice #{invoice.invoice_no} · Total ₹ {money(invoice.total)} · <span className="font-semibold text-red-600">Due ₹ {money(invoice.balance)}</span>
        </div>
      </div>
      <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Amount Received (₹)" required>
          <input className="input" type="number" step="0.01" min="0" max={invoice.balance} value={form.amount} onChange={set('amount')} autoFocus />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={form.payment_date} onChange={set('payment_date')} />
        </Field>
        <Field label="Payment Type">
          <select className="input" value={form.mode} onChange={set('mode')}>
            {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Note" hint="e.g. cheque no. or UPI ref">
          <input className="input" value={form.note} onChange={set('note')} />
        </Field>
        {error ? <p className="text-sm text-red-600 sm:col-span-2">{error}</p> : null}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
