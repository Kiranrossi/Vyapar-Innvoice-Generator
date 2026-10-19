import { Document, Page, View, Text, Image, StyleSheet, Font, pdf } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { calcInvoice, calcLine, rupees, money, formatDate, amountInWords } from '@shared/calc.js';

// Tinos is metric-compatible with Times New Roman (what Vyapar prints with) and has the ₹ glyph.
export function registerFonts(base = '') {
  Font.register({
    family: 'Tinos',
    fonts: [
      { src: `${base}/fonts/Tinos-Regular.ttf` },
      { src: `${base}/fonts/Tinos-Bold.ttf`, fontWeight: 'bold' },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
}

const INK = '#000000';
const RULE = '#5f5f5f';

// Column widths follow the Vyapar layout. The discount column only appears
// when at least one item has a discount, like Vyapar.
function columns(withDiscount) {
  return [
    { key: 'sno', label: '#', flex: 0.42, align: 'left' },
    { key: 'name', label: 'Item Name', flex: withDiscount ? 2.2 : 2.7, align: 'left' },
    { key: 'hsn', label: 'HSN/ SAC', flex: 1.12, align: 'left' },
    { key: 'qty', label: 'Quantity', flex: withDiscount ? 1.0 : 1.25, align: 'center' },
    { key: 'unit', label: 'Unit', flex: 0.8, align: 'right' },
    { key: 'price', label: 'Price/ Unit', flex: 1.45, align: 'right' },
    ...(withDiscount ? [{ key: 'discount', label: 'Discount', flex: 1.2, align: 'right' }] : []),
    { key: 'gst', label: 'GST', flex: 1.12, align: 'right' },
    { key: 'amount', label: 'Amount', flex: 1.18, align: 'right' },
  ];
}

const s = StyleSheet.create({
  page: { fontFamily: 'Tinos', fontSize: 9, color: INK, paddingTop: 26, paddingBottom: 30, paddingHorizontal: 26 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 4, paddingBottom: 4 },
  bizName: { fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  bizLine: { fontSize: 8.5, marginBottom: 3.2 },
  logo: { width: 52, height: 52, objectFit: 'contain' },
  title: { fontSize: 15, fontWeight: 'bold', textAlign: 'center', marginTop: 8, marginBottom: 14 },
  parties: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 12 },
  label: { fontSize: 9, fontWeight: 'bold', marginBottom: 9 },
  billName: { fontSize: 9.5, fontWeight: 'bold', marginBottom: 7 },
  line: { fontSize: 9.2, marginBottom: 6, lineHeight: 1.25 },
  rightLine: { fontSize: 9.2, marginBottom: 3.5, textAlign: 'right' },
  th: { flexDirection: 'row', paddingVertical: 6 },
  thText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 9.2, paddingHorizontal: 4 },
  tr: { flexDirection: 'row', paddingVertical: 6, alignItems: 'center' },
  td: { fontSize: 9.2, paddingHorizontal: 4 },
  totalRow: { flexDirection: 'row', paddingVertical: 6, borderTopWidth: 1, borderBottomWidth: 1, borderColor: RULE },
  bottom: { flexDirection: 'row', marginTop: 12 },
  left: { flex: 1, paddingLeft: 4, paddingRight: 16 },
  right: { flex: 1 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4.5, paddingHorizontal: 3 },
  sumText: { fontSize: 9.2 },
  bankLine: { fontSize: 9.2, marginBottom: 3 },
  sign: { alignItems: 'center', marginTop: 14 },
  signImg: { height: 38, maxWidth: 140, objectFit: 'contain', marginVertical: 6 },
});

const cell = (col) => ({ flex: col.flex, textAlign: col.align });

const hasBank = (b) => Boolean(b.bank_name || b.bank_account || b.bank_ifsc || b.bank_holder);

// Everything paid so far: at billing plus later payments.
const paidOf = (invoice) => invoice.paid ?? invoice.received;

export function InvoiceDocument({ invoice, business, upiQr }) {
  const theme = business.theme_color || '#9590E0';
  const totals = calcInvoice(invoice.items, {
    businessState: business.state,
    placeOfSupply: invoice.place_of_supply,
    inter: invoice.is_inter === undefined ? undefined : Boolean(invoice.is_inter),
    received: paidOf(invoice),
    roundOff: Boolean(invoice.round_off_on),
  });
  const withDiscount = invoice.items.some((i) => Number(i.discount_pct) > 0);
  const COLS = columns(withDiscount);
  const col = (key) => cell(COLS.find((c) => c.key === key));
  const invoiceNo = `${business.invoice_prefix || ''}${invoice.invoice_no}`;
  const descLines = (invoice.description || '').split('\n').filter(Boolean);
  const addressLines = (invoice.party_address || '').split('\n').filter(Boolean);
  const qtyText = Number.isInteger(totals.qty) ? totals.qty : totals.qty.toFixed(2);
  const linesTotal = totals.total - totals.roundOff;

  return (
    <Document title={`Invoice ${invoiceNo} - ${invoice.party_name}`} author={business.name}>
      <Page size="A4" style={s.page}>
        {/* Business header */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.bizName}>{business.name || 'Your Business Name'}</Text>
            {business.address ? <Text style={s.bizLine}>{business.address}</Text> : null}
            {business.phone ? <Text style={s.bizLine}>Phone no.: {business.phone}</Text> : null}
            {business.email ? <Text style={s.bizLine}>Email: {business.email}</Text> : null}
            {business.gstin ? <Text style={s.bizLine}>GSTIN: {business.gstin}</Text> : null}
            {business.state ? <Text style={s.bizLine}>State: {business.state}</Text> : null}
          </View>
          {business.logo ? <Image style={s.logo} src={business.logo} /> : null}
        </View>
        <View style={{ borderBottomWidth: 1.2, borderColor: theme }} />

        <Text style={[s.title, { color: theme }]}>Tax Invoice</Text>

        {/* Bill to / invoice details */}
        <View style={s.parties}>
          <View style={{ flex: 1.4, paddingRight: 20 }}>
            <Text style={s.label}>Bill To</Text>
            <Text style={s.billName}>{invoice.party_name}</Text>
            {addressLines.length ? <Text style={s.line}>{addressLines.join('\n')}</Text> : null}
            {invoice.party_phone ? <Text style={s.line}>Contact No.: {invoice.party_phone}</Text> : null}
            {invoice.party_gstin ? <Text style={s.line}>GSTIN Number: {invoice.party_gstin}</Text> : null}
            {invoice.party_state ? <Text style={s.line}>State: {invoice.party_state}</Text> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { textAlign: 'right' }]}>Invoice Details</Text>
            <Text style={s.rightLine}>Invoice No.: {invoiceNo}</Text>
            <Text style={s.rightLine}>Date: {formatDate(invoice.invoice_date)}</Text>
            {invoice.place_of_supply ? <Text style={s.rightLine}>Place of Supply: {invoice.place_of_supply}</Text> : null}
          </View>
        </View>

        {/* Items table */}
        <View style={[s.th, { backgroundColor: theme }]} fixed>
          {COLS.map((c) => (
            <Text key={c.key} style={[s.thText, cell(c)]}>{c.label}</Text>
          ))}
        </View>
        {invoice.items.map((item, i) => {
          const { tax, amount, discount } = calcLine(item);
          return (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={[s.td, col('sno')]}>{i + 1}</Text>
              <Text style={[s.td, col('name'), { fontWeight: 'bold' }]}>{item.name}</Text>
              <Text style={[s.td, col('hsn')]}>{item.hsn}</Text>
              <Text style={[s.td, col('qty')]}>{item.qty}</Text>
              <Text style={[s.td, col('unit')]}>{item.unit}</Text>
              <Text style={[s.td, col('price')]}>{rupees(item.price)}</Text>
              {withDiscount ? (
                <Text style={[s.td, col('discount')]}>
                  {rupees(discount)}
                  {'\n'}({Number(item.discount_pct || 0).toFixed(1)}%)
                </Text>
              ) : null}
              <Text style={[s.td, col('gst')]}>
                {rupees(tax)}
                {'\n'}({Number(item.gst_rate || 0).toFixed(1)}%)
              </Text>
              <Text style={[s.td, col('amount')]}>{rupees(amount)}</Text>
            </View>
          );
        })}
        <View style={s.totalRow} wrap={false}>
          {COLS.map((c) => {
            const bold = { fontWeight: 'bold' };
            const value = {
              name: 'Total',
              qty: qtyText,
              discount: rupees(totals.discount),
              gst: rupees(totals.tax),
              amount: rupees(linesTotal),
            }[c.key];
            return <Text key={c.key} style={[s.td, cell(c), bold]}>{value ?? ''}</Text>;
          })}
        </View>

        {/* Description, words, bank, terms | totals, signature */}
        <View style={s.bottom} wrap={false}>
          <View style={s.left}>
            {descLines.length ? (
              <View style={{ marginBottom: 8 }}>
                <Text style={s.label}>Description</Text>
                <Text style={s.sumText}>{descLines.join('\n')}</Text>
              </View>
            ) : null}
            <Text style={s.label}>Invoice Amount In Words</Text>
            <Text style={[s.sumText, { marginBottom: 14 }]}>{amountInWords(totals.total)}</Text>

            {hasBank(business) || upiQr ? (
              <View style={{ marginBottom: 12 }}>
                <Text style={s.label}>Pay To:</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {upiQr ? (
                    <View style={{ alignItems: 'center' }}>
                      <Image src={upiQr} style={{ width: 64, height: 64 }} />
                      <Text style={{ fontSize: 7 }}>Scan to pay (UPI)</Text>
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }}>
                    {business.bank_name ? <Text style={s.bankLine}>Bank Name : {business.bank_name}</Text> : null}
                    {business.bank_account ? <Text style={s.bankLine}>Bank Account No. : {business.bank_account}</Text> : null}
                    {business.bank_ifsc ? <Text style={s.bankLine}>Bank IFSC code : {business.bank_ifsc}</Text> : null}
                    {business.bank_holder ? <Text style={s.bankLine}>Account holder's name : {business.bank_holder}</Text> : null}
                    {business.upi_id ? <Text style={s.bankLine}>UPI ID : {business.upi_id}</Text> : null}
                  </View>
                </View>
              </View>
            ) : null}

            {invoice.vehicle_no || invoice.transporter ? (
              <View style={{ marginBottom: 12 }}>
                <Text style={s.label}>Transportation Details</Text>
                {invoice.vehicle_no ? <Text style={s.bankLine}>Vehicle No. : {invoice.vehicle_no}</Text> : null}
                {invoice.transporter ? <Text style={s.bankLine}>Transporter : {invoice.transporter}</Text> : null}
              </View>
            ) : null}

            {business.terms ? (
              <>
                <Text style={s.label}>Terms And Conditions</Text>
                <Text style={s.sumText}>{business.terms}</Text>
              </>
            ) : null}
          </View>

          <View style={s.right}>
            <View style={s.sumRow}>
              <Text style={s.sumText}>Sub Total</Text>
              <Text style={s.sumText}>{rupees(totals.subtotal)}</Text>
            </View>
            {totals.taxRows.map((r) => (
              <View key={r.label} style={s.sumRow}>
                <Text style={s.sumText}>{r.label}</Text>
                <Text style={s.sumText}>{rupees(r.amount)}</Text>
              </View>
            ))}
            {totals.roundOff ? (
              <View style={s.sumRow}>
                <Text style={s.sumText}>Round off</Text>
                <Text style={s.sumText}>{totals.roundOff < 0 ? '- ' : '+ '}{rupees(Math.abs(totals.roundOff))}</Text>
              </View>
            ) : null}
            <View style={[s.sumRow, { backgroundColor: theme }]}>
              <Text style={[s.sumText, { color: '#FFFFFF', fontWeight: 'bold' }]}>Total</Text>
              <Text style={[s.sumText, { color: '#FFFFFF', fontWeight: 'bold' }]}>{rupees(totals.total)}</Text>
            </View>
            <View style={s.sumRow}>
              <Text style={s.sumText}>Received</Text>
              <Text style={s.sumText}>{rupees(totals.received)}</Text>
            </View>
            <View style={[s.sumRow, { borderBottomWidth: 1.5, borderColor: '#888888' }]}>
              <Text style={s.sumText}>Balance</Text>
              <Text style={s.sumText}>{rupees(totals.balance)}</Text>
            </View>

            <View style={s.sign}>
              <Text style={s.sumText}>For: {business.name}</Text>
              {business.signature ? <Image style={s.signImg} src={business.signature} /> : <View style={{ height: 46 }} />}
              <Text style={[s.sumText, { fontWeight: 'bold' }]}>Authorized Signatory</Text>
            </View>
          </View>
        </View>

        <Text
          style={{ position: 'absolute', bottom: 14, right: 26, fontSize: 7.5, color: '#888888' }}
          render={({ pageNumber, totalPages }) => (totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : '')}
          fixed
        />
      </Page>
    </Document>
  );
}

// UPI QR asks for the balance still due, so the customer only has to scan and pay.
export async function upiQrFor(invoice, business) {
  if (!business.upi_id) return null;
  const totals = calcInvoice(invoice.items, {
    businessState: business.state,
    placeOfSupply: invoice.place_of_supply,
    inter: invoice.is_inter === undefined ? undefined : Boolean(invoice.is_inter),
    received: paidOf(invoice),
    roundOff: Boolean(invoice.round_off_on),
  });
  const params = new URLSearchParams({ pa: business.upi_id, pn: business.name || '', cu: 'INR', tn: `Invoice ${business.invoice_prefix || ''}${invoice.invoice_no}` });
  if (totals.balance > 0) params.set('am', totals.balance.toFixed(2));
  return QRCode.toDataURL(`upi://pay?${params}`, { margin: 1, width: 240 });
}

export const invoiceFileName = (invoice, business) =>
  `Invoice_${business.invoice_prefix || ''}${invoice.invoice_no}_${(invoice.party_name || '').replace(/[^\w]+/g, '_')}.pdf`;

export async function invoiceBlob(invoice, business) {
  const upiQr = await upiQrFor(invoice, business);
  return pdf(<InvoiceDocument invoice={invoice} business={business} upiQr={upiQr} />).toBlob();
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function downloadInvoice(invoice, business) {
  saveBlob(await invoiceBlob(invoice, business), invoiceFileName(invoice, business));
}

export const shareMessage = (invoice, business) => {
  const balance = invoice.balance ?? 0;
  return [
    `Dear ${invoice.party_name},`,
    `Please find invoice No. ${business.invoice_prefix || ''}${invoice.invoice_no} dated ${formatDate(invoice.invoice_date)} for ₹ ${money(invoice.total)}.`,
    balance > 0 ? `Balance due: ₹ ${money(balance)}.` : 'Fully paid. Thank you!',
    business.upi_id ? `Pay by UPI: ${business.upi_id}` : '',
    '',
    `Thank you,`,
    business.name,
    business.phone ? business.phone : '',
  ].filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== '')).join('\n');
};
