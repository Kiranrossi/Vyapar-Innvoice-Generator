import { useEffect, useRef, useState } from 'react';
import { money } from '@shared/calc.js';

// Chart colours (validated: contrast >= 3:1, colour-blind separation passes).
export const SERIES = { blue: '#2a78d6', orange: '#eb6834' };
const INK = { primary: '#1e293b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7' };

// ₹ in Indian short form: ₹950, ₹12.5K, ₹3.4L, ₹1.2Cr
export function compactINR(n) {
  const v = Math.abs(Number(n) || 0);
  const sign = n < 0 ? '-' : '';
  const fmt = (x) => (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toString();
  if (v >= 1e7) return `${sign}₹${fmt(v / 1e7)}Cr`;
  if (v >= 1e5) return `${sign}₹${fmt(v / 1e5)}L`;
  if (v >= 1e3) return `${sign}₹${fmt(v / 1e3)}K`;
  return `${sign}₹${Math.round(v)}`;
}

// 0 and a few clean steps up to just above the max.
function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let t = 0; t <= max + step * 0.001; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs whitespace-nowrap shadow-lg"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      <div className="text-sm font-semibold text-slate-900">{tip.value}</div>
      <div className="text-slate-500">{tip.label}</div>
    </div>
  );
}

// Vertical columns from one baseline: sales per day or per month.
// points: [{ key, axis, title, value, count }]
export function ColumnChart({ points, height = 220, color = SERIES.blue }) {
  const [ref, width] = useWidth();
  const [tip, setTip] = useState(null);
  const [active, setActive] = useState(null);
  const pad = { top: 12, right: 8, bottom: 26, left: 52 };
  const plotW = Math.max(width - pad.left - pad.right, 10);
  const plotH = height - pad.top - pad.bottom;
  const ticks = niceTicks(Math.max(...points.map((p) => p.value), 0));
  const top = ticks[ticks.length - 1];
  const band = plotW / Math.max(points.length, 1);
  const barW = Math.max(Math.min(24, band - 2), 2);
  const y = (v) => pad.top + plotH - (v / top) * plotH;
  // Label roughly every Nth column so axis text never collides.
  const every = Math.max(1, Math.ceil(points.length / Math.max(Math.floor(plotW / 44), 1)));

  const show = (p, i, cx) => {
    setActive(i);
    setTip({ x: cx, y: y(p.value), value: `₹ ${money(p.value)}`, label: `${p.title}${p.count ? ` · ${p.count} invoice${p.count > 1 ? 's' : ''}` : ''}` });
  };
  const hide = () => {
    setActive(null);
    setTip(null);
  };

  return (
    <div ref={ref} className="relative w-full" onPointerLeave={hide}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label="Sales chart">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? INK.axis : INK.grid} strokeWidth="1" />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={INK.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {compactINR(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const cx = pad.left + band * i + band / 2;
            const h = Math.max(y(0) - y(p.value), 0);
            const x0 = cx - barW / 2;
            const r = Math.min(4, h, barW / 2);
            // Rounded data end, square at the baseline.
            const d = h > 0
              ? `M${x0},${y(0)} V${y(0) - h + r} Q${x0},${y(0) - h} ${x0 + r},${y(0) - h} H${x0 + barW - r} Q${x0 + barW},${y(0) - h} ${x0 + barW},${y(0) - h + r} V${y(0)} Z`
              : null;
            return (
              <g key={p.key}>
                {d ? <path d={d} fill={color} opacity={active === null || active === i ? 1 : 0.55} /> : null}
                {i % every === 0 || i === points.length - 1 ? (
                  <text x={cx} y={height - 8} textAnchor="middle" fontSize="11" fill={INK.muted}>{p.axis}</text>
                ) : null}
                {/* Hit area: the whole column slot, not just the painted bar. */}
                <rect
                  x={pad.left + band * i}
                  y={pad.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${p.title}: ₹ ${money(p.value)}`}
                  onPointerMove={() => show(p, i, cx)}
                  onPointerDown={() => show(p, i, cx)}
                  onFocus={() => show(p, i, cx)}
                  onBlur={hide}
                  style={{ outline: 'none', cursor: 'default' }}
                />
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

// Ranked horizontal bars with the value at the tip. rows: [{ key, label, sub, value, onClick }]
export function BarList({ rows, color = SERIES.blue, empty = 'Nothing yet' }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-slate-400">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const Row = r.onClick ? 'button' : 'div';
        return (
          <li key={r.key}>
            <Row onClick={r.onClick} className={`block w-full text-left ${r.onClick ? 'rounded-md hover:bg-slate-50' : ''}`}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium text-slate-800">{r.label}</span>
                <span className="shrink-0 font-semibold text-slate-900">₹ {money(r.value)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 flex-1 rounded-r bg-slate-100">
                  <div className="h-3 rounded-r" style={{ width: `${Math.max((r.value / max) * 100, 1.5)}%`, background: color }} />
                </div>
              </div>
              {r.sub ? <div className="mt-0.5 text-xs text-slate-500">{r.sub}</div> : null}
            </Row>
          </li>
        );
      })}
    </ul>
  );
}

// Two-part donut (collected vs due) with the share collected in the middle.
// parts: [{ key, label, value, color }]
export function Donut({ parts, size = 168, centre, centreSub }) {
  const [tip, setTip] = useState(null);
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  const gap = total > 0 && parts.filter((p) => p.value > 0).length > 1 ? 2 : 0; // 2px surface gap between segments
  let offset = 0;
  return (
    <div className="relative mx-auto" style={{ width: size }} onPointerLeave={() => setTip(null)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={parts.map((p) => `${p.label} ₹ ${money(p.value)}`).join(', ')}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth="22" />
        {total > 0
          ? parts.map((p) => {
              const len = (p.value / total) * c;
              const seg = (
                <circle
                  key={p.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="22"
                  strokeDasharray={`${Math.max(len - gap, 0)} ${c}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  tabIndex={0}
                  style={{ outline: 'none' }}
                  onPointerMove={() => setTip({ x: size / 2, y: 14, value: `₹ ${money(p.value)}`, label: `${p.label} · ${Math.round((p.value / total) * 100)}%` })}
                  onFocus={() => setTip({ x: size / 2, y: 14, value: `₹ ${money(p.value)}`, label: `${p.label} · ${Math.round((p.value / total) * 100)}%` })}
                  onBlur={() => setTip(null)}
                />
              );
              offset += len;
              return seg;
            })
          : null}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl font-semibold text-slate-900">{centre}</span>
        <span className="text-xs text-slate-500">{centreSub}</span>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

export function Legend({ items }) {
  return (
    <ul className="space-y-2 text-sm">
      {items.map((it) => (
        <li key={it.label} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-slate-600">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: it.color }} />
            {it.label}
          </span>
          <span className="font-semibold text-slate-900">₹ {money(it.value)}</span>
        </li>
      ))}
    </ul>
  );
}
