import type { Metadata } from "next";

export const metadata: Metadata = { title: "プライバシーポリシー" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-prose px-4 py-12">
      <h1 className="text-2xl font-bold">プライバシーポリシー</h1>
      <div className="prose prose-neutral mt-8 max-w-none text-sm leading-relaxed text-muted-foreground">
        <p>最終更新日: 2026年4月1日</p>
        <h2 className="mt-6 text-lg font-semibold text-foreground">1. 収集する個人情報</h2>
        <p>本サービスでは、以下の個人情報を収集します。</p>
        <ul className="list-disc pl-5">
          <li>氏名、メールアドレス、会社名、役職（登録時）</li>
          <li>ミーティングトランスクリプト（tl;dv連携）</li>
          <li>AI分析結果（スキル、ニーズ、コミュニケーション特性）</li>
        </ul>
        <h2 className="mt-6 text-lg font-semibold text-foreground">2. AI分析の目的と対象</h2>
        <p>
          <strong>目的:</strong> プロフェッショナル間のマッチング精度向上<br />
          <strong>対象:</strong> ミーティングトランスクリプト<br />
          <strong>抽出内容:</strong> スキル、ニーズ、提供可能な価値、コミュニケーション特性<br />
          <strong>公開範囲:</strong> ニーズ情報は非公開。スキル・提供価値のみ他ユーザーに公開。
        </p>
        <h2 className="mt-6 text-lg font-semibold text-foreground">3. データの保存と削除</h2>
        <p>
          退会時には、AI分析に関連する全データを削除します。
          具体的には、transcript_insights、member_ai_profiles、matching_scores の
          当該ユーザーに関するレコードを完全に削除します。
        </p>
        <h2 className="mt-6 text-lg font-semibold text-foreground">3-2. データ保持期間</h2>
        <p>各データは以下の期間保持された後、自動的に削除または無効化されます。</p>
        <div className="overflow-x-auto">
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="pb-2 pr-4 font-semibold text-foreground">データ種別</th>
              <th className="pb-2 pr-4 font-semibold text-foreground">保持期間</th>
              <th className="pb-2 font-semibold text-foreground">処理</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td className="py-2 pr-4">ミーティング文字起こし（全文）</td>
              <td className="py-2 pr-4">分析完了後90日</td>
              <td className="py-2">全文を無効化（null化）</td>
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
              <td className="py-2 pr-4">1年</td>
              <td className="py-2">削除</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">ユーザーシグナル</td>
              <td className="py-2 pr-4">180日</td>
              <td className="py-2">削除</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">その他のユーザーデータ</td>
              <td className="py-2 pr-4">退会時まで</td>
              <td className="py-2">退会時に削除</td>
            </tr>
          </tbody>
        </table>
        </div>
        <h2 className="mt-6 text-lg font-semibold text-foreground">4. 第三者提供</h2>
        <p>法令に基づく場合を除き、個人情報を第三者に提供することはありません。</p>
        <h2 className="mt-6 text-lg font-semibold text-foreground">5. お問い合わせ</h2>
        <p>個人情報の取り扱いに関するお問い合わせは、サービス内のお問い合わせフォームよりご連絡ください。</p>
      </div>
    </div>
  );
}
