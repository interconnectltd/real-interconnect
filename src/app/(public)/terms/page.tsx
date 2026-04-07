import type { Metadata } from "next";

export const metadata: Metadata = { title: "利用規約" };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-prose px-4 py-12">
      <h1 className="text-2xl font-bold">利用規約</h1>
      <div className="prose prose-neutral mt-8 max-w-none text-sm leading-relaxed text-muted-foreground">
        <p>最終更新日: 2026年4月1日</p>
        <h2 className="mt-6 text-lg font-semibold text-foreground">第1条（サービスの概要）</h2>
        <p>
          INTERCONNECT（以下「本サービス」）は、ビジネスミーティングのトランスクリプトをAIが分析し、
          プロフェッショナル間のマッチングを支援するプラットフォームです。
        </p>
        <h2 className="mt-6 text-lg font-semibold text-foreground">第2条（AI分析について）</h2>
        <p>
          本サービスはAI分析を基本機能として提供します。ユーザーのミーティングデータ（トランスクリプト）を
          解析し、スキル、ニーズ、コミュニケーション特性等を抽出します。
          この機能は本サービスの中核であり、全ユーザーに適用されます。
        </p>
        <h2 className="mt-6 text-lg font-semibold text-foreground">第3条（退会時のデータ削除）</h2>
        <p>
          退会時には、AI分析に関連する全データ（transcript_insights、member_ai_profiles、matching_scores）
          を完全に削除します。
        </p>
        <h2 className="mt-6 text-lg font-semibold text-foreground">第4条（禁止事項）</h2>
        <p>本サービスの利用にあたり、以下の行為を禁止します。</p>
        <ul className="list-disc pl-5">
          <li>虚偽の情報を登録する行為</li>
          <li>他のユーザーへの迷惑行為・ハラスメント</li>
          <li>本サービスの運営を妨害する行為</li>
          <li>不正なアクセスまたは自動化されたデータ収集</li>
        </ul>
        <h2 className="mt-6 text-lg font-semibold text-foreground">第5条（免責事項）</h2>
        <p>
          AI分析結果はあくまで参考情報であり、マッチングの成否について当社は保証しません。
        </p>
      </div>
    </div>
  );
}
