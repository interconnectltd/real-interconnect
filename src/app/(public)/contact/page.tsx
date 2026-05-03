import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "お問い合わせ",
  robots: { index: true, follow: true },
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-bold">お問い合わせ</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        本サービスに関するご質問・サポート・苦情・個人情報の開示等の請求は、以下の窓口で受け付けています。
      </p>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-semibold">連絡先</h2>
        <ul className="list-disc pl-5 text-sm leading-relaxed">
          <li>
            メール:{" "}
            <a
              href="mailto:interconnectltd3568@gmail.com"
              className="text-primary underline-offset-4 hover:underline"
            >
              interconnectltd3568@gmail.com
            </a>
          </li>
          <li>受付時間: 平日10時〜18時（土日祝・年末年始を除く）</li>
          <li>初回回答SLA: 原則2営業日以内</li>
        </ul>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-semibold">用件別の宛先</h2>
        <ul className="list-disc pl-5 text-sm leading-relaxed">
          <li>
            <strong>サービス利用に関するご質問・トラブル</strong>: 件名に「サポート」と明記してご連絡ください。
          </li>
          <li>
            <strong>個人情報の開示・訂正・削除等の請求</strong>: 件名に「個人情報保護法に基づく開示請求」と明記し、本人確認書類の写し（運転免許証・パスポート・在留カード等）を添付してください。請求受領後、原則2週間以内に処理します。
          </li>
          <li>
            <strong>特定商取引法に基づく代表者氏名・所在地・電話番号の開示請求</strong>: 件名に「特定商取引法に基づく開示請求」と明記してご連絡ください。請求受領後、原則5営業日以内に開示します。
          </li>
          <li>
            <strong>誤投稿・営業秘密の緊急削除請求</strong>: 件名に「緊急削除」と明記し、対象データの特定情報をお送りください。原則2営業日以内に削除に着手します。
          </li>
          <li>
            <strong>被録音者からの請求</strong>: ご自身が参加されたミーティングの日時・参加者・概要等、対象データを特定可能な情報を添えてご連絡ください。
          </li>
          <li>
            <strong>取材・お仕事のご依頼</strong>: 件名に「取材」「業務提携」等を明記してご連絡ください。
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-semibold">関連リンク</h2>
        <ul className="list-disc pl-5 text-sm leading-relaxed">
          <li>
            <a href="/terms" className="text-primary underline-offset-4 hover:underline">
              利用規約
            </a>
          </li>
          <li>
            <a href="/privacy" className="text-primary underline-offset-4 hover:underline">
              プライバシーポリシー
            </a>
          </li>
          <li>
            <a href="/tokushoho" className="text-primary underline-offset-4 hover:underline">
              特定商取引法に基づく表記
            </a>
          </li>
        </ul>
      </section>

      <section className="mt-10 border-t border-border/60 pt-6 text-xs text-muted-foreground">
        <p>
          上記対応にご納得いただけない場合、個人情報保護委員会（電話相談窓口: 03-6457-9849）への申出も可能です。
        </p>
      </section>
    </div>
  );
}
