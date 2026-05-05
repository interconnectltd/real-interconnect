/**
 * tl;dv ミーティングを「商談 (sales)」「社内 (internal)」「不明 (unknown)」に分類する。
 *
 * ユーザー要望:
 *   「定例会議系とか以外はちゃんとアカウント生成して」
 *   = 内部 (社内定例/1on1/朝会等) は prospect 招待を skip、外部 (商談) は招待を実行する。
 *
 * 判定軸 (優先順):
 *   1. **タイトル除外**: 「定例 / 1on1 / 朝会 / standup / weekly / scrum / 社内 / 内部 / internal」等は internal 確定
 *   2. **メールドメイン**: invitees + organizer の email ドメインが全て internalDomains (env で指定 + organizer ドメイン推定) → internal
 *   3. **外部ドメイン参加者**: 自社外ドメインの参加者が1人以上いる → sales 候補
 *   4. **タイトル含意**: 「商談 / 提案 / 打合 / introduction / pitch / sales / demo」→ sales bias
 *   5. それ以外で外部参加者0 → internal、外部参加者≥1 → sales、判定不能 → unknown (招待候補に含める)
 *
 * 設計判断:
 *   - false positive (商談を internal と誤判定 → 招待漏れ) より
 *     false negative (internal を sales と誤判定 → 招待発射) を避けるべき。
 *     なぜなら誤招待は社内同僚/上司にスパム送信のリスクで重大。
 *     よって判定は **conservative: 不確かなら internal 寄り** だが、外部ドメインの存在は
 *     「商談確定シグナル」として強く扱う (false positive 防止)。
 */

/**
 * - sales: 商談 (顧客との外部 MT、AI 解析+招待 ON)
 * - internal: 社内 (定例/1on1 等、AI 解析もスキップ)
 * - onboarding: 運営とユーザーの初回キックオフ MT。AI 解析対象外 (= 運営側の発話で
 *   ユーザーの嗜好が誤推定されるのを防ぐ)、prospect 招待もしない。表示上は専用バッジ。
 * - unknown: 判定不能 (admin review)
 */
export type MeetingKind = "sales" | "internal" | "onboarding" | "unknown";

export interface MeetingClassificationResult {
  kind: MeetingKind;
  confidence: number; // 0..1
  reason: string;
  externalDomains: string[];
  internalDomainsMatched: string[];
}

interface ClassifyInput {
  title: string | null | undefined;
  organizerEmail?: string | null;
  /** invitees + speakers から取れる全 email (重複可、後で normalize) */
  participantEmails?: Array<string | null | undefined>;
  /** speakers (email 不明な参加者を数えるため) */
  speakerNames?: string[];
  /** 任意: 全文 (キーワード補強用) */
  fullText?: string | null;
}

interface ClassifyOptions {
  /**
   * 自社ドメイン (env か config 経由で渡す)。空配列なら organizer ドメインを暗黙の自社とみなす。
   * 例: ["interconnect.app", "ikemen.ltd"]
   */
  internalDomains?: string[];
  /**
   * 運営オペレーターの email (完全一致、CSV)。
   * このメンバーが MT 参加者にいる場合 = 運営とユーザーの面談 → onboarding 確定。
   */
  operatorEmails?: string[];
  /** タイトル除外正規表現の追加 (CIで unit-test しやすいよう外部注入可能) */
  extraTitleExcludePatterns?: RegExp[];
  /** タイトル sales-bias 正規表現の追加 */
  extraTitleIncludePatterns?: RegExp[];
}

