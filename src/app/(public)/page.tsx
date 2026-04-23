import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Users, Brain, Shield, Zap, MessageSquare, Calendar, Gift } from "lucide-react";

export default function HomePage() {
  return (
    <div>
      {/* Hero — 旧デザイン準拠: ダーク背景 + 都市スカイライン */}
      <section className="relative flex min-h-[100vh] items-center justify-center overflow-hidden">
        {/* 背景動画 */}
        <video
          autoPlay
          muted
          loop
          playsInline
          poster="/img/fv-poster.jpg"
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src="/img/interconnect-bg.mp4" type="video/mp4" />
        </video>
        {/* 暗いオーバーレイ */}
        <div className="absolute inset-0 bg-black/60" />

        {/* コンテンツ */}
        <div className="relative z-10 px-4 text-center text-white">
          <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl lg:text-6xl">
            ビジネスの出会いを、
            <br />
            成果に変える
          </h1>
          <p className="mx-auto mt-6 max-w-lg text-base leading-relaxed text-white/80 md:text-lg">
            AI x コミュニティで、ビジネスの出会いを次のステージへ
          </p>

          {/* ロゴ */}
          <div className="mt-10">
            <Image
              src="/img/hero-logo.png"
              alt="INTER CONNECT"
              width={400}
              height={80}
              className="mx-auto"
              priority
            />
          </div>

          {/* キャンペーンCTA */}
          <div className="mx-auto mt-10 max-w-md rounded-xl border border-white/20 bg-white/10 px-6 py-4 backdrop-blur-sm">
            <p className="text-xs text-white/60">Campaign</p>
            <p className="mt-1 text-sm leading-relaxed text-white/90">
              今なら無料登録で500ポイントプレゼント。3分の登録で、AIがあなたに最適なビジネスパートナーを即座に提案します。
            </p>
          </div>

          {/* CTAボタン */}
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              className="bg-white text-black hover:bg-white/90"
              render={<Link href="/register" />}
            >
              無料で始める
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/30 text-white hover:bg-white/10"
              render={<Link href="/login" />}
            >
              ログイン
            </Button>
          </div>
        </div>
      </section>

      {/* What is INTER CONNECT */}
      <section className="bg-zinc-900 px-4 py-20 text-white">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-blue-400">What is INTER CONNECT</p>
          <h2 className="mt-4 text-2xl font-bold md:text-3xl">
            AIが「会うべき人」を見つけ、
            <br className="hidden md:block" />
            出会いから協業までを一気通貫で支援する
          </h2>
          <p className="mx-auto mt-6 max-w-2xl leading-relaxed text-white/70">
            ミーティングの会話をAIが分析し、あなたが求めていることと
            相手が提供できることの一致度を可視化。
            肩書きだけでは見えない「本当に力になれる人」を見つけます。
          </p>
        </div>
      </section>

      {/* 課題 */}
      <section className="border-t border-zinc-800 bg-zinc-950 px-4 py-20 text-white">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold">
            紹介の質は、紹介者の「記憶」で決まっている
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              { icon: Users, title: "記憶ベースのマッチング", desc: "人の記憶には限界があり、最適な相手を見逃している" },
              { icon: MessageSquare, title: "表面的なプロフィール", desc: "肩書きだけでは、本当のスキルやニーズは見えない" },
              { icon: Calendar, title: "出会いの後が続かない", desc: "名刺交換で終わり、具体的な協業に発展しない" },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <item.icon className="h-8 w-8 text-blue-400" />
                <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4つの強み */}
      <section className="bg-zinc-900 px-4 py-20 text-white">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-sm font-medium uppercase tracking-widest text-blue-400">Core Features</p>
          <h2 className="mt-4 text-center text-2xl font-bold">INTER CONNECT の4つの強み</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {[
              { icon: Brain, num: "01", title: "AIマッチング", desc: "会議の書き起こしをAIが分析。ニーズとオファーの一致度を5次元で可視化し、本当に会うべき人を提案。" },
              { icon: MessageSquare, num: "02", title: "ダイレクトメッセージ", desc: "マッチした相手にすぐコンタクト。招待制コミュニティだから、信頼ベースのやり取りが可能。" },
              { icon: Calendar, num: "03", title: "イベント & ミーティング", desc: "1対1のミーティングからグループイベントまで。出会いの場を自在にデザイン。" },
              { icon: Gift, num: "04", title: "リファラルプログラム", desc: "良い人を紹介するとポイント還元。コミュニティ全体の出会いの質が向上する仕組み。" },
            ].map((item) => (
              <div key={item.num} className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-8">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10">
                    <item.icon className="h-6 w-6 text-blue-400" />
                  </div>
                  <span className="text-3xl font-bold text-blue-500/30">{item.num}</span>
                </div>
                <h3 className="mt-6 text-xl font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-white/60">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 数字で見る */}
      <section className="border-t border-zinc-800 bg-zinc-950 px-4 py-20 text-white">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-bold">数字で見る INTER CONNECT</h2>
          <div className="mt-12 grid grid-cols-2 gap-8 md:grid-cols-4">
            {[
              { num: "200+", label: "登録企業数" },
              { num: "92%", label: "マッチング精度" },
              { num: "78%", label: "協業率" },
              { num: "月4+", label: "イベント開催" },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <p className="text-3xl font-bold text-blue-400 md:text-4xl">{item.num}</p>
                <p className="mt-2 text-sm text-white/60">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 料金 */}
      <section className="bg-zinc-900 px-4 py-20 text-white">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold">料金</h2>
          <div className="mx-auto mt-8 max-w-sm rounded-xl border border-zinc-700 bg-zinc-800/50 p-8">
            <div className="space-y-2">
              <p className="text-3xl font-bold">200名まで無料</p>
              <p className="text-white/60">全機能利用可能</p>
            </div>
            <div className="my-6 h-px bg-zinc-700" />
            <div className="space-y-2">
              <p className="text-lg font-semibold">201名から月額 ¥30,000</p>
              <p className="text-sm text-white/60">いつでも解約OK / 初月のみ2ヶ月分</p>
            </div>
          </div>
        </div>
      </section>

      {/* 最終CTA */}
      <section className="relative overflow-hidden bg-zinc-950 px-4 py-24 text-white">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-900/20 to-transparent" />
        <div className="relative mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold md:text-3xl">
            まだ出会っていないだけの
            <br />
            最適なパートナーが、ここにいる
          </h2>
          <p className="mt-4 text-white/60">
            招待コードをお持ちの方は、今すぐ参加できます。
          </p>
          <Button
            size="lg"
            className="mt-8 bg-white text-black hover:bg-white/90"
            render={<Link href="/register" />}
          >
            無料で始める
          </Button>
        </div>
      </section>
    </div>
  );
}
