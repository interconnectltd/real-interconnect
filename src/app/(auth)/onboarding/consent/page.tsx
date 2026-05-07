/**
 * /onboarding/consent
 *
 * Prospect招待経由ユーザーの同意ゲート。auth.admin.inviteUserByEmail で作成された
 * ユーザーは register-form を経由しないため、規約・プライバシー・特商法の
 * 同意ログ (user_terms_acceptances) が無いまま事前分析データにアクセスできてしまう。
 *
 * 本ページは middleware で強制リダイレクトされ、ユーザーが3点同意 + AI分析・越境移転
 * 同意の追加チェックを完了すると、初めて事前分析データが分析パイプラインに乗る。
 *
 * 拒否した場合は reject_prospect_invite RPC でアカウント削除 + データ削除する。
 */
import type { Metadata } from "next";
import { ConsentGateForm } from "@/components/features/consent/consent-gate-form";

export const metadata: Metadata = {
  title: "ご利用に関するご同意",
  robots: { index: false, follow: false },
};

export default function ConsentGatePage() {
  return (
    // mobile py-6 (24px) で Submit が下に押し出されない / desktop py-10 で余裕
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
      <header className="mb-6 space-y-3">
        <h1 className="text-2xl font-bold leading-tight">ご利用に関するご同意</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          INTER CONNECT へようこそ。サービスのご利用にあたり、利用規約・プライバシーポリシー・
          特定商取引法に基づく表記をご確認のうえ、ご同意をお願いします。
        </p>
        {/* 重要警告は text-sm で読ませる (旧 text-xs は12px で削除動線情報なのに小さすぎ) */}
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <strong className="font-bold">過去のミーティングデータについて</strong>: 当社は、あなたが過去に参加した
          ビジネスミーティングのトランスクリプトを保有している場合があります。同意いただくと、
          これらのデータを AI で分析し、あなたのプロフィール (スキル・ニーズ等) を生成します。
          同意いただけない場合、本ページの「同意せず削除」ボタンを押してください。
          アカウントとデータが直ちに削除されます。
        </p>
      </header>
      <ConsentGateForm />
    </div>
  );
}
