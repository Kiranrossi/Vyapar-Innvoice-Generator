import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, ArrowDownLeft, Users, Package, Settings as SettingsIcon, DownloadCloud, FileText, Table2, BarChart3 } from 'lucide-react';
import { financialYear, fyRange, formatDate, money, today } from '@shared/calc.js';
import { api } from '../api.js';
import { downloadBackup } from '../backup.js';
import { BarList, ColumnChart, Donut, Legend, SERIES } from '../components/charts.jsx';
import { ErrorBox, Loading, StatusBadge, useLoad } from '../components/ui.jsx';

function Stat({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className={`rounded-md p-1.5 ${color}`}><Icon size={16} /></span>
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {sub ? <p className="text-xs text-slate-400">{sub}</p> : null}
    </div>
  );
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthPeriod(offset) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: iso(first), to: iso(last), group: 'day', name: `${MONTHS[first.getMonth()]} ${first.getFullYear()}` };
}

const PERIODS = {
  month: { label: 'This month', get: () => monthPeriod(0) },
  lastMonth: { label: 'Last month', get: () => monthPeriod(-1) },
  fy: {
    label: 'This year',
    get: () => {
      const fy = financialYear(today());
      const [from, to] = fyRange(fy);
      return { from, to, group: 'month', name: `FY ${fy}` };
    },
  },
};

// Every day of the month / every month of the year, zeros included, so gaps show.
function fillSeries(period, series) {
  const byKey = new Map(series.map((s) => [s.key, s]));
  const points = [];
  if (period.group === 'day') {
    const d = new Date(period.from + 'T00:00:00');
    const end = new Date(period.to + 'T00:00:00');
    for (; d <= end; d.setDate(d.getDate() + 1)) {
      const key = iso(d);
      const s = byKey.get(key);
      points.push({ key, axis: String(d.getDate()), title: formatDate(key), value: s?.total || 0, count: s?.count || 0 });
    }
  } else {
    const d = new Date(period.from + 'T00:00:00');
    for (let i = 0; i < 12; i++, d.setMonth(d.getMonth() + 1)) {
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      const s = byKey.get(key);
      points.push({ key, axis: MONTHS[d.getMonth()], title: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, value: s?.total || 0, count: s?.count || 0 });
    }
  }
  return points;
}

