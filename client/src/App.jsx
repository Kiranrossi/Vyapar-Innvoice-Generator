import { useEffect, useState } from 'react';
import { NavLink, Outlet, Route, Routes, Link, useLocation } from 'react-router-dom';
import { Home, Users, Package, FileText, BarChart3, Settings as SettingsIcon, Plus, Menu, X } from 'lucide-react';
import Dashboard from './pages/Dashboard.jsx';
import Invoices from './pages/Invoices.jsx';
import InvoiceForm from './pages/InvoiceForm.jsx';
import InvoiceView from './pages/InvoiceView.jsx';
import Parties from './pages/Parties.jsx';
import Items from './pages/Items.jsx';
import Settings from './pages/Settings.jsx';
import Reports from './pages/Reports.jsx';
import { Empty, Loading } from './components/ui.jsx';
import { LockScreen } from './components/LockScreen.jsx';
import { api, LOCKED_EVENT } from './api.js';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/parties', label: 'Parties', icon: Users },
  { to: '/items', label: 'Items', icon: Package },
  { to: '/sale', label: 'Sale', icon: FileText },
  { to: '/reports', label: 'GST Report', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const sidebar = (
    <nav className="flex h-full w-60 flex-col bg-navy text-slate-200">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-lg font-bold text-white">₹</span>
        <span className="text-lg font-semibold text-white">Invoice Generator</span>
      </div>
      <div className="px-4 pb-3">
        <Link to="/sale/new" className="btn-primary w-full"><Plus size={16} /> Add Sale</Link>
      </div>
      <ul className="flex-1 space-y-0.5 px-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink to={to} end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-navy-light text-white' : 'text-slate-300 hover:bg-navy-light/60 hover:text-white'
                }`
              }>
              <Icon size={18} />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
      <p className="px-5 py-4 text-xs text-slate-500">GST invoices · PDF ready</p>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen shrink-0 lg:block">{sidebar}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="h-full">{sidebar}</div>
          <button className="flex-1 bg-black/40" onClick={() => setOpen(false)} aria-label="Close menu" />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button className="btn-ghost" onClick={() => setOpen(true)} aria-label="Open menu">{open ? <X /> : <Menu />}</button>
          <span className="font-semibold">Invoice Generator</span>
          <Link to="/sale/new" className="btn-primary ml-auto py-1.5"><Plus size={15} /> Sale</Link>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  // null = checking, false = show PIN pad, true = unlocked
  const [unlocked, setUnlocked] = useState(null);

  useEffect(() => {
    api.get('/auth/status').then((s) => setUnlocked(s.unlocked)).catch(() => setUnlocked(false));
    const lock = () => setUnlocked(false);
    window.addEventListener(LOCKED_EVENT, lock);
    return () => window.removeEventListener(LOCKED_EVENT, lock);
  }, []);

  if (unlocked === null) return <Loading />;
  if (!unlocked) return <LockScreen onUnlocked={() => setUnlocked(true)} />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="parties" element={<Parties />} />
        <Route path="items" element={<Items />} />
        <Route path="sale" element={<Invoices />} />
        <Route path="sale/new" element={<InvoiceForm key="new" />} />
        <Route path="sale/:id" element={<InvoiceView />} />
        <Route path="sale/:id/edit" element={<InvoiceForm key="edit" />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Empty title="Page not found" action={<Link className="btn-outline" to="/">Go home</Link>} />} />
      </Route>
    </Routes>
  );
}
