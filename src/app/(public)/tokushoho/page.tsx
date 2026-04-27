import type { Metadata } from "next";

export const metadata: Metadata = { title: "特定商取引法に基づく表記" };

export default function TokushohoPage() {
  return (
    <div className="mx-auto max-w-prose px-4 py-12">
      <h1 className="text-2xl font-bold">特定商取引法に基づく表記</h1>
      <div className="prose prose-neutral mt-8 max-w-none text-sm leading-relaxed text-muted-foreground">
        <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr className="border-b border-border">
              <th className="whitespace-nowrap py-3 pr-4 text-left align-top font-semibold text-foreground">
                事業者名
              </th>
              <td className="py-3">INTERCONNECT</td>
            </tr>
            <tr className="border-b border-border">
              <th className="whitespace-nowrap py-3 pr-4 text-left align-top font-semibold text-foreground">
                代表者名
              </th>
              <td className="py-3">請求があった場合、遅滞なく開示いたします</td>
            </tr>
            <tr className="border-b border-border">
              <th className="whitespace-nowrap py-3 pr-4 text-left align-top font-semibold text-foreground">
                所在地
              </th>
              <td className="py-3">請求があった場合、遅滞なく開示いたします</td>
            </tr>
            <tr className="border-b border-border">
              <th className="whitespace-nowrap py-3 pr-4 text-left align-top font-semibold text-foreground">
                連絡先
              </th>
              <td className="py-3">
                メール: interconnectltd3568@gmail.com
                <br />
                ※お問い合わせはメールにて承ります
              </td>
            </tr>
            <tr className="border-b border-border">
              <th className="whitespace-nowrap py-3 pr-4 text-left align-top font-semibold text-foreground">
                販売URL
              </th>
              <td className="py-3">https://inter-connect.app</td>
            </tr>
            <tr className="border-b border-border">
              <th className="whitespace-nowrap py-3 pr-4 text-left align-top font-semibold text-foreground">
                販売価格
              </th>
              <td className="py-3">
                サービス内容およびプランにより異なります。各プランの価格はサービス内の料金ページをご確認ください。
                <br />
                表示価格はすべて税込です。
              </td>
            </tr>
            <tr className="border-b border-border">
              <th className="whitespace-nowrap py-3 pr-4 text-left align-top font-semibold text-foreground">
                追加料金
              </th>
              <td className="py-3">
                サービスの利用にあたり、インターネット接続料金等はお客様のご負担となります。
              </td>
            </tr>
            <tr className="border-b border-border">
              <th className="whitespace-nowrap py-3 pr-4 text-left align-top font-semibold text-foreground">
                支払方法
              </th>
              <td className="py-3">クレジットカード決済</td>
            </tr>
            <tr className="border-b border-border">
              <th className="whitespace-nowrap py-3 pr-4 text-left align-top font-semibold text-foreground">
                支払時期
              </th>
              <td className="py-3">
                月額プラン: 契約日に初回決済、以降毎月同日に自動決済
                <br />
                年額プラン: 契約日に一括決済、以降毎年同日に自動決済
              </td>
            </tr>
            <tr className="border-b border-border">
              <th className="whitespace-nowrap py-3 pr-4 text-left align-top font-semibold text-foreground">
                サービス提供時期
              </th>
              <td className="py-3">
                お支払い手続き完了後、直ちにご利用いただけます。
              </td>
            </tr>
            <tr className="border-b border-border">
              <th className="whitespace-nowrap py-3 pr-4 text-left align-top font-semibold text-foreground">
                返品・キャンセル
              </th>
              <td className="py-3">
                デジタルサービスの性質上、お支払い後の返金は原則としてお受けしておりません。
                <br />
                解約はいつでも可能です。解約後は次回更新日まで引き続きサービスをご利用いただけます。
              </td>
            </tr>
            <tr>
              <th className="whitespace-nowrap py-3 pr-4 text-left align-top font-semibold text-foreground">
                動作環境
              </th>
              <td className="py-3">
                最新版のGoogle Chrome、Safari、Firefox、Microsoft
                Edgeを推奨します。
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