function SalesReport() {
  const navigate = useNavigate();
  const [periodKey, setPeriodKey] = useState('month');
  const [charts, setCharts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [asTable, setAsTable] = useState(false);
  const period = useMemo(() => PERIODS[periodKey].get(), [periodKey]);

  // Keep the previous charts on screen (faded) while the new period loads.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/dashboard/charts?from=${period.from}&to=${period.to}&group=${period.group}`)
      .then((d) => !cancelled && (setCharts({ ...d, period }), setError(null)))
      .catch((err) => !cancelled && setError(err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period]);

  const points = useMemo(() => (charts ? fillSeries(charts.period, charts.series) : []), [charts]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Sales Report</h2>
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5" role="group" aria-label="Period">
          {Object.entries(PERIODS).map(([k, p]) => (
            <button key={k} onClick={() => setPeriodKey(k)} aria-pressed={periodKey === k}
              className={`rounded px-3 py-1.5 text-sm font-medium ${periodKey === k ? 'bg-navy text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <ErrorBox error={error} /> : !charts ? <Loading /> : (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          {/* 1. Sales per day / month */}
          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm text-slate-500">Sales · {charts.period.name}</p>
                <p className="text-2xl font-semibold">₹ {money(charts.total)}</p>
                <p className="text-xs text-slate-400">{charts.count} invoice{charts.count === 1 ? '' : 's'} · {charts.period.group === 'day' ? 'per day' : 'per month'}</p>
              </div>
              <button className="btn-ghost text-xs" onClick={() => setAsTable((t) => !t)}>
                {asTable ? <><BarChart3 size={14} /> Show chart</> : <><Table2 size={14} /> Show as table</>}
              </button>
            </div>
            {asTable ? (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white text-left text-xs text-slate-500 uppercase">
                    <tr><th className="py-1.5">{charts.period.group === 'day' ? 'Date' : 'Month'}</th><th className="py-1.5 text-right">Invoices</th><th className="py-1.5 text-right">Sales</th></tr>
                  </thead>
                  <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {points.filter((p) => p.count).map((p) => (
                      <tr key={p.key} className="border-t border-slate-100">
                        <td className="py-1.5">{p.title}</td><td className="py-1.5 text-right">{p.count}</td><td className="py-1.5 text-right">₹ {money(p.value)}</td>
                      </tr>
                    ))}
                    {!points.some((p) => p.count) ? <tr><td colSpan={3} className="py-6 text-center text-slate-400">No sales in this period</td></tr> : null}
                  </tbody>
                </table>
              </div>
            ) : (
              <ColumnChart points={points} />
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* 2. Collected vs due */}
            <div className="card p-4">
              <h3 className="mb-3 font-semibold">Received vs Due</h3>
              {charts.total > 0 ? (
                <>
                  <Donut
                    parts={[
                      { key: 'received', label: 'Received', value: charts.received, color: SERIES.blue },
                      { key: 'due', label: 'Due', value: charts.due, color: SERIES.orange },
                    ]}
                    centre={`${Math.round((charts.received / charts.total) * 100)}%`}
                    centreSub="collected"
                  />
                  <div className="mt-4">
                    <Legend items={[
                      { label: 'Received', value: charts.received, color: SERIES.blue },
                      { label: 'Due', value: charts.due, color: SERIES.orange },
                    ]} />
                  </div>
                </>
              ) : (
                <p className="py-6 text-center text-sm text-slate-400">No sales in this period</p>
              )}
            </div>

            {/* 3. Top customers */}
            <div className="card p-4">
              <h3 className="mb-3 font-semibold">Top Customers</h3>
              <BarList
                empty="No sales in this period"
                rows={charts.customers.map((c) => ({
                  key: c.id ?? c.name,
                  label: c.name,
                  value: c.total,
                  sub: `${c.count} invoice${c.count === 1 ? '' : 's'}`,
                  onClick: c.id ? () => navigate(`/parties?party=${c.id}`) : undefined,
                }))}
              />
            </div>

            {/* 4. Top items */}
            <div className="card p-4">
              <h3 className="mb-3 font-semibold">Top Items</h3>
              <BarList
                empty="No sales in this period"
                rows={charts.items.map((it) => ({ key: it.name, label: it.name, value: it.total, sub: `${it.qty} ${it.unit} sold` }))}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(() => Promise.all([api.get('/dashboard'), api.get('/business')]));
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const [d, business] = data;
  const daysSinceBackup = business.last_backup_at
    ? Math.floor((Date.now() - new Date(business.last_backup_at.replace(' ', 'T') + (business.last_backup_at.includes('Z') ? '' : 'Z')).getTime()) / 86400000)
    : null;
  const needsBackup = d.count > 0 && (daysSinceBackup === null || daysSinceBackup >= 7);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{business.name || 'Welcome'}</h1>
          <p className="text-sm text-slate-500">Here's how your business is doing.</p>
        </div>
        <Link to="/sale/new" className="btn-primary"><Plus size={16} /> Add Sale</Link>
      </div>

      {!business.name ? (
        <div className="card flex flex-wrap items-center gap-4 border-amber-200 bg-amber-50 p-4">
          <SettingsIcon className="text-amber-600" />
          <div className="mr-auto">
            <p className="font-semibold text-amber-900">Set up your business first</p>
            <p className="text-sm text-amber-800">Add your business name, address, GSTIN, logo and signature so they print on every invoice.</p>
          </div>
          <Link to="/settings" className="btn-blue">Open Settings</Link>
        </div>
      ) : null}

      {needsBackup ? (
        <div className="card flex flex-wrap items-center gap-4 border-sky-200 bg-sky-50 p-4">
          <DownloadCloud className="text-link" />
          <div className="mr-auto">
            <p className="font-semibold text-sky-900">
              {daysSinceBackup === null ? 'You have never downloaded a backup' : `Last backup was ${daysSinceBackup} days ago`}
            </p>
            <p className="text-sm text-sky-800">Download one and keep it on Google Drive or a pen drive, so you always have your own copy.</p>
          </div>
          <button className="btn-blue" onClick={() => downloadBackup().then(reload).catch((err) => alert(err.message))}>Download Backup</button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat icon={ArrowDownLeft} label="You'll Receive" value={`₹ ${money(d.receivable)}`} sub="Unpaid balance from all parties" color="bg-emerald-50 text-emerald-600" />
        <Stat icon={Users} label="Parties" value={d.parties} sub="Saved customers" color="bg-violet-50 text-violet-600" />
        <Stat icon={Package} label="Items" value={d.items} sub="Saved products" color="bg-amber-50 text-amber-600" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 5. Who owes the most */}
        <div className="card">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="font-semibold">Who Owes the Most</h2>
            <p className="text-xs text-slate-500">Tap a name to open their statement and send it on WhatsApp</p>
          </div>
          {d.owes.length ? (
            <ul>
              {d.owes.map((p) => (
                <li key={p.id} className="border-t border-slate-100 first:border-t-0">
                  <button onClick={() => navigate(`/parties?party=${p.id}&statement=1`)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-sky-50/50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      {p.phone ? <span className="block text-xs text-slate-400">{p.phone}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-semibold text-red-600">₹ {money(p.balance)}</span>
                      <FileText size={15} className="text-slate-400" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Nobody owes you anything right now.</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="font-semibold">Recent Sales</h2>
            <Link to="/sale" className="text-sm font-medium text-link hover:underline">View all</Link>
          </div>
          {d.recent.length ? (
            <ul>
              {d.recent.slice(0, 5).map((inv) => (
                <li key={inv.id} className="border-t border-slate-100 first:border-t-0">
                  <button onClick={() => navigate(`/sale/${inv.id}`)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-sky-50/50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{inv.party_name}</span>
                      <span className="block text-xs text-slate-400">#{business.invoice_prefix}{inv.invoice_no} · {formatDate(inv.invoice_date)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span>₹ {money(inv.total)}</span>
                      <StatusBadge total={inv.total} balance={inv.balance} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-slate-500">No sales yet. Click <b>Add Sale</b> to make your first invoice.</p>
          )}
        </div>
      </div>

      <SalesReport />
    </div>
  );
}

