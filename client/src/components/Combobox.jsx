import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

// Type-to-search picker like Vyapar's party / item fields. Typing a name that
// isn't in the list offers an "Add" option, and free text is kept either way.
export function Combobox({
  value,
  onChange,
  onSelect,
  options,
  getLabel = (o) => o.name,
  renderOption,
  searchText = (o) => getLabel(o),
  onAddNew,
  addLabel = 'Add new',
  placeholder,
  className = 'input',
  autoFocus,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const filtered = useMemo(() => {
    const q = (value || '').trim().toLowerCase();
    const list = q ? options.filter((o) => searchText(o).toLowerCase().includes(q)) : options;
    return list.slice(0, 50);
  }, [options, value, searchText]);

  const exact = options.some((o) => getLabel(o).toLowerCase() === (value || '').trim().toLowerCase());
  const showAdd = onAddNew && !exact;
  const total = filtered.length + (showAdd ? 1 : 0);

  useEffect(() => {
    const close = (e) => wrapRef.current && !wrapRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => setActive(0), [value]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (i) => {
    if (i < filtered.length) onSelect(filtered[i]);
    else if (showAdd) onAddNew(value.trim());
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (!open || !total) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + total) % total);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        className={className}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {open && total > 0 ? (
        <ul
          ref={listRef}
          className="absolute top-full left-0 z-30 mt-1 max-h-64 w-full min-w-64 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {showAdd ? (
            <li
              onMouseDown={(e) => {
                e.preventDefault();
                choose(filtered.length);
              }}
              onMouseEnter={() => setActive(filtered.length)}
              className={`flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm font-semibold text-link ${
                active === filtered.length ? 'bg-sky-50' : ''
              }`}
            >
              <Plus size={15} />
              {value?.trim() ? `${addLabel} "${value.trim()}"` : addLabel}
            </li>
          ) : null}
          {filtered.map((o, i) => (
            <li
              key={o.id ?? i}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${active === i ? 'bg-sky-50' : ''}`}
            >
              {renderOption ? renderOption(o) : getLabel(o)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
