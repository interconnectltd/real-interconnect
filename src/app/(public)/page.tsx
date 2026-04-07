import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Users, Brain, Shield, Video, Lock, Zap } from "lucide-react";

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="px-4 py-24 lg:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight lg:text-5xl">
            次の一手は、
            <br />
            <span className="text-primary">まだ出会っていない人が持っている。</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            ミーティングの会話をAIが分析し、あなたのビジネスを前に進める人を見つけます。
            プロフィールの肩書きではなく、実際の言葉から本当の相性を読み解きます。
          </p>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button size="lg" render={<Link href="/register" />}>
              無料で始める
            </Button>
            <Button size="lg" variant="outline" render={<Link href="/login" />}>
              ログイン
            </Button>
          </div>

          {/* 対応ツール */}
          <div className="mt-8 flex items-center justify-center gap-6 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Video className="h-3.5 w-3.5" />
              <span>Zoom</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Video className="h-3.5 w-3.5" />
              <span>Google Meet</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Video className="h-3.5 w-3.5" />
              <span>Teams</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            tl;dv, Notta, Otter のデータも取り込めます
          </p>
        </div>
      </section>

      {/* 仕組み */}
      <section className="border-t bg-muted/30 px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold">仕組み</h2>
          <div className="mt-16 space-y-16">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-12">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                <Brain className="h-8 w-8 text-primary" />
              </div>
              <div className="max-w-lg">
                <h3 className="text-xl font-semibold">会話から読み解く、本当の相性</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">
                  ミーティングの会話をAIが分析し、あなたが求めていることと、相手が提供できることの一致度を可視化します。
                  肩書きだけでは見えない「本当に力になれる人」を見つけます。
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-6 lg:flex-row-reverse lg:items-center lg:gap-12">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent/10">
                <Users className="h-8 w-8 text-accent" />
              </div>
              <div className="max-w-lg lg:text-right">
                <h3 className="text-xl font-semibold">目的ベースの双方向マッチング</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">
                  「事業提携を探している」「経営相談がしたい」「投資先を探している」——
                  あなたの目的と、相手が提供できることの交差点で、お互いにとって価値のある出会いを実現します。
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-12">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                <Shield className="h-8 w-8 text-primary" />
              </div>
              <div className="max-w-lg">
                <h3 className="text-xl font-semibold">招待制で守られた信頼の空間</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">
                  招待コードを持つ方のみが参加できます。あなたのデータは退会時に完全削除。
                  安心してつながりを広げられる環境です。
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 料金 (設計書 1-02, 1-03) */}
      <section className="border-t px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold">料金</h2>
          <div className="mx-auto mt-8 max-w-sm rounded-xl border p-8">
            <div className="space-y-2">
              <p className="text-3xl font-bold">200名まで無料</p>
              <p className="text-muted-foreground">全機能利用可能</p>
            </div>
            <div className="my-6 h-px bg-border" />
            <div className="space-y-2">
              <p className="text-lg font-semibold">201名から月額 ¥30,000</p>
              <p className="text-sm text-muted-foreground">いつでも解約OK / 初月のみ2ヶ月分</p>
            </div>
          </div>

          <div className="mx-auto mt-8 max-w-md space-y-3 text-left text-sm">
            <details className="group">
              <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                200名を超えたらどうなる？
              </summary>
              <p className="mt-1 text-muted-foreground">
                201人目の招待時にプラン選択画面が表示されます。
              </p>
            </details>
            <details className="group">
              <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                途中で200名以下になったら？
              </summary>
              <p className="mt-1 text-muted-foreground">
                次月から無料に戻ります。
              </p>
            </details>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-muted/30 px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold">
            次の出会いが、次のビジネスを動かす
          </h2>
          <p className="mt-3 text-muted-foreground">
            招待コードをお持ちの方は、今すぐ参加できます。
          </p>
          <Button size="lg" className="mt-8" render={<Link href="/register" />}>
            無料で始める
          </Button>
        </div>
      </section>
    </div>
  );
}
