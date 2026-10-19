import { useEffect, useState } from 'react';
import { Download, MessageCircle } from 'lucide-react';
import { financialYear, fyRange, formatDate, money, today } from '@shared/calc.js';
import { api } from '../api.js';
import { saveBlob } from '../pdf/InvoicePDF.jsx';
import { statementBlob, statementFileName } from '../pdf/StatementPDF.jsx';
import { shareOnWhatsApp } from '../share.js';
import { Loading, Modal, useToast } from './ui.jsx';

const PERIODS = {
  all: { label: 'All time', range: () => ['', ''] },
  fy: { label: `This financial year (${financialYear(today())})`, range: () => fyRange(financialYear(today())) },
  month: { label: 'This month', range: () => [today().slice(0, 8) + '01', today()] },
  custom: { label: 'Custom dates', range: null },
};

export function StatementModal({ party, onClose }) {
  const toast = useToast();
  const [period, setPeriod] = useState('all');
  const [custom, setCustom] = useState({ from: today().slice(0, 8) + '01', to: today() });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const [from, to] = period === 'custom' ? [custom.from, custom.to] : PERIODS[period].range();

  useEffect(() => {
    let url = '';
    let cancelled = false;
    setResult(null);
    setError('');
    Promise.all([api.get(`/parties/${party.id}/statement?from=${from}&to=${to}`), api.get('/business')])
      .then(async ([statement, business]) => {
        const blob = await statementBlob(statement, business);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setResult({ statement, business, blob, url });
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [party.id, from, to]);

  const share = async () => {
    const { statement, business, blob } = result;
    const text = [
      `Dear ${party.name},`,
      `Please find your account statement${from ? ` from ${formatDate(from)} to ${formatDate(to)}` : ''}.`,
      statement.closing > 0 ? `Balance due: ₹ ${money(statement.closing)}.` : 'No balance due. Thank you!',
      business.upi_id ? `Pay by UPI: ${business.upi_id}` : '',
      '',
      'Thank you,',
      business.name,
    ].filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n');
    const r = await shareOnWhatsApp({ blob, fileName: statementFileName(statement), phone: party.phone, text });
    if (r === 'opened') toast('PDF downloaded. Attach it in the WhatsApp chat that just opened.');
  };

  return (
    <Modal title={`Statement: ${party.name}`} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">Period</span>
          <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {Object.entries(PERIODS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
        </label>
        {period === 'custom' ? (
          <>
            <label className="block">
              <span className="label">From</span>
              <input className="input" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </label>
            <label className="block">
              <span className="label">To</span>
              <input className="input" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </label>
          </>
        ) : null}
        <div className="ml-auto flex gap-2">
          <button className="btn-outline" disabled={!result} onClick={() => saveBlob(result.blob, statementFileName(result.statement))}>
            <Download size={15} /> PDF
          </button>
          <button className="btn bg-[#25D366] text-white hover:bg-[#1ebe5b]" disabled={!result} onClick={share}>
            <MessageCircle size={15} /> WhatsApp
          </button>
        </div>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="h-[65vh] overflow-hidden rounded-md border border-slate-200">
        {result ? <iframe title="Statement preview" src={result.url} className="h-full w-full" /> : <Loading />}
      </div>
    </Modal>
  );
}
