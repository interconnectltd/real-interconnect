import { TOKUSHOHO_VERSION } from "@/lib/legal/versions";

/**
 * 特定商取引法に基づく表記。
 * /tokushoho ページと利用規約Dialogで共通利用。
 */
export function TokushohoContent() {
  return (
    <article className="prose prose-neutral max-w-none text-sm leading-relaxed text-foreground/90 dark:prose-invert">
      <header className="not-prose mb-6 border-b border-border/60 pb-4">
        <h1 className="text-2xl font-bold text-foreground">特定商取引法に基づく表記</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          バージョン: {TOKUSHOHO_VERSION} / 最終改定日: {TOKUSHOHO_VERSION}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">事業者の名称</th>
              <td className="py-3">INTERCONNECT</td>
            </tr>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">運営形態</th>
              <td className="py-3">個人事業主</td>
            </tr>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">代表者氏名・所在地</th>
              <td className="py-3">
                個人事業主のため、消費者庁ガイドラインに基づき、代表者の氏名及び所在地は請求があった場合、
                遅滞なく開示いたします。
                <br />
                <strong>請求方法</strong>: 下記の連絡先メールアドレス宛に「特定商取引法に基づく開示請求」と
                明記のうえご連絡ください。
                <br />
                <strong>開示期限</strong>: 請求受領後、原則5営業日以内に書面又は電子メールで開示いたします。
              </td>
            </tr>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">連絡先</th>
              <td className="py-3">
                メール: <a href="mailto:interconnectltd3568@gmail.com" className="text-primary underline-offset-4 hover:underline">interconnectltd3568@gmail.com</a>
                <br />
                お問い合わせフォーム: <a href="/contact" className="text-primary underline-offset-4 hover:underline">/contact</a>
                <br />
                受付時間: 平日10時〜18時（土日祝・年末年始を除く）
                <br />
                回答SLA: 原則2営業日以内に初回回答
                <br />
                ※迅速な連絡を希望される場合、メールにてご連絡ください。電話番号についても、請求受領後5営業日以内に書面又は電子メールで開示いたします。
              </td>
            </tr>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">適格請求書発行事業者登録番号</th>
              <td className="py-3">
                適格請求書発行事業者の登録を申請中（取得目標時期: 2026年第3四半期）。登録完了次第、本欄及び発行する請求書に登録番号を掲載します。
                <br />
                登録完了までの間、当社は適格請求書発行事業者ではないため、課税事業者であるユーザーは仕入税額控除（経過措置: 2026年9月30日まで80%控除可、2026年10月1日〜2029年9月30日は50%控除可、2029年10月1日以降は控除不可）について別途ご確認ください。インボイス対応の請求書発行をご希望の場合は事前にお問い合わせください。
              </td>
            </tr>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">販売URL</th>
              <td className="py-3"><a href="https://inter-connect.app" className="text-primary underline-offset-4 hover:underline">https://inter-connect.app</a></td>
            </tr>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">販売価格</th>
              <td className="py-3">
                サービス内容及びプランにより異なります。各プランの価格は本サービス内の料金ページをご確認ください。
                <br />
                表示価格は全て税込です。
              </td>
            </tr>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">商品代金以外の必要料金</th>
              <td className="py-3">
                本サービスの利用にあたり、インターネット接続料金、通信料金、決済手数料等はお客様のご負担となります。
              </td>
            </tr>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">支払方法</th>
              <td className="py-3">クレジットカード決済（Visa、Mastercard、JCB、American Express、Diners Club）</td>
            </tr>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">支払時期</th>
              <td className="py-3">
                月額プラン: 契約日に初回決済、以降毎月同日に自動決済
                <br />
                年額プラン: 契約日に一括決済、以降毎年同日に自動決済
                <br />
                自動更新の少なくとも7日前までに、ユーザー登録メールアドレス宛に更新予定の通知をお送りします。
              </td>
            </tr>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">サービス提供時期</th>
              <td className="py-3">お支払い手続き完了後、直ちにご利用いただけます。</td>
            </tr>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">解約・返金</th>
              <td className="py-3">
                <strong>解約方法</strong>: 本サービス内の「設定」→「サブスクリプション」→「解約」よりいつでも申請可能です。
                <br />
                <strong>解約タイミング</strong>: 月額プランは現契約期間の末日まで利用可能です。年額プランは次回更新日に解約の効力が生じます。
                <br />
                <strong>返金</strong>: デジタルサービスの性質上、お支払い後の返金は原則お受けしておりません（法令の定めによる場合を除く）。年額プランの中途解約による未経過分の返金も行いません。
                <br />
                <strong>クーリング・オフ</strong>: 本サービスは特定商取引法第26条第1項に基づきクーリング・オフの適用対象外です。
              </td>
            </tr>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">不良品・サービスの不具合</th>
              <td className="py-3">
                サービスに重大な不具合が発生した場合、上記連絡先までお問い合わせください。当社の故意又は重過失により提供義務を履行できない場合は、利用規約の定めに従い対応いたします。
              </td>
            </tr>
            <tr className="border-b border-border align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">動作環境</th>
              <td className="py-3">
                <strong>PC</strong>: 最新版のGoogle Chrome、Safari、Firefox、Microsoft Edgeを推奨します。
                <br />
                <strong>モバイル</strong>: 最新版のSafari（iOS）、Chrome（Android）を推奨します。
              </td>
            </tr>
            <tr className="align-top">
              <th className="whitespace-nowrap py-3 pr-4 text-left font-semibold text-foreground">特記事項</th>
              <td className="py-3">
                本サービスは招待制のため、当社が認めた者のみが登録できます。<br />
                AI分析を含む機能の詳細・データ取扱については、利用規約及びプライバシーポリシーをご確認ください。
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer className="not-prose mt-10 border-t border-border/60 pt-4 text-xs text-muted-foreground">
        <p>最終改定日: {TOKUSHOHO_VERSION}</p>
      </footer>
    </article>
  );
}
