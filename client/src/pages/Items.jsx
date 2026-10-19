import { useMemo, useState } from 'react';
import { Plus, Search, Package, Pencil, Trash2 } from 'lucide-react';
import { money } from '@shared/calc.js';
import { api } from '../api.js';
import { ItemModal } from '../components/ItemModal.jsx';
import { Empty, ErrorBox, Loading, PageHeader, useLoad, useToast } from '../components/ui.jsx';

export default function Items() {
  const toast = useToast();
  const { data: items, error, reload } = useLoad(() => api.get('/items'));
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (items || []).filter((i) => !s || `${i.name} ${i.hsn}`.toLowerCase().includes(s));
  }, [items, q]);

  if (error) return <ErrorBox error={error} />;
  if (!items) return <Loading />;

  const remove = async (item) => {
    if (!confirm(`Delete ${item.name}? Old invoices keep their copy of this item.`)) return;
    try {
      await api.del(`/items/${item.id}`);
      toast('Item deleted');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Items">
        <button className="btn-primary" onClick={() => setModal({})}><Plus size={16} /> Add Item</button>
      </PageHeader>
      <div className="card">
        {!items.length ? (
          <Empty icon={Package} title="No items yet"
            text="Add the products you sell, or type a new item name on a sale — it's saved here automatically."
            action={<button className="btn-primary" onClick={() => setModal({})}><Plus size={16} /> Add Item</button>} />
        ) : (
          <>
            <div className="border-b border-slate-200 p-3">
              <div className="relative max-w-sm">
                <Search size={16} className="absolute top-2.5 left-3 text-slate-400" />
                <input className="input pl-9" placeholder="Search items or HSN" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-2">Item Name</th>
                    <th className="px-4 py-2">HSN/SAC</th>
                    <th className="px-4 py-2 text-right">Sale Price</th>
                    <th className="px-4 py-2 text-right">Purchase Price</th>
                    <th className="px-4 py-2 text-right">GST</th>
                    <th className="px-4 py-2 text-right">Stock</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((it) => (
                    <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium">{it.name}</td>
                      <td className="px-4 py-2.5 text-slate-500">{it.hsn}</td>
                      <td className="px-4 py-2.5 text-right">₹ {money(it.sale_price)}</td>
                      <td className="px-4 py-2.5 text-right">₹ {money(it.purchase_price)}</td>
                      <td className="px-4 py-2.5 text-right">{it.gst_rate}%</td>
                      <td className={`px-4 py-2.5 text-right ${it.stock < 0 ? 'text-red-600' : ''}`}>{it.stock} {it.unit}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <button className="btn-ghost" title="Edit" onClick={() => setModal(it)}><Pencil size={15} /></button>
                        <button className="btn-ghost hover:text-red-600" title="Delete" onClick={() => remove(it)}><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {modal ? (
        <ItemModal item={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />
      ) : null}
    </div>
  );
}
