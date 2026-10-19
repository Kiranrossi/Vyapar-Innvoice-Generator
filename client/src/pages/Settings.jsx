import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X, Check, DownloadCloud, UploadCloud, Lock } from 'lucide-react';
import { STATES, stateFromGstin } from '@shared/states.js';
import { financialYear, formatDate, today } from '@shared/calc.js';
import { api } from '../api.js';
import { invoiceBlob } from '../pdf/InvoicePDF.jsx';
import { downloadBackup, restoreBackup } from '../backup.js';
import { ErrorBox, Field, Loading, useToast } from '../components/ui.jsx';

const THEMES = ['#9590E0', '#097AA8', '#ED1A3B', '#1C2B4A', '#0F9D58', '#F29D38', '#6D4C41', '#000000'];

const SAMPLE = {
  invoice_no: 1,
  invoice_date: today(),
  party_name: 'SAMPLE CUSTOMER',
  party_address: '12, Main Road,\nTiruchirappalli, Tamil Nadu, 620001',
  party_gstin: '33ABCDE1234F1Z5',
  party_state: '33-Tamil Nadu',
  place_of_supply: '33-Tamil Nadu',
  description: 'Transportation\nTN00AB1234',
  received: 0,
  items: [{ name: 'Sample item', hsn: '94031010', qty: 2, unit: 'Pcs', price: 1000, gst_rate: 18 }],
};

// Shrink uploads so the database and PDF stay small.
function readImage(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image we can read'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function ImagePicker({ label, value, onChange, maxSize, hint }) {
  const ref = useRef(null);
  const toast = useToast();
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => ref.current.click()}
          className="flex h-20 w-32 items-center justify-center overflow-hidden rounded-md border-2 border-dashed border-slate-300 bg-slate-50 hover:border-link">
          {value ? <img src={value} alt={label} className="max-h-full max-w-full object-contain" /> : <ImagePlus className="text-slate-400" />}
        </button>
        {value ? (
          <button type="button" className="btn-ghost text-sm text-red-600" onClick={() => onChange('')}><X size={14} /> Remove</button>
        ) : (
          <span className="text-xs text-slate-400">{hint}</span>
        )}
      </div>
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={async (e) => {
          const file = e.target.files[0];
          e.target.value = '';
          if (!file) return;
          try {
            onChange(await readImage(file, maxSize));
          } catch (err) {
            toast(err.message, 'error');
          }
        }} />
    </div>
  );
}

function PinSection() {
  const toast = useToast();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value.replace(/\D/g, '').slice(0, 8) }));

  const change = async () => {
    if (form.next !== form.confirm) return toast('The new PINs do not match', 'error');
    setBusy(true);
    try {
      await api.put('/auth/pin', { current: form.current, next: form.next });
      toast('PIN changed. Other devices will ask for the new PIN.');
      setForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };

  const lockNow = async () => {
    await api.post('/auth/lock');
    window.location.reload();
  };

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold">PIN Lock</h2>
      <p className="mb-4 text-sm text-slate-500">
        Each phone or tablet asks for the PIN once, then stays unlocked. Changing the PIN locks every other device,
        which is useful if a phone is lost.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Current PIN">
          <input className="input" type="password" inputMode="numeric" autoComplete="off" value={form.current} onChange={set('current')} />
        </Field>
        <Field label="New PIN" hint="4 to 8 digits">
          <input className="input" type="password" inputMode="numeric" autoComplete="off" value={form.next} onChange={set('next')} />
        </Field>
        <Field label="Repeat New PIN">
          <input className="input" type="password" inputMode="numeric" autoComplete="off" value={form.confirm} onChange={set('confirm')} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-blue" disabled={busy || !form.current || !form.next} onClick={change}>Change PIN</button>
        <button type="button" className="btn-outline" onClick={lockNow}><Lock size={15} /> Lock this device</button>
      </div>
    </section>
  );
}

function BackupSection({ lastBackup, onBackedUp }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState('');
  const last = lastBackup ? formatDate(lastBackup.slice(0, 10)) : 'never';

  const download = async () => {
    setBusy('Preparing backup…');
    try {
      const n = await downloadBackup();
      onBackedUp();
      toast(`Backup downloaded (${n} invoices)`);
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy('');
  };

  const restore = async (file) => {
    if (!file) return;
    if (!confirm(`Replace ALL current data with the backup "${file.name}"?\n\nThis can't be undone from here, so download a backup of the current data first if you might need it.`)) return;
    setBusy('Restoring… 0%');
    try {
      const data = await restoreBackup(file, (pct) => setBusy(`Restoring… ${pct}%`));
      toast(`Backup restored (${data.invoices} invoices, ${data.parties} parties)`);
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast(err.message, 'error');
      setBusy('');
    }
  };

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold">Backup &amp; Restore</h2>
      <p className="mb-4 text-sm text-slate-500">
        Last downloaded backup: <span className="font-medium text-slate-700">{last}</span>. Download one every week and keep it on
        Google Drive or a pen drive. The data itself is stored safely online, and Cloudflare can also roll it back to any point
        in the last 7 days if something goes badly wrong.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-blue" disabled={Boolean(busy)} onClick={download}>
          <DownloadCloud size={16} /> Download Backup
        </button>
        <button type="button" className="btn-outline" disabled={Boolean(busy)} onClick={() => fileRef.current.click()}>
          <UploadCloud size={16} /> Restore from Backup
        </button>
        {busy ? <span className="text-sm text-slate-500">{busy}</span> : null}
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { restore(e.target.files[0]); e.target.value = ''; }} />
      </div>
    </section>
  );
}

