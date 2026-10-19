import { useState } from 'react';
import { GST_RATES, UNITS } from '@shared/calc.js';
import { api } from '../api.js';
import { Field, Modal, useToast } from './ui.jsx';

const EMPTY = { name: '', hsn: '', unit: 'Pcs', sale_price: '', purchase_price: '', gst_rate: 18, stock: '' };

export function ItemModal({ item, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(item || {}) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e?.preventDefault();
    if (!form.name.trim()) return setError('Item name is required');
    setSaving(true);
    setError('');
    try {
      const saved = item?.id ? await api.put(`/items/${item.id}`, form) : await api.post('/items', form);
      toast(item?.id ? 'Item updated' : 'Item saved');
      onSaved(saved);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={item?.id ? 'Edit Item' : 'Add Item'}
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
        <Field label="Item Name" required className="sm:col-span-2">
          <input className="input" value={form.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="HSN / SAC Code">
          <input className="input" value={form.hsn} onChange={set('hsn')} />
        </Field>
        <Field label="Unit">
          <select className="input" value={form.unit} onChange={set('unit')}>
            {[...new Set([form.unit, ...UNITS])].filter(Boolean).map((u) => <option key={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="Sale Price (₹, without GST)">
          <input className="input" type="number" step="0.01" value={form.sale_price} onChange={set('sale_price')} />
        </Field>
        <Field label="GST Rate">
          <select className="input" value={form.gst_rate} onChange={set('gst_rate')}>
            {GST_RATES.map((r) => <option key={r} value={r}>{r === 0 ? 'None (0%)' : `GST@${r}%`}</option>)}
          </select>
        </Field>
        <Field label="Purchase Price (₹)">
          <input className="input" type="number" step="0.01" value={form.purchase_price} onChange={set('purchase_price')} />
        </Field>
        <Field label="Stock Quantity" hint="Goes down automatically when you make a sale">
          <input className="input" type="number" step="any" value={form.stock} onChange={set('stock')} />
        </Field>
        {error ? <p className="text-sm text-red-600 sm:col-span-3">{error}</p> : null}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
