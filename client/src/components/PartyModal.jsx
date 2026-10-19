import { useState } from 'react';
import { STATES, stateFromGstin } from '@shared/states.js';
import { api } from '../api.js';
import { Field, Modal, useToast } from './ui.jsx';

const EMPTY = { name: '', phone: '', email: '', gstin: '', state: '', billing_address: '', shipping_address: '', opening_balance: '' };

export function PartyModal({ party, initialName = '', onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(party || {}), name: party?.name ?? initialName }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const onGstin = (e) => {
    const gstin = e.target.value.toUpperCase();
    setForm((f) => ({ ...f, gstin, state: gstin.length >= 2 ? stateFromGstin(gstin) || f.state : f.state }));
  };

  const save = async (e) => {
    e?.preventDefault();
    if (!form.name.trim()) return setError('Party name is required');
    setSaving(true);
    setError('');
    try {
      const saved = party?.id ? await api.put(`/parties/${party.id}`, form) : await api.post('/parties', form);
      toast(party?.id ? 'Party updated' : 'Party saved');
      onSaved(saved);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={party?.id ? 'Edit Party' : 'Add Party'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-3">
        <Field label="Party Name" required className="sm:col-span-1">
          <input className="input" value={form.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="GSTIN">
          <input className="input uppercase" value={form.gstin} onChange={onGstin} maxLength={15} placeholder="33ABCDE1234F1Z5" />
        </Field>
        <Field label="Phone Number">
          <input className="input" value={form.phone} onChange={set('phone')} inputMode="tel" />
        </Field>
        <Field label="Email ID">
          <input className="input" value={form.email} onChange={set('email')} type="email" />
        </Field>
        <Field label="State" hint="Filled in from the GSTIN">
          <select className="input" value={form.state} onChange={set('state')}>
            <option value="">Select state</option>
            {STATES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Opening Balance (₹)" hint="Amount they already owe you">
          <input className="input" type="number" step="0.01" value={form.opening_balance} onChange={set('opening_balance')} />
        </Field>
        <Field label="Billing Address" className="sm:col-span-3">
          <textarea className="input" rows={3} value={form.billing_address} onChange={set('billing_address')}
            placeholder={'Door no, street\nCity, State, PIN'} />
        </Field>
        <Field label="Shipping Address" className="sm:col-span-3">
          <textarea className="input" rows={2} value={form.shipping_address} onChange={set('shipping_address')} />
        </Field>
        {error ? <p className="text-sm text-red-600 sm:col-span-3">{error}</p> : null}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
