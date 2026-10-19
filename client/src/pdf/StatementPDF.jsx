import { Document, Page, View, Text, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import { rupees, formatDate, today } from '@shared/calc.js';

const s = StyleSheet.create({
  page: { fontFamily: 'Tinos', fontSize: 9, paddingTop: 26, paddingBottom: 34, paddingHorizontal: 26 },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 4 },
  bizName: { fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  bizLine: { fontSize: 8.5, marginBottom: 3.2 },
  title: { fontSize: 15, fontWeight: 'bold', textAlign: 'center', marginTop: 8, marginBottom: 12 },
  info: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 12 },
  label: { fontSize: 9, fontWeight: 'bold', marginBottom: 6 },
  line: { fontSize: 9.2, marginBottom: 3.5 },
  th: { flexDirection: 'row', paddingVertical: 6 },
  thText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 9, paddingHorizontal: 4 },
  tr: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.5, borderColor: '#d0d0d0' },
  td: { fontSize: 9, paddingHorizontal: 4 },
  totalRow: { flexDirection: 'row', paddingVertical: 6, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#5f5f5f' },
});

const COLS = [
  { key: 'date', label: 'Date', flex: 1.1, align: 'left' },
  { key: 'type', label: 'Particulars', flex: 2.2, align: 'left' },
  { key: 'ref', label: 'Invoice No.', flex: 0.9, align: 'left' },
  { key: 'debit', label: 'Sale (Dr)', flex: 1.4, align: 'right' },
  { key: 'credit', label: 'Received (Cr)', flex: 1.4, align: 'right' },
  { key: 'balance', label: 'Balance', flex: 1.4, align: 'right' },
];
const cell = (c) => ({ flex: c.flex, textAlign: c.align });

export function StatementDocument({ statement, business }) {
  const theme = business.theme_color || '#9590E0';
  const { party, rows } = statement;
  const period = statement.from || statement.to
    ? `${statement.from ? formatDate(statement.from) : 'Start'} to ${formatDate(statement.to || today())}`
    : `All transactions till ${formatDate(today())}`;

  return (
    <Document title={`Statement - ${party.name}`} author={business.name}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.bizName}>{business.name}</Text>
            {business.address ? <Text style={s.bizLine}>{business.address}</Text> : null}
            {business.phone ? <Text style={s.bizLine}>Phone no.: {business.phone}</Text> : null}
            {business.gstin ? <Text style={s.bizLine}>GSTIN: {business.gstin}</Text> : null}
          </View>
          {business.logo ? <Image style={{ width: 52, height: 52, objectFit: 'contain' }} src={business.logo} /> : null}
        </View>
        <View style={{ borderBottomWidth: 1.2, borderColor: theme }} />
        <Text style={[s.title, { color: theme }]}>Party Statement</Text>

        <View style={s.info}>
          <View style={{ flex: 1.4 }}>
            <Text style={s.label}>Party</Text>
            <Text style={[s.line, { fontWeight: 'bold' }]}>{party.name}</Text>
            {party.billing_address ? <Text style={s.line}>{party.billing_address}</Text> : null}
            {party.phone ? <Text style={s.line}>Contact No.: {party.phone}</Text> : null}
            {party.gstin ? <Text style={s.line}>GSTIN Number: {party.gstin}</Text> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { textAlign: 'right' }]}>Period</Text>
            <Text style={[s.line, { textAlign: 'right' }]}>{period}</Text>
          </View>
        </View>

        <View style={[s.th, { backgroundColor: theme }]} fixed>
          {COLS.map((c) => <Text key={c.key} style={[s.thText, cell(c)]}>{c.label}</Text>)}
        </View>
        <View style={s.tr}>
          <Text style={[s.td, cell(COLS[0])]}>{statement.from ? formatDate(statement.from) : ''}</Text>
          <Text style={[s.td, { flex: COLS[1].flex + COLS[2].flex + COLS[3].flex + COLS[4].flex, fontWeight: 'bold' }]}>Opening Balance</Text>
          <Text style={[s.td, cell(COLS[5]), { fontWeight: 'bold' }]}>{rupees(statement.opening)}</Text>
        </View>
        {rows.map((r, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Text style={[s.td, cell(COLS[0])]}>{formatDate(r.date)}</Text>
            <Text style={[s.td, cell(COLS[1])]}>{r.type}{r.note ? ` - ${r.note}` : ''}</Text>
            <Text style={[s.td, cell(COLS[2])]}>{business.invoice_prefix}{r.ref}</Text>
            <Text style={[s.td, cell(COLS[3])]}>{r.debit ? rupees(r.debit) : ''}</Text>
            <Text style={[s.td, cell(COLS[4])]}>{r.credit ? rupees(r.credit) : ''}</Text>
            <Text style={[s.td, cell(COLS[5])]}>{rupees(r.balance)}</Text>
          </View>
        ))}
        <View style={s.totalRow} wrap={false}>
          <Text style={[s.td, { flex: COLS[0].flex + COLS[1].flex + COLS[2].flex, fontWeight: 'bold' }]}>Total</Text>
          <Text style={[s.td, cell(COLS[3]), { fontWeight: 'bold' }]}>{rupees(statement.total_debit)}</Text>
          <Text style={[s.td, cell(COLS[4]), { fontWeight: 'bold' }]}>{rupees(statement.total_credit)}</Text>
          <Text style={[s.td, cell(COLS[5])]} />
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }} wrap={false}>
          <View style={{ width: '45%', flexDirection: 'row', justifyContent: 'space-between', backgroundColor: theme, padding: 6 }}>
            <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 10 }}>
              {statement.closing >= 0 ? 'Closing Balance (Receivable)' : 'Closing Balance (Advance)'}
            </Text>
            <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 10 }}>{rupees(Math.abs(statement.closing))}</Text>
          </View>
        </View>

        <Text
          style={{ position: 'absolute', bottom: 14, left: 26, right: 26, fontSize: 7.5, color: '#888888', textAlign: 'right' }}
          render={({ pageNumber, totalPages }) => `Generated on ${formatDate(today())}${totalPages > 1 ? ` · Page ${pageNumber} of ${totalPages}` : ''}`}
          fixed
        />
      </Page>
    </Document>
  );
}

export const statementBlob = (statement, business) => pdf(<StatementDocument statement={statement} business={business} />).toBlob();

export const statementFileName = (statement) => `Statement_${statement.party.name.replace(/[^\w]+/g, '_')}_${today()}.pdf`;