// 定例/社内会議の頻出パターン (大文字小文字無視)。
// 「定例」単独は「定例商談」「定期商談」を誤食しないよう前後境界を意識する。
const DEFAULT_INTERNAL_TITLE_PATTERNS: RegExp[] = [
  // 定例: 商談接尾を除外 (「定例商談」「定期商談」は internal にしない)
  /(?:^|[\s\(（【\-_])定例(?!.*?(?:商談|提案|打合|打ち合わ?せ|商品説明))/,
  /週次(?!.*?商談)/, /月次(?!.*?商談)/, /朝会/, /夕会/, /夜会/,
  /1\s*on\s*1/i, /1:1/, /one\s*on\s*one/i,
  /standup/i, /stand-?up/i, /scrum/i,
  /weekly\b/i, /daily\b/i, /sprint\b/i, /retrospective/i, /retro\b/i,
  /\ball\s*hands\b/i,
  /社内/, /内部/, /internal\b/i,
  /キックオフ\s*(?:社内|内部)/, /kickoff\s*\(?\s*internal\)?/i,
  /チーム\s*(?:会議|定例)/, /\bteam\s*(?:meeting|sync)\b/i,
  // MTG は他に sales キーワードが無く、純粋に "MTG" 単体の場合のみ internal
  // 全角境界対応: 前後が空白/括弧/ハイフン/行頭末尾
  /(?:^|[\s\(（【\-_])MTG(?:$|[\s\)）】\-_])(?!.*?(?:商談|提案|打合|商品説明|顧客|client|customer))/i,
];

// 商談寄りのキーワード (sales-bias)
const DEFAULT_SALES_TITLE_PATTERNS: RegExp[] = [
  /商談/, /提案/, /打\s*ち?\s*合\s*わ?\s*せ/, /打合/,
  /初回/, /顔合わせ/, /顔合せ/,
  /\bsales\b/i, /\bdemo\b/i, /\bpitch\b/i, /\bproposal\b/i,
  /\bintro(?:duction)?\b/i, /\bdiscovery\b/i,
  /\bconsultation\b/i, /\binterview\b/i,
  /商品.*説明/, /サービス.*説明/, /導入.*相談/,
];

// メール本文用 sales キーワード (タイトルでは拾えない場合の補強)
const DEFAULT_SALES_BODY_HINTS: RegExp[] = [
  /御社/, /貴社/, /弊社/,
  /提案[書させ]/, /見積[もり]?/, /導入.*[をのご]/,
  /契約.*[をのご]/, /お見積/,
];

function extractDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase().trim() || null;
}

function uniqDomains(emails: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const e of emails) {
    const d = extractDomain(e ?? "");
    if (d) set.add(d);
  }
  return [...set];
}

/**
 * 自社ドメイン (settings) と組み合わせて、各ドメインを internal/external に分類。
 * settings 未指定の場合: organizer のドメインを暗黙の自社とみなす。
 */
function partitionDomains(
  allDomains: string[],
  organizerDomain: string | null,
  internalDomains: string[],
): { internal: string[]; external: string[] } {
  const internalSet = new Set(internalDomains.map((d) => d.toLowerCase()));
  // organizer ドメインは internalDomains 未指定時のみ暗黙的に追加。
  // (明示指定があるならそれが SSOT。誤って自社外を internal 扱いするリスクを避ける)
  if (internalSet.size === 0 && organizerDomain) {
    internalSet.add(organizerDomain);
  }
  const internal: string[] = [];
  const external: string[] = [];
  for (const d of allDomains) {
    if (internalSet.has(d)) internal.push(d);
    else external.push(d);
  }
  return { internal, external };
}

