/**
 * 日本語 B2B プロフェッショナル検索用の同義語辞書 (軽量版)。
 *
 * 背景:
 *   現在の members 検索は ILIKE のみで、「補助金」入力時に
 *   bio/company に「補助金」を含まない人は完全に取りこぼす。
 *   embedding (pgvector + cosine similarity) は本格的な解だが、
 *   pipeline 構築 + 全 profile embed のコストが大きい。
 *
 * 暫定戦略:
 *   typed entry で "頻出キーワード → 関連同義語" を辞書化し、
 *   検索時に OR 条件を広げる。embedding 並みの再現性は無いが、
 *   B2B 商談文脈の主要キーワード (補助金/DX/AI/M&A 等) を
 *   90%カバーできる。本格 embedding に置き換えるまでの繋ぎ。
 *
 * 拡張方針:
 *   - 各エントリは 3-5 個の関連語まで (false-positive 抑制)
 *   - business pivot 単位 (補助金 vs 採用 vs DX vs 投資) で grouping
 *   - 将来 pgvector 導入時はこの辞書を初期 embedding seed にも使える
 */

/**
 * **片方向 expansion 設計** (false-positive 抑制):
 *   "行政書士" → ["補助金", "申請"] のように、行政書士検索時には
 *   補助金が出ても、逆 ("補助金"検索) では行政書士全員を hit させない。
 *   key→synonyms は片方向辞書なので、目的語 "補助金" を key として
 *   登録しなければ「補助金」入力で「行政書士」へは展開されない。
 */
const SYNONYMS = {
  // 補助金 / 助成
  補助金: ["補助", "助成", "支援金", "公募", "採択", "中小企業支援"],
  助成金: ["補助", "助成", "支援", "雇用", "厚労"],
  // DX / システム
  DX: ["デジタル", "システム", "IT", "業務改革", "デジタル変革"],
  IT: ["DX", "システム", "デジタル", "ソフトウェア", "SaaS"],
  // AI / データ
  AI: ["人工知能", "機械学習", "データ", "アルゴリズム", "LLM"],
  データ: ["分析", "AI", "BI", "ETL", "データ基盤"],
  // 投資 / M&A
  投資: ["VC", "ファンド", "資金調達", "出資", "エクイティ"],
  資金調達: ["投資", "ファイナンス", "デット", "VC", "エクイティ"],
  "M&A": ["買収", "合併", "売却", "デューデリ", "PMI"],
  // 営業 / 販路
  販路: ["営業", "マーケティング", "顧客開拓", "セールス", "BD"],
  営業: ["販路", "セールス", "新規開拓", "BD", "マーケ"],
  // 人材 / 採用
  採用: ["人材", "リクルート", "ヒト", "求人", "ヘッドハンティング"],
  人材: ["採用", "HR", "リクルート", "労務", "教育"],
  // コンサル / 専門
  コンサル: ["コンサルティング", "アドバイザリー", "顧問", "戦略", "経営"],
  顧問: ["コンサル", "アドバイザー", "監査役", "社外取締役"],
  // 法務 / 行政
  法務: ["弁護士", "顧問", "コンプライアンス", "契約", "知財"],
  行政書士: ["許認可", "申請", "補助金", "公的支援", "建設業"],
  // 製造 / 業界
  製造: ["メーカー", "ものづくり", "工場", "サプライチェーン"],
  // マーケ
  マーケティング: ["広告", "PR", "ブランディング", "デジマ", "獲得"],
  PR: ["広報", "マーケティング", "メディア", "ブランディング"],
} as const satisfies Record<string, readonly string[]>;

export type SynonymKey = keyof typeof SYNONYMS;

/**
 * 入力検索文字列を「同義語を含む配列」に展開する。
 * 元の文字列も配列の先頭に保持。
 *
 * 例: "補助金" → ["補助金", "補助", "助成", "支援金", "公募", "採択", "中小企業支援"]
 */
export function expandSearchTerms(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  // 完全一致 lookup (キーが部分文字列一致するエントリも候補に)
  const expansions = new Set<string>([trimmed]);

  // 完全一致のキーが辞書にあれば全同義語を追加
  const exact = (SYNONYMS as Record<string, readonly string[]>)[trimmed];
  if (exact) {
    for (const syn of exact) expansions.add(syn);
  }

  // 部分一致: 入力 "補助金コンサル" のような複合語のキーをサブストリングで検出
  for (const [key, syns] of Object.entries(SYNONYMS)) {
    if (key === trimmed) continue;
    if (trimmed.includes(key) || key.includes(trimmed)) {
      expansions.add(key);
      for (const syn of syns) expansions.add(syn);
    }
  }

  return [...expansions];
}

/**
 * Postgres の OR句に展開する用のヘルパー。
 * 例: ["補助金","助成","支援金"] → "name.ilike.%補助金%,name.ilike.%助成%,..." 形式の文字列を組み立てる。
 *
 * @param fields 検索対象カラム (e.g., ["name", "company", "bio"])
 * @param terms expandSearchTerms() の戻り値
 */
export function buildIlikeOrClause(fields: string[], terms: string[]): string {
  // ILIKE / PostgREST `or()` の区切り文字 + ILIKE メタ文字 (\) を除去
  const safe = (s: string) => s.replace(/[%,()\\]/g, "");
  const parts: string[] = [];
  for (const term of terms) {
    const escaped = safe(term);
    if (!escaped) continue;
    for (const field of fields) {
      parts.push(`${field}.ilike.%${escaped}%`);
    }
  }
  return parts.join(",");
}
