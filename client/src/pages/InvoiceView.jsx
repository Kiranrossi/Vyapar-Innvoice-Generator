import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Pencil, Printer, Trash2, Plus, IndianRupee, MessageCircle, X } from 'lucide-react';
import { formatDate, money } from '@shared/calc.js';
import { api } from '../api.js';
import { invoiceBlob, invoiceFileName, saveBlob, shareMessage } from '../pdf/InvoicePDF.jsx';
import { shareOnWhatsApp } from '../share.js';
import { PaymentModal } from '../components/PaymentModal.jsx';
import { ErrorBox, Loading, StatusBadge, useToast } from '../components/ui.jsx';

export default function InvoiceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    Promise.all([api.get(`/invoices/${id}`), api.get('/business')])
      .then(([invoice, business]) => setData({ invoice, business }))
      .catch(setError);
  }, [id]);

  useEffect(() => {
    if (!data) return;
    let url = '';
    let cancelled = false;
    invoiceBlob(data.invoice, data.business).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setPdf({ blob, url });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { invoice, business } = data;
  const fileName = invoiceFileName(invoice, business);

  const remove = async () => {
    if (!confirm(`Delete invoice #${invoice.invoice_no} for ${invoice.party_name}? This can't be undone.`)) return;
    try {
      await api.del(`/invoices/${id}`);
      toast('Invoice deleted');
      navigate('/sale');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const whatsapp = async () => {
    const result = await shareOnWhatsApp({ blob: pdf.blob, fileName, phone: invoice.party_phone, text: shareMessage(invoice, business) });
    if (result === 'opened') toast('PDF downloaded. Attach it in the WhatsApp chat that just opened.');
  };

  const removePayment = async (p) => {
    if (!confirm(`Delete the payment of ₹ ${money(p.amount)} on ${formatDate(p.payment_date)}?`)) return;
    try {
      const invoice = await api.del(`/payments/${p.id}`);
      setData((d) => ({ ...d, invoice }));
      toast('Payment deleted');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="btn-ghost" onClick={() => navigate('/sale')} aria-label="Back to sales"><ArrowLeft size={18} /></button>
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            Invoice #{business.invoice_prefix}{invoice.invoice_no}
            <StatusBadge total={invoice.total} balance={invoice.balance} />
          </h1>
          <p className="text-sm text-slate-500">
            {invoice.party_name} · {formatDate(invoice.invoice_date)} · Total ₹ {money(invoice.total)}
          </p>
        </div>
        <Link className="btn-outline" to={`/sale/${id}/edit`}><Pencil size={15} /> Edit</Link>
        <button className="btn-outline border-red-200 text-red-600 hover:bg-red-50" onClick={remove}><Trash2 size={15} /> Delete</button>
        <button className="btn-outline" onClick={() => window.open(pdf.url, '_blank')} disabled={!pdf}><Printer size={15} /> Print</button>
        <button className="btn-outline" onClick={() => saveBlob(pdf.blob, fileName)} disabled={!pdf}><Download size={15} /> PDF</button>
        <button className="btn bg-[#25D366] text-white hover:bg-[#1ebe5b]" onClick={whatsapp} disabled={!pdf}><MessageCircle size={15} /> WhatsApp</button>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="card min-h-[75vh] overflow-hidden">
          {pdf ? <iframe title="Invoice preview" src={pdf.url} className="h-full min-h-[75vh] w-full" /> : <Loading />}
        </div>

        <aside className="card self-start p-4">
          <h2 className="mb-3 font-semibold">Payments</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Invoice total</dt><dd>₹ {money(invoice.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Received</dt><dd className="text-emerald-700">₹ {money(invoice.paid)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold">
              <dt>Balance due</dt><dd className={invoice.balance > 0 ? 'text-red-600' : 'text-emerald-600'}>₹ {money(invoice.balance)}</dd>
            </div>
          </dl>

          <ul className="mt-4 space-y-2 text-sm">
            {invoice.received > 0 ? (
              <li className="rounded-md bg-slate-50 px-3 py-2">
                <div className="flex justify-between font-medium"><span>₹ {money(invoice.received)}</span><span className="text-slate-500">{formatDate(invoice.invoice_date)}</span></div>
                <div className="text-xs text-slate-500">Received at time of sale</div>
              </li>
            ) : null}
            {invoice.payments.map((p) => (
              <li key={p.id} className="group rounded-md bg-slate-50 px-3 py-2">
                <div className="flex items-center justify-between font-medium">
                  <span>₹ {money(p.amount)}</span>
                  <span className="flex items-center gap-1 text-slate-500">
                    {formatDate(p.payment_date)}
                    <button className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => removePayment(p)} aria-label="Delete payment" title="Delete payment">
                      <X size={14} />
                    </button>
                  </span>
                </div>
                <div className="text-xs text-slate-500">{p.mode}{p.note ? ` · ${p.note}` : ''}</div>
              </li>
            ))}
            {!invoice.received && !invoice.payments.length ? <li className="text-slate-400">No payments yet.</li> : null}
          </ul>

          {invoice.balance > 0 ? (
            <button className="btn-blue mt-4 w-full" onClick={() => setPaying(true)}><IndianRupee size={15} /> Add Payment</button>
          ) : null}
          <Link className="btn-outline mt-2 w-full" to="/sale/new"><Plus size={15} /> New Sale</Link>
        </aside>
      </div>

      {paying ? (
        <PaymentModal
          invoice={invoice}
          onClose={() => setPaying(false)}
          onSaved={(updated) => {
            setPaying(false);
            setData((d) => ({ ...d, invoice: updated }));
          }}
        />
      ) : null}
    </div>
  );
}