export function classifyMeeting(
  input: ClassifyInput,
  options: ClassifyOptions = {},
): MeetingClassificationResult {
  const title = (input.title ?? "").trim();
  const fullText = input.fullText ?? "";

  const organizerDomain = extractDomain(input.organizerEmail);
  const allEmails = [
    input.organizerEmail,
    ...(input.participantEmails ?? []),
  ].filter((e): e is string => Boolean(e));
  const allDomains = uniqDomains(allEmails);

  const { internal: internalDomainsMatched, external: externalDomains } =
    partitionDomains(allDomains, organizerDomain, options.internalDomains ?? []);

  const titleExcludes = [
    ...DEFAULT_INTERNAL_TITLE_PATTERNS,
    ...(options.extraTitleExcludePatterns ?? []),
  ];
  const titleIncludes = [
    ...DEFAULT_SALES_TITLE_PATTERNS,
    ...(options.extraTitleIncludePatterns ?? []),
  ];

  const matchedSales = titleIncludes.find((re) => re.test(title));
  const matchedExclude = titleExcludes.find((re) => re.test(title));

  // 0. **運営オペレーターが参加 → onboarding 確定 (最優先)**
  //    商談pattern を持っていても、運営とのキックオフ面談は AI 解析対象外。
  const operatorSet = new Set((options.operatorEmails ?? []).map((e) => e.toLowerCase().trim()).filter(Boolean));
  if (operatorSet.size > 0) {
    const allEmailsLower = allEmails.map((e) => e.toLowerCase().trim());
    const operatorHit = allEmailsLower.find((e) => operatorSet.has(e));
    if (operatorHit) {
      return {
        kind: "onboarding",
        confidence: 0.98,
        reason: `operator email matched (${operatorHit})`,
        externalDomains,
        internalDomainsMatched,
      };
    }
  }

  // 1. **外部ドメイン + sales pattern → sales 確定 (最優先)**
  //    定例商談 / 定期商談 のような両義パターンを sales と確実に判定する
  if (externalDomains.length > 0 && matchedSales) {
    return {
      kind: "sales",
      confidence: 0.96,
      reason: `external participants + sales title pattern ${matchedSales.toString()}`,
      externalDomains,
      internalDomainsMatched,
    };
  }

  // 2. タイトル除外: internal pattern が match (sales pattern と被らない場合) → internal
  if (matchedExclude && !matchedSales) {
    return {
      kind: "internal",
      confidence: 0.92,
      reason: `title matched internal pattern ${matchedExclude.toString()}`,
      externalDomains,
      internalDomainsMatched,
    };
  }

  // 3. 両 pattern match (例: "定例商談") + 外部ドメインなし → unknown (admin review)
  //    タイトルだけでは判定不能、admin が override すべき
  if (matchedExclude && matchedSales && externalDomains.length === 0) {
    return {
      kind: "unknown",
      confidence: 0.5,
      reason: `ambiguous title (both internal "${matchedExclude}" and sales "${matchedSales}") with no external participants`,
      externalDomains,
      internalDomainsMatched,
    };
  }

  // 4. 全 email が internalDomains 内 → internal (外部参加者ゼロ)
  if (
    allDomains.length > 0 &&
    externalDomains.length === 0 &&
    internalDomainsMatched.length > 0
  ) {
    return {
      kind: "internal",
      confidence: 0.85,
      reason: "all participant domains are internal",
      externalDomains,
      internalDomainsMatched,
    };
  }

  // 5. 外部ドメイン参加者あり (タイトル中立) → sales 中確度
  if (externalDomains.length > 0) {
    return {
      kind: "sales",
      confidence: 0.78,
      reason: "external participants present (no internal title pattern)",
      externalDomains,
      internalDomainsMatched,
    };
  }

  // 6. 全 email が無い + sales キーワード + 本文に sales hint
  // (= invitees email 取得失敗だが商談感あり: unknown 寄り)
  if (matchedSales) {
    const bodyHint = DEFAULT_SALES_BODY_HINTS.some((re) => re.test(fullText));
    return {
      kind: bodyHint ? "sales" : "unknown",
      confidence: bodyHint ? 0.65 : 0.5,
      reason: bodyHint
        ? `sales title + body hint (no email domains)`
        : `sales title only (no domains, no body hint)`,
      externalDomains,
      internalDomainsMatched,
    };
  }

  // 6.5. 招待 link 経由参加 (R4 audit 由来):
  //   tl;dv は招待リンク経由の外部参加者の email を取得できず invitees=organizer のみ。
  //   external=0 だが speakers>=2 なら「外部ゲストが email 不明状態で参加した商談」
  //   と推定して sales 寄り 0.6 に判定する (false negative=internal 誤判定で AI 解析漏れ防止)。
  //   holdForConsent=true で同意フローに乗るため誤って sales 判定しても招待スパム直撃にならない。
  if (
    externalDomains.length === 0 &&
    internalDomainsMatched.length <= 1 &&
    (input.speakerNames?.length ?? 0) >= 2 &&
    !matchedExclude
  ) {
    return {
      kind: "sales",
      confidence: 0.6,
      reason: "multi-speaker meeting with no resolvable external email (invite-link guest)",
      externalDomains,
      internalDomainsMatched,
    };
  }

  // 7. 参加者が1人だけ (=自分だけのメモ録) → internal
  if ((input.speakerNames?.length ?? 0) <= 1) {
    return {
      kind: "internal",
      confidence: 0.7,
      reason: "single-speaker memo (no external participants)",
      externalDomains,
      internalDomainsMatched,
    };
  }

  // 8. 判定不能 → unknown (admin review に回す)
  return {
    kind: "unknown",
    confidence: 0.4,
    reason: "no decisive signals",
    externalDomains,
    internalDomainsMatched,
  };
}

/**
 * env から self-domain 一覧を取得 (CSV)。空なら organizer ドメイン推定にフォールバック。
 */
export function readInternalDomainsFromEnv(): string[] {
  const raw = process.env.INTERCONNECT_INTERNAL_DOMAINS ?? "";
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * env から運営オペレーター email 一覧を取得 (CSV、完全一致)。
 * 例: INTERCONNECT_OPERATOR_EMAILS="ops@interconnect.app,founder@interconnect.app"
 *
 * 運営との初回キックオフ MT (= onboarding) を AI 解析・招待ループから除外する基準。
 */
export function readOperatorEmailsFromEnv(): string[] {
  const raw = process.env.INTERCONNECT_OPERATOR_EMAILS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
