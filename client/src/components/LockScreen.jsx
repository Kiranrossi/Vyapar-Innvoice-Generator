import { useEffect, useState } from 'react';
import { Delete, Lock } from 'lucide-react';
import { api } from '../api.js';

const MAX = 8;

// PIN pad shown until this device is unlocked. Works with taps or the keyboard.
export function LockScreen({ onUnlocked }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (value = pin) => {
    if (!value || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/unlock', { pin: value });
      onUnlocked();
    } catch (err) {
      setError(err.message);
      setPin('');
      setBusy(false);
    }
  };

  const press = (d) => {
    setError('');
    setPin((p) => (p.length < MAX ? p + d : p));
  };

  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy p-4">
      <div className="w-full max-w-xs text-center text-white">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl font-bold">₹</span>
        <h1 className="text-xl font-semibold">Invoice Generator</h1>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-slate-300"><Lock size={14} /> Enter PIN to unlock this device</p>

        <div className="my-6 flex h-4 justify-center gap-3" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <span key={i} className={`h-3.5 w-3.5 rounded-full border-2 border-white ${i < pin.length ? 'bg-white' : ''}`} />
          ))}
        </div>
        <p className="mb-3 min-h-5 text-sm text-red-300" role="alert">{error}</p>

        <div className="grid grid-cols-3 gap-3">
          {keys.map((k, i) =>
            k === '' ? (
              <span key={i} />
            ) : k === 'del' ? (
              <button key={i} type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete digit"
                className="flex h-16 items-center justify-center rounded-full text-slate-300 hover:bg-white/10">
                <Delete />
              </button>
            ) : (
              <button key={i} type="button" onClick={() => press(k)}
                className="h-16 rounded-full bg-white/10 text-2xl font-medium hover:bg-white/20 active:bg-white/30">
                {k}
              </button>
            ),
          )}
        </div>
        <button type="button" onClick={() => submit()} disabled={!pin || busy} className="btn-primary mt-6 w-full py-3 text-base">
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <p className="mt-4 text-xs text-slate-400">You only need to do this once on each phone or tablet.</p>
      </div>
    </div>
  );
}
