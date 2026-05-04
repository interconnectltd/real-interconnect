import { PRIVACY_VERSION } from "@/lib/legal/versions";

/**
 * プライバシーポリシー本文。
 * /privacy ページと利用規約Dialogで共通利用。
 */
export function PrivacyContent() {
  return (
    <article className="prose prose-neutral max-w-none text-sm leading-relaxed text-foreground/90 dark:prose-invert">
      <header className="not-prose mb-6 border-b border-border/60 pb-4">
        <h1 className="text-2xl font-bold text-foreground">プライバシーポリシー</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          バージョン: {PRIVACY_VERSION} / 制定日: 2026年4月1日 / 最終改定日: {PRIVACY_VERSION}
        </p>
      </header>

      <p>
        INTERCONNECT（以下「当社」）は、当社が提供するビジネスマッチングサービス「INTERCONNECT」
        （以下「本サービス」）における個人情報及び個人関連情報の取扱について、個人情報の保護に関する法律
        （以下「個情法」）、電気通信事業法、その他関連法令を遵守し、本プライバシーポリシー（以下「本ポリシー」）に
        従い適切に取り扱います。
      </p>

      <h2 className="mt-6 text-lg font-semibold text-foreground">0. 事業者情報</h2>
      <ul className="list-disc pl-5">
        <li>事業者の名称: INTER CONNECT株式会社</li>
        <li>代表者氏名: 吉井 和樹</li>
        <li>所在地: 請求があった場合、遅滞なく開示いたします。</li>
        <li>個人情報保護管理者: INTER CONNECT株式会社 個人情報保護管理者</li>
        <li>連絡先: <a href="mailto:interconnectltd3568@gmail.com" className="text-primary underline-offset-4 hover:underline">interconnectltd3568@gmail.com</a> ／ <a href="/contact" className="text-primary underline-offset-4 hover:underline">/contact</a></li>
      </ul>
      <p>
        所在地の開示請求は、上記連絡先に「特定商取引法又は個人情報保護法に基づく開示請求」と
        明記してご連絡ください。請求受領後、原則5営業日以内に書面又は電子メールで開示します。
      </p>

      <h2 className="mt-6 text-lg font-semibold text-foreground">適用範囲</h2>
      <p>
        本ポリシーは、日本国内に居住又は所在するユーザーを主たる対象として作成されています。当社は、
        EU・英国・米国カリフォルニア州その他の地域に居住するユーザーへ積極的にサービスを勧誘しておらず、
        当該地域の利用者の行動の継続的・体系的なモニタリングも行っていないため、現時点でGDPR第3条第2項
        及びUK GDPR・CCPAは原則として適用対象外と整理しています。ただし、当該地域からの利用が確認された
        場合、当社はそれぞれの法令に基づく追加の権利（GDPR第15-22条、CCPA第1798.100条乃至第1798.135条等）を
        域外適用される範囲で尊重し、必要に応じてEU代表者を選任します。
      </p>

      <h2 className="mt-6 text-lg font-semibold text-foreground">1. 取得する情報</h2>
      <p>当社は、本サービスの提供にあたり、以下の情報を取得します。</p>
      <ul className="list-disc pl-5">
        <li><strong>登録情報</strong>: 氏名、メールアドレス、会社名、役職、業種、自己紹介。</li>
        <li><strong>認証情報</strong>: パスワード（ハッシュ化）、ログイン履歴、IPアドレス、ユーザーエージェント。</li>
        <li><strong>連携サービスから取得する情報</strong>: tl;dvから取得するミーティングのメタデータ及びトランスクリプト。</li>
        <li><strong>AI分析により生成される情報</strong>: スキル、ニーズ、提供価値、コミュニケーション特性、マッチングスコア、マッチング理由テキスト。</li>
        <li><strong>利用履歴</strong>: アクセスログ、操作履歴、デバイス情報、Cookie・ローカルストレージ情報。</li>
        <li><strong>決済関連情報</strong>: 決済代行事業者経由で取得する取引情報（クレジットカード番号は当社では保持しません）。</li>
        <li><strong>お問い合わせ情報</strong>: 問合せ内容、本人確認のために提供される情報。</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold text-foreground">2. 利用目的</h2>
      <p>当社は、取得した情報を以下の目的で利用します。</p>
      <ol className="list-decimal pl-5">
        <li>本サービスの提供・運営・本人確認・認証。</li>
        <li>AI分析を通じたマッチング候補の抽出・推薦・マッチング理由の生成。</li>
        <li>料金の請求、決済、領収書発行、与信。</li>
        <li>本サービスの機能改善、新機能開発、不具合対応のための統計分析。</li>
        <li>不正利用の検知・防止、利用規約違反への対応。</li>
        <li>お問い合わせへの対応、ユーザーサポート、紛争処理。</li>
        <li>サービス変更・規約改定・キャンペーン等の重要なお知らせの送信（マーケティングメールはユーザーの同意取得後に限ります）。</li>
        <li>法令に基づく対応、捜査機関・裁判所からの法令に基づく請求への対応。</li>
      </ol>

      <h2 className="mt-6 text-lg font-semibold text-foreground">3. AI分析と自動的決定</h2>
      <ol className="list-decimal pl-5">
        <li><strong>処理の概要</strong>: 当社は、Anthropic PBC（米国）の生成AI「Claude Opus」をAPI経由で利用し、ミーティングのトランスクリプトから構造化された情報（スキル・ニーズ・コミュニケーション特性等）を抽出します。</li>
        <li><strong>抽出された情報の利用範囲</strong>: 「ニーズ」情報は本人にのみ表示し、当社内部のマッチング処理目的（候補者推薦の根拠生成等）に限定して利用します。「スキル」「提供価値」のみ他ユーザーに表示します。</li>
        <li><strong>確率的処理であることの注意喚起</strong>: AI分析は確率的処理に基づくため、誤抽出（ハルシネーション）・偏向・最新性の欠如を含みます。当社は分析結果の正確性を保証しません。</li>
        <li><strong>異議申立・人的レビュー請求</strong>: ユーザーは、自己のAI分析結果に対し、当社所定の手続により異議を申立て、人的レビュー・修正・削除を請求することができます。</li>
        <li><strong>学習データへの非利用</strong>: 当社は、ユーザーコンテンツを当社及び委託先のAIモデルの追加学習・微調整に利用しません。Anthropic PBCとの契約上、API入力データは既定でモデル学習に利用されない設定であり、API経由のロギングは原則30日以内に失効すること（Zero Data Retention契約を締結する場合は当該契約の定めによります）を確認しています。</li>
      </ol>

      <h2 className="mt-6 text-lg font-semibold text-foreground">4. 委託先</h2>
      <p>当社は、本サービスの提供のために以下の事業者に個人データの取扱を委託します。</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">委託先一覧</caption>
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 pr-4 text-left font-semibold text-foreground">委託先</th>
              <th className="py-2 pr-4 text-left font-semibold text-foreground">所在国</th>
              <th className="py-2 pr-4 text-left font-semibold text-foreground">委託する業務</th>
              <th className="py-2 text-left font-semibold text-foreground">越境移転の相当措置（個情法第28条第3項）</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td className="py-2 pr-4">Supabase, Inc.</td>
              <td className="py-2 pr-4">米国</td>
              <td className="py-2 pr-4">データベース・認証基盤の提供</td>
              <td className="py-2">同社のData Processing Addendum（DPA）にSCC（標準契約条項）を組み込み、SOC 2 Type II報告書により安全管理措置を確認</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Anthropic PBC</td>
              <td className="py-2 pr-4">米国</td>
              <td className="py-2 pr-4">生成AI（Claude Opus）によるトランスクリプト分析</td>
              <td className="py-2">Anthropic Commercial Terms of Service及びTrust Centerに基づく自主的保護方針への準拠（API入力の非学習・ロギング30日以内）</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">tl;dv, Inc.</td>
              <td className="py-2 pr-4">米国</td>
              <td className="py-2 pr-4">ミーティング録画・トランスクリプト連携</td>
              <td className="py-2">同社プライバシーポリシー及びGDPR/CCPA準拠の自主的保護方針への準拠</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Render Services, Inc.</td>
              <td className="py-2 pr-4">米国</td>
              <td className="py-2 pr-4">バックグラウンドワーカーの実行環境</td>
              <td className="py-2">同社のDPAにSCCを組み込み、AWS基盤上の暗号化保管</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Netlify, Inc.</td>
              <td className="py-2 pr-4">米国</td>
              <td className="py-2 pr-4">Webアプリケーションのホスティング</td>
              <td className="py-2">同社のDPAにSCCを組み込み、AWS基盤上の暗号化保管</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        ユーザーは、個情法施行規則第17条第2項に基づき、越境移転先国における個人情報保護制度・移転先が
        講ずる相当措置の詳細について、第15項の問合せ窓口を通じて書面又は電磁的記録による情報提供を
        請求することができます。
      </p>
      <p className="mt-2">
        当社は個情法第25条に基づき、委託先に対し本ポリシー及び当社が定める安全管理措置と同等以上の措置を
        講ずることを契約上義務付け、定期的に監督します。委託先は、当社の事前承認を得たうえで再委託を行う
        ことができ、再委託先に対しても同等以上の保護義務を契約上義務付けます。
      </p>
      <p className="mt-2">
        当社は、委託先の追加・変更を行う場合、変更日の少なくとも30日前までに本サービス上で告知します。緊急時
        及び軽微な変更については事後告知をもって変更を行うことができます。
      </p>

      <h2 className="mt-6 text-lg font-semibold text-foreground">5. 外国にある第三者への提供（越境移転）</h2>
      <ol className="list-decimal pl-5">
        <li>本サービスは、上記第4項に記載のとおり、ユーザーの個人データを米国に所在する委託先に提供します。これは個情法第28条第1項にいう外国にある第三者への提供に該当します。</li>
        <li>米国は、個情法第28条第1項に基づき個人情報保護委員会が指定する国（EU加盟国・英国）には含まれません。米国における個人情報保護に関する制度の概要は、個人情報保護委員会のウェブサイト「外国における個人情報の保護に関する制度等の調査」をご参照ください。</li>
        <li>当社は、各委託先との間で、個情法第28条第3項及び規則第17条に基づく相当措置（標準契約条項又は事業者の自主的な保護方針への準拠）を講じています。</li>
        <li>ユーザーは、本サービスの利用開始にあたり、本項に基づく米国への越境移転に同意するものとします。当該同意は、ユーザーが本サービスを退会することにより撤回することができます（退会後の取扱は第10項保持期間に従います）。</li>
      </ol>

      <h2 className="mt-6 text-lg font-semibold text-foreground">6. 第三者提供</h2>
      <p>当社は、以下のいずれかに該当する場合を除き、ユーザーの個人データを第三者に提供しません。</p>
      <ul className="list-disc pl-5">
        <li>ユーザーから事前の同意を得た場合。</li>
        <li>法令に基づく場合（捜査機関・裁判所からの開示請求等）。</li>
        <li>人の生命・身体・財産の保護のために必要であって、本人の同意を得ることが困難な場合。</li>
        <li>公衆衛生の向上又は児童の健全な育成の推進のため特に必要があって、本人の同意を得ることが困難な場合。</li>
        <li>合併・会社分割・事業譲渡その他の事由による事業の承継に伴って提供する場合。</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold text-foreground">7. 被録音者（第三者）の個人情報の取扱</h2>
      <ol className="list-decimal pl-5">
        <li>本サービスは、ユーザーが連携サービスを通じて取得するミーティングのトランスクリプトに、ユーザー本人ではない第三者（被録音者）の発言が含まれることを前提とした設計を行います。</li>
        <li>当該トランスクリプトの取得については、ユーザー（個人情報取扱事業者）から委託を受けて当社が処理する関係（個情法第27条第5項第1号の委託）に該当するものとして整理します。ユーザーは、個人情報取扱事業者として、被録音者の個人情報につき自ら取得時通知・利用目的特定・安全管理措置を講ずる責任を負うことを確認します。当社は委託受託者として、本ポリシー及びユーザーが指示する利用目的の範囲を超える二次利用（モデル学習・他ユーザーへの目的外提供等）を行いません。</li>
        <li>ユーザーは、利用規約第12条に基づき、被録音者から事前の同意を取得する義務を負います。</li>
        <li>被録音者を含む第三者からの開示・訂正・削除等の請求は、本ポリシー第13項に定める窓口で受け付けます。</li>
        <li>当社は、被録音者からの請求があった場合、ユーザーに通知のうえ、合理的な期間内に対応します。</li>
      </ol>

      <h2 className="mt-6 text-lg font-semibold text-foreground">8. 要配慮個人情報の取扱</h2>
      <ol className="list-decimal pl-5">
        <li>当社は、要配慮個人情報（個情法第2条第3項に定める病歴・思想信条・犯罪歴等）の取得を意図しません。</li>
        <li>ミーティングのトランスクリプトに要配慮個人情報が混入していると合理的に検知可能な範囲で確認した場合、当社は当該箇所を自動的にマスキング又は削除します。技術的な検知の限界により混入が継続する可能性があり、その場合ユーザーは第15項の窓口を通じて削除を請求することができます。</li>
        <li>ユーザーは、要配慮個人情報を含むことが明らかなミーティングを本サービスに連携してはなりません。</li>
      </ol>

      <h2 className="mt-6 text-lg font-semibold text-foreground">9. 安全管理措置</h2>
      <p>当社は、個人データの漏洩・滅失・毀損の防止その他の安全管理のために以下の措置を講じます。</p>
      <ul className="list-disc pl-5">
        <li><strong>組織的安全管理措置</strong>: 個人データの取扱責任者の設置、取扱記録の整備、定期的な監査。</li>
        <li><strong>人的安全管理措置</strong>: 従業者・委託先従事者への教育、秘密保持義務の賦課及び誓約書の取得。</li>
        <li><strong>物理的安全管理措置</strong>: クラウド事業者のデータセンターにおける物理的アクセス制限。</li>
        <li><strong>技術的安全管理措置</strong>: アクセス権限管理、Supabase Row Level Security（RLS）による行レベルアクセス制御、通信の暗号化（TLS 1.2以上）、保存データの暗号化、定期的な脆弱性検査。</li>
        <li><strong>外的環境の把握</strong>: 米国における個人情報保護に関する制度を把握したうえで委託先を選定し、契約上の保護措置を確保。</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold text-foreground">10. データ保持期間</h2>
      <p>当社は、各データを以下の期間保持し、保持期間経過後は速やかに削除又は無効化します。</p>
      <div className="overflow-x-auto">
        <table className="mt-2 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 pr-4 text-left font-semibold text-foreground">データ種別</th>
              <th className="py-2 pr-4 text-left font-semibold text-foreground">保持期間</th>
              <th className="py-2 text-left font-semibold text-foreground">処理</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td className="py-2 pr-4">ミーティング文字起こし（全文）</td>
              <td className="py-2 pr-4">分析完了後90日</td>
              <td className="py-2">本文を無効化（NULL化）</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">AI分析プロフィール、マッチングスコア、会話ベクトル</td>
              <td className="py-2 pr-4">退会時まで</td>
              <td className="py-2">退会時に削除（再構築可能な派生データのため）</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">ジョブキュー（完了/失敗）</td>
              <td className="py-2 pr-4">30日</td>
              <td className="py-2">削除</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">既読通知</td>
              <td className="py-2 pr-4">90日</td>
              <td className="py-2">削除</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">ログインセッション</td>
              <td className="py-2 pr-4">365日</td>
              <td className="py-2">削除</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">ユーザーシグナル</td>
              <td className="py-2 pr-4">180日</td>
              <td className="py-2">削除</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">監査ログ</td>
              <td className="py-2 pr-4">5年（民法第166条第1項第1号の消滅時効に対応）</td>
              <td className="py-2">削除</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">バックアップ</td>
              <td className="py-2 pr-4">最大35日</td>
              <td className="py-2">自動上書き</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">取引記録（法令上の保管対象）</td>
              <td className="py-2 pr-4">7年</td>
              <td className="py-2">法令所定の方法で保存</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">同意履歴（規約・プライバシー・特商法）</td>
              <td className="py-2 pr-4">退会後5年（民法第166条第1項第1号の消滅時効に対応）</td>
              <td className="py-2">紛争処理のため保持</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="mt-6 text-lg font-semibold text-foreground">11. Cookie・外部送信の取扱（電気通信事業法対応）</h2>
      <ol className="list-decimal pl-5">
        <li>本サービスは、認証セッションの維持・本人識別・利便性向上のためCookie及びローカルストレージを利用します。</li>
        <li>本サービスは、電気通信事業法第27条の12（外部送信規律）に基づき、ユーザーの端末から送信される情報及び送信先について、別途公表する「外部送信ポリシー」において一覧開示するとともに、初回アクセス時に容易に認知可能な方法でユーザーへ通知します。</li>
        <li>EU・英国等のePrivacy指令適用地域からアクセスするユーザーに対しては、当社は事前同意取得方式（Consent Mode）によりCookieの利用同意を取得します。</li>
        <li>ユーザーは、ブラウザ設定又は本サービス内の設定によりCookieの受け入れを拒否することができますが、その場合本サービスの一部機能を利用できないことがあります。</li>
      </ol>

      <h2 className="mt-6 text-lg font-semibold text-foreground">11の2. 仮名加工情報・匿名加工情報</h2>
      <ol className="list-decimal pl-5">
        <li>当社は、サービス改善・統計分析の目的で、個情法第41条に定める仮名加工情報又は同法第43条に定める匿名加工情報を作成することがあります。</li>
        <li>仮名加工情報を作成した場合、当社は同法第41条第6項に基づき、当該仮名加工情報に含まれる個人情報の項目を本ポリシー上で公表します。</li>
        <li>匿名加工情報を作成した場合、当社は同法第43条第3項に基づき、作成した匿名加工情報に含まれる個人に関する情報の項目及び提供方法を本ポリシー上で公表します。</li>
        <li>現時点で当社が作成・第三者提供している仮名加工情報及び匿名加工情報はありません。作成・提供を開始する場合、本ポリシーを更新したうえで実施します。</li>
      </ol>

      <h2 className="mt-6 text-lg font-semibold text-foreground">12. 個人関連情報の取扱</h2>
      <p>
        当社は、個人関連情報（個情法第2条第7項）を第三者に提供する場合において、提供先で個人データとなることが
        想定される場合は、本人の同意が得られていることを確認した上で提供します。
      </p>

      <h2 className="mt-6 text-lg font-semibold text-foreground">13. 開示・訂正・利用停止等の請求（保有個人データに関する請求）</h2>
      <ol className="list-decimal pl-5">
        <li>ユーザー及び被録音者を含む第三者は、当社が保有する自己に関する個人データについて、利用目的の通知・開示・訂正・追加・削除・利用停止・第三者提供記録の開示を請求することができます（個情法第32条乃至第39条）。</li>
        <li>請求方法: 本ポリシー第15項の問合せ窓口にメールでご連絡ください。当社は、請求者の本人確認（運転免許証・パスポート・在留カード等の写しの提示）を行ったうえで、本人確認完了時点から原則として2週間以内に回答します。</li>
        <li>開示方法: 開示請求にあたり、請求者は書面の交付又は電磁的記録の提供（個情法第33条第5項）のいずれかを指定できます。指定がない場合、当社は電磁的記録（PDF等）により提供します。</li>
        <li>手数料: 開示請求及び利用目的の通知請求については、1件あたり1,000円（税込）の手数料をいただきます。それ以外の請求は無料です。</li>
        <li>代理人による請求も受け付けます。代理権を証明する委任状の提示が必要です。</li>
        <li>当社は、請求の内容が個情法所定の例外事由に該当する場合、請求の全部又は一部に応じないことがあり、その理由を通知します。</li>
        <li>同意の撤回: ユーザーは、登録時に取得した同意（越境移転・AI分析・マーケティングメール送信等）について、本サービス内の設定画面又は本ポリシー第15項の窓口を通じて撤回することができます。越境移転同意の撤回はアカウント退会により行うことを原則とし、サービス利用を継続したまま米国委託先による処理のみを停止することは技術構造上現実的でないため、当社が代替手段（手動プロフィール入力モード等）を提供できるかについては窓口で個別協議いたします。マーケティングメール同意の撤回は配信メール内の配信停止リンクから行うことができます。</li>
      </ol>

      <h2 className="mt-6 text-lg font-semibold text-foreground">13の0. 保有個人データに関する事項（個情法第32条第1項各号）</h2>
      <p>
        個情法第32条第1項各号に基づき、本項を独立した公表事項として整理します。
      </p>
      <ul className="list-disc pl-5">
        <li><strong>第1号 個人情報取扱事業者の氏名又は名称・住所・代表者氏名</strong>: 第0項「事業者情報」に記載のとおり(事業者名: INTER CONNECT株式会社、代表者氏名: 吉井 和樹)。所在地は請求があった場合、5営業日以内に開示します。</li>
        <li><strong>第2号 全ての保有個人データの利用目的</strong>: 第2項「利用目的」に記載の8項目。</li>
        <li><strong>第3号 保有個人データの項目</strong>: 第1項「取得する情報」に列挙したとおり（登録情報・認証情報・連携サービスから取得する情報・AI分析により生成される情報・利用履歴・決済関連情報・お問い合わせ情報）。</li>
        <li><strong>第4号 開示等の請求に応じる手続・苦情申出先</strong>: 第13項「開示・訂正・利用停止等の請求」及び第15項「問合せ窓口・苦情処理」に記載のとおり。</li>
        <li><strong>第5号 安全管理のために講じた措置</strong>: 第9項「安全管理措置」に記載のとおり。</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold text-foreground">13の2. データポータビリティ</h2>
      <p>
        ユーザーは、当社所定の手続により、自己の登録情報及びAI分析結果について、機械可読形式（CSV又はJSON）
        による電磁的記録の提供を請求することができます。手数料は前項第4号と同様とします。
      </p>

      <h2 className="mt-6 text-lg font-semibold text-foreground">14. 漏洩等発生時の対応</h2>
      <p>
        当社は、個人データの漏洩・滅失・毀損その他の事態が発生した場合、個情法第26条及び規則第7条に従い、
        個人情報保護委員会への速報・確報及び影響を受ける本人への通知を行います。
      </p>

      <h2 className="mt-6 text-lg font-semibold text-foreground">15. 問合せ窓口・苦情処理</h2>
      <p>個人情報の取扱に関する問合せ及び保有個人データに関する請求は、以下の窓口で受け付けます。</p>
      <ul className="list-disc pl-5">
        <li>個人情報保護管理者: INTERCONNECT 個人情報保護管理者</li>
        <li>連絡先メール: <a href="mailto:interconnectltd3568@gmail.com" className="text-primary underline-offset-4 hover:underline">interconnectltd3568@gmail.com</a></li>
        <li>お問い合わせフォーム: <a href="/contact" className="text-primary underline-offset-4 hover:underline">/contact</a></li>
        <li>受付時間: 平日10時〜18時（土日祝・年末年始を除く）</li>
        <li>回答SLA: 原則として2営業日以内に初回回答、開示等請求は2週間以内に処理。</li>
      </ul>
      <p>
        上記対応にご納得いただけない場合、個人情報保護委員会への申出が可能です。
      </p>
      <ul className="list-disc pl-5">
        <li>個人情報保護委員会 電話相談窓口: 03-6457-9849</li>
      </ul>

      <h2 className="mt-6 text-lg font-semibold text-foreground">16. 18歳未満の取扱</h2>
      <p>
        本サービスは18歳以上の事業従事者を対象とします。当社は、18歳未満の方の個人情報を意図的に取得しません。
        18歳未満であることが判明した場合、当社は速やかに当該情報を削除します。
      </p>

      <h2 className="mt-6 text-lg font-semibold text-foreground">17. 本ポリシーの変更</h2>
      <p>
        当社は、法令の改正・サービス内容の変更等に伴い、本ポリシーを変更することがあります。重要な変更を行う
        場合、当社は変更の効力発生日の少なくとも30日前までに、本サービス上の掲示又はメールにより周知します。
      </p>

      <footer className="not-prose mt-10 border-t border-border/60 pt-4 text-xs text-muted-foreground">
        <p>制定日: 2026年4月1日</p>
        <p>最終改定日: {PRIVACY_VERSION}</p>
        <p className="mt-2">事業者: INTERCONNECT</p>
      </footer>
    </article>
  );
}
