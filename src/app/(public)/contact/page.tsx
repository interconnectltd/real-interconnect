import type { Metadata } from "next";
import { ContactForm } from "@/components/features/contact/contact-form";

export const metadata: Metadata = {
  title: "お問い合わせ",
  description:
    "INTER CONNECT へのお問い合わせ・サポート・個人情報の開示請求等を受け付けます。原則 2 営業日以内 / 緊急削除は 4 時間以内にご連絡します。",
  // 法務上 index 義務はなく、bot による mass-spam 起点になりやすいため noindex 化
  // (Wave2 sec audit M-5)
  robots: { index: false, follow: true },
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-bold">お問い合わせ</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        本サービスに関するご質問・サポート・苦情・個人情報の開示等の請求は、以下のフォームで受け付けています。
        フォームが利用できない場合は <a href="mailto:interconnectltd3568@gmail.com" className="text-primary underline-offset-4 hover:underline">interconnectltd3568@gmail.com</a> にメールでもお送りいただけます。
      </p>

      <ContactForm />

      <section className="mt-10 space-y-3 border-t border-border/60 pt-8">
        <h2 className="text-lg font-semibold">対応 SLA</h2>
        <ul className="list-disc pl-5 text-sm leading-relaxed">
          <li>初回回答: 原則 2 営業日以内 (土日祝・年末年始を除く)</li>
          <li>緊急削除: 受領後 4 時間以内に着手</li>
          <li>
            個人情報の開示・利用停止請求: 個情法 33 条「遅滞なく」に基づき、原則
            2 週間以内に初期回答 / 法定上限 30 日以内に対応完了
          </li>
          <li>特商法に基づく開示: 原則 5 営業日以内</li>
        </ul>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-semibold">関連リンク</h2>
        <ul className="list-disc pl-5 text-sm leading-relaxed">
          <li><a href="/terms" className="text-primary underline-offset-4 hover:underline">利用規約</a></li>
          <li><a href="/privacy" className="text-primary underline-offset-4 hover:underline">プライバシーポリシー</a></li>
          <li><a href="/tokushoho" className="text-primary underline-offset-4 hover:underline">特定商取引法に基づく表記</a></li>
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