export default function Settings() {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState('');

  useEffect(() => {
    api.get('/business').then(setForm).catch(setError);
  }, []);

  // Re-render the sample invoice shortly after the user stops typing.
  useEffect(() => {
    if (!form) return;
    let url = '';
    let cancelled = false;
    const t = setTimeout(() => {
      invoiceBlob(SAMPLE, form).then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (url) URL.revokeObjectURL(url);
    };
  }, [form]);

  if (error) return <ErrorBox error={error} />;
  if (!form) return <Loading />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setVal = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      setForm(await api.put('/business', form));
      toast('Settings saved');
    } catch (err) {
      toast(err.message, 'error');
    }
    setSaving(false);
  };

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_520px]">
      <form onSubmit={save} className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Business Settings</h1>
          <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</button>
        </div>

        <section className="card p-5">
          <h2 className="mb-4 font-semibold">Business Details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business Name" required className="sm:col-span-2">
              <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. AGAM" />
            </Field>
            <Field label="Phone Number">
              <input className="input" value={form.phone} onChange={set('phone')} />
            </Field>
            <Field label="Email ID">
              <input className="input" type="email" value={form.email} onChange={set('email')} />
            </Field>
            <Field label="GSTIN">
              <input className="input uppercase" maxLength={15} value={form.gstin}
                onChange={(e) => {
                  const gstin = e.target.value.toUpperCase();
                  setForm((f) => ({ ...f, gstin, state: gstin.length >= 2 ? stateFromGstin(gstin) || f.state : f.state }));
                }} />
            </Field>
            <Field label="State" hint="Used to decide CGST+SGST (same state) or IGST (other state)">
              <select className="input" value={form.state} onChange={set('state')}>
                <option value="">Select state</option>
                {STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Business Address" className="sm:col-span-2">
              <textarea className="input" rows={2} value={form.address} onChange={set('address')} />
            </Field>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 font-semibold">Logo &amp; Signature</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <ImagePicker label="Business Logo" value={form.logo} onChange={setVal('logo')} maxSize={300} hint="Shown top-right on the invoice" />
            <ImagePicker label="Signature" value={form.signature} onChange={setVal('signature')} maxSize={500}
              hint="Photo or scan of your signature on white paper" />
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 font-semibold">Invoice Print Settings</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <span className="label">Theme Colour</span>
              <div className="flex flex-wrap items-center gap-2">
                {THEMES.map((c) => (
                  <button key={c} type="button" onClick={() => setVal('theme_color')(c)} aria-label={`Use colour ${c}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 hover:ring-2 hover:ring-slate-300"
                    style={{ backgroundColor: c }}>
                    {form.theme_color.toLowerCase() === c.toLowerCase() ? <Check size={16} className="text-white" /> : null}
                  </button>
                ))}
                <input type="color" value={form.theme_color} onChange={set('theme_color')} className="h-8 w-10 cursor-pointer rounded border border-slate-300" title="Custom colour" />
              </div>
            </div>
            <Field label="Invoice Number Prefix" hint='Optional, e.g. "AG/" prints as AG/23'>
              <input className="input" value={form.invoice_prefix} onChange={set('invoice_prefix')} />
            </Field>
            <label className="flex items-start gap-3 rounded-md border border-slate-200 p-3 sm:col-span-2">
              <input type="checkbox" className="mt-1 accent-link" checked={Boolean(form.fy_numbering)}
                onChange={(e) => setVal('fy_numbering')(e.target.checked ? 1 : 0)} />
              <span>
                <span className="block text-sm font-medium">Restart invoice numbers every financial year</span>
                <span className="block text-xs text-slate-500">
                  Numbers start again from 1 on 1 April. This year is {financialYear(today())}. Tip: put the year in the prefix
                  (e.g. "{financialYear(today()).slice(2)}/") so invoices from different years can't be confused.
                </span>
              </span>
            </label>
            <Field label="Terms and Conditions" className="sm:col-span-2">
              <textarea className="input" rows={3} value={form.terms} onChange={set('terms')} />
            </Field>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-1 font-semibold">Bank &amp; UPI Details</h2>
          <p className="mb-4 text-sm text-slate-500">Printed under "Pay To" on every invoice. With a UPI ID, a QR code for the balance due is printed too.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Bank Name">
              <input className="input" value={form.bank_name} onChange={set('bank_name')} placeholder="e.g. State Bank of India" />
            </Field>
            <Field label="Account Holder's Name">
              <input className="input" value={form.bank_holder} onChange={set('bank_holder')} />
            </Field>
            <Field label="Account Number">
              <input className="input" value={form.bank_account} onChange={set('bank_account')} inputMode="numeric" />
            </Field>
            <Field label="IFSC Code">
              <input className="input uppercase" value={form.bank_ifsc} onChange={set('bank_ifsc')} maxLength={11} />
            </Field>
            <Field label="UPI ID" hint="e.g. yourshop@okaxis or 9876543210@ybl" className="sm:col-span-2">
              <input className="input" value={form.upi_id} onChange={set('upi_id')} />
            </Field>
          </div>
        </section>

        <PinSection />

        <BackupSection lastBackup={form.last_backup_at} onBackedUp={() => setVal('last_backup_at')(new Date().toISOString())} />
      </form>

      <aside className="xl:sticky xl:top-4 xl:self-start">
        <p className="mb-2 text-sm font-semibold text-slate-600">Preview (sample invoice)</p>
        <div className="card h-[80vh] overflow-hidden">
          {preview ? <iframe title="Invoice preview" src={`${preview}#toolbar=0&view=FitH`} className="h-full w-full" /> : <Loading />}
        </div>
      </aside>
    </div>
  );
}
