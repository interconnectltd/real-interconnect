import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

Font.register({
  family: "NotoSansJP",
  fonts: [
    { src: "https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFPYk75s.ttf", fontWeight: 700 },
  ],
});

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "NotoSansJP", color: "#1a1a1a" },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 11, color: "#666", marginBottom: 20 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 10, fontWeight: 700, marginBottom: 6, color: "#333", borderBottom: "1 solid #e0e0e0", paddingBottom: 3 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 100, color: "#666" },
  value: { flex: 1 },
  table: { marginTop: 8 },
  tableHeader: { flexDirection: "row", backgroundColor: "#f5f5f5", padding: 6, borderBottom: "1 solid #ccc", fontWeight: 700 },
  tableRow: { flexDirection: "row", padding: 6, borderBottom: "0.5 solid #eee" },
  colDate: { width: 70 },
  colUser: { width: 120 },
  colCompany: { width: 100 },
  colBasis: { width: 70, textAlign: "right" },
  colRate: { width: 40, textAlign: "right" },
  colAmount: { width: 70, textAlign: "right" },
  colStatus: { width: 50 },
  totalRow: { flexDirection: "row", padding: 8, borderTop: "2 solid #333", marginTop: 4 },
  totalLabel: { flex: 1, fontWeight: 700, fontSize: 11 },
  totalValue: { width: 70, textAlign: "right", fontWeight: 700, fontSize: 11 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, textAlign: "center", fontSize: 7, color: "#999" },
});

function formatJpy(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "未確定",
  confirmed: "確定",
  paid: "支払済",
  reversed: "取消",
};

export interface CommissionItem {
  id: string;
  amount_jpy: number;
  rate: number;
  basis_jpy: number;
  status: string;
  created_at: string;
  referred_user: { name: string; company: string | null } | null;
}

export interface StatementData {
  period: string;
  year: number;
  month: number;
  agencyName: string;
  agencyCompany: string | null;
  commissionRate: number;
  rank: string;
  commissions: CommissionItem[];
  totalAmount: number;
  generatedAt: string;
}

export function StatementTemplate({ data }: { data: StatementData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>支払明細書</Text>
        <Text style={styles.subtitle}>{data.year}年{data.month}月分</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>発行者</Text>
          <View style={styles.row}><Text style={styles.label}>会社名</Text><Text style={styles.value}>INTER CONNECT株式会社</Text></View>
          <View style={styles.row}><Text style={styles.label}>所在地</Text><Text style={styles.value}>東京都新宿区西新宿7-5-14 203号</Text></View>
          <View style={styles.row}><Text style={styles.label}>メール</Text><Text style={styles.value}>interconnectltd3568@gmail.com</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>受取人</Text>
          <View style={styles.row}><Text style={styles.label}>氏名</Text><Text style={styles.value}>{data.agencyName}</Text></View>
          {data.agencyCompany && <View style={styles.row}><Text style={styles.label}>会社名</Text><Text style={styles.value}>{data.agencyCompany}</Text></View>}
          <View style={styles.row}><Text style={styles.label}>紹介料率</Text><Text style={styles.value}>{(data.commissionRate * 100).toFixed(0)}%</Text></View>
          <View style={styles.row}><Text style={styles.label}>ランク</Text><Text style={styles.value}>{data.rank}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>明細 ({data.commissions.length}件)</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.colDate}>日付</Text>
              <Text style={styles.colUser}>紹介ユーザー</Text>
              <Text style={styles.colCompany}>会社</Text>
              <Text style={styles.colBasis}>課金額</Text>
              <Text style={styles.colRate}>料率</Text>
              <Text style={styles.colAmount}>報酬額</Text>
              <Text style={styles.colStatus}>状態</Text>
            </View>
            {data.commissions.map((c) => (
              <View style={styles.tableRow} key={c.id}>
                <Text style={styles.colDate}>{formatDate(c.created_at)}</Text>
                <Text style={styles.colUser}>{c.referred_user?.name ?? "—"}</Text>
                <Text style={styles.colCompany}>{c.referred_user?.company ?? "—"}</Text>
                <Text style={styles.colBasis}>{formatJpy(c.basis_jpy)}</Text>
                <Text style={styles.colRate}>{(c.rate * 100).toFixed(0)}%</Text>
                <Text style={styles.colAmount}>{formatJpy(c.amount_jpy)}</Text>
                <Text style={styles.colStatus}>{STATUS_LABEL[c.status] ?? c.status}</Text>
              </View>
            ))}
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>合計</Text>
            <Text style={styles.totalValue}>{formatJpy(data.totalAmount)}</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          発行日: {data.generatedAt} | INTER CONNECT株式会社 | https://inter-connect.app
        </Text>
      </Page>
    </Document>
  );
}
