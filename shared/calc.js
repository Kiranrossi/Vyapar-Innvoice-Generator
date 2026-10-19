import { stateCode } from './states.js';

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];
export const UNITS = ['Pcs', 'Nos', 'Box', 'Kg', 'Gm', 'Ltr', 'Mtr', 'Ft', 'Sqft', 'Set', 'Pair', 'Dozen', 'Bag', 'Bundle'];

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export const isInterState = (businessState, placeOfSupply) => {
  const a = stateCode(businessState);
  const b = stateCode(placeOfSupply);
  return Boolean(a && b && a !== b);
};

// Discount is a % taken off the price before GST, so GST is charged on the
// discounted value (as the law requires for discounts shown on the invoice).
export function calcLine(line) {
  const qty = num(line.qty);
  const price = num(line.price);
  const rate = num(line.gst_rate);
  const discPct = Math.min(Math.max(num(line.discount_pct), 0), 100);
  const gross = round2(qty * price);
  const discount = round2((gross * discPct) / 100);
  const taxable = round2(gross - discount);
  const tax = round2((taxable * rate) / 100);
  return { gross, discount, taxable, tax, amount: round2(taxable + tax) };
}

// Totals for a whole invoice. Same-state sales split GST into SGST + CGST,
// sales to another state use IGST, grouped by rate like Vyapar's summary box.
// `received` is everything paid so far (at billing + later payments).
export function calcInvoice(lines, { businessState, placeOfSupply, received, roundOff, inter: interOverride } = {}) {
  const inter = interOverride ?? isInterState(businessState, placeOfSupply);
  let qty = 0;
  let subtotal = 0;
  let tax = 0;
  let discount = 0;
  const byRate = new Map();

  for (const line of lines) {
    const l = calcLine(line);
    qty += num(line.qty);
    subtotal += l.taxable;
    tax += l.tax;
    discount += l.discount;
    const rate = num(line.gst_rate);
    const r = byRate.get(rate) || { taxable: 0, tax: 0 };
    byRate.set(rate, { taxable: r.taxable + l.taxable, tax: r.tax + l.tax });
  }

  const taxRows = [];
  const rates = [];
  for (const [rate, { taxable, tax: t }] of [...byRate.entries()].sort((a, b) => a[0] - b[0])) {
    const half = round2(t / 2);
    const row = inter
      ? { rate, taxable: round2(taxable), igst: round2(t), cgst: 0, sgst: 0 }
      : { rate, taxable: round2(taxable), igst: 0, sgst: half, cgst: round2(t - half) };
    rates.push(row);
    if (rate <= 0) continue;
    if (inter) {
      taxRows.push({ label: `IGST@${rate.toFixed(1)}%`, amount: row.igst });
    } else {
      taxRows.push({ label: `SGST@${(rate / 2).toFixed(1)}%`, amount: row.sgst });
      taxRows.push({ label: `CGST@${(rate / 2).toFixed(1)}%`, amount: row.cgst });
    }
  }

  const exact = round2(subtotal + tax);
  const total = roundOff ? Math.round(exact) : exact;
  const rec = round2(num(received));
  return {
    inter,
    qty: round2(qty),
    discount: round2(discount),
    subtotal: round2(subtotal),
    tax: round2(tax),
    taxRows,
    rates,
    roundOff: round2(total - exact),
    total,
    received: rec,
    balance: round2(total - rec),
  };
}

// Indian financial year (April–March) of a date: "2026-10-17" -> "2026-27".
export function financialYear(iso) {
  const [y, m] = (iso || today()).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export const fyRange = (fy) => {
  const start = Number(fy.slice(0, 4));
  return [`${start}-04-01`, `${start + 1}-03-31`];
};

// Normalise an Indian mobile number for wa.me links ("98765 43210" -> "919876543210").
export function whatsappNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1);
  return digits;
}

// 77000.5 -> "11,000.50" with Indian digit grouping.
export const money = (n) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(n));
export const rupees = (n) => `₹ ${money(n)}`;

// "2026-10-17" -> "17-10-2026"
export const formatDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};

export const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
}

// Indian system (Crore / Lakh / Thousand / Hundred), "and" before the last part:
// 90860 -> "Ninety Thousand Eight Hundred and Sixty"
function intToWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  if (crore) parts.push(intToWords(crore) + ' Crore');
  if (lakh) parts.push(belowHundred(lakh) + ' Lakh');
  if (thousand) parts.push(belowHundred(thousand) + ' Thousand');
  if (hundred) parts.push(ONES[hundred] + ' Hundred');
  if (rest) {
    const words = belowHundred(rest);
    return parts.length ? parts.join(' ') + ' and ' + words : words;
  }
  return parts.join(' ');
}

export function amountInWords(amount) {
  const value = round2(Math.abs(num(amount)));
  const whole = Math.floor(value);
  const paise = Math.round((value - whole) * 100);
  let out = `${intToWords(whole)} Rupees`;
  if (paise) out += ` and ${belowHundred(paise)} Paise`;
  return out + ' only';
}
