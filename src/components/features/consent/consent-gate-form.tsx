"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { LegalDialog, type LegalTab } from "@/components/legal/legal-dialog";

/**
 * 招待経由ユーザー向け 同意ゲートフォーム。
 * - 利用規約 / プライバシー / 特商法 / AI越境移転 の4点同意 (個別チェックボックス、サーバへbody POST)
 * - 18歳以上の事業従事者 表明保証 (5点目)
 * - 同意 → /api/v1/legal/accept (4種user_terms_acceptances記録 + pending_consent transcript昇格)
 * - 拒否 → /api/v1/legal/reject (DELETE文字列タイプ確認 + アカウント削除 + データREDACT)
 */
export function ConsentGateForm() {
  const router = useRouter();
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeTokushoho, setAgreeTokushoho] = useState(false);
  const [agreeAi, setAgreeAi] = useState(false);
  const [agreeAge, setAgreeAge] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [rejectInput, setRejectInput] = useState("");
  // LegalDialog single instance (Wave9: tap反応性根治 + backdrop残留事故防止)
  const [legalDialog, setLegalDialog] = useState<{ open: boolean; tab: LegalTab }>({
    open: false,
    tab: "terms",
  });
  const openLegal = (tab: LegalTab) => setLegalDialog({ open: true, tab });

  const allAgreed = agreeTerms && agreePrivacy && agreeTokushoho && agreeAi && agreeAge;

  async function handleAccept() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/legal/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terms: agreeTerms,
          privacy: agreePrivacy,
          tokushoho: agreeTokushoho,
          ai_cross_border: agreeAi,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error?.message ?? "同意の記録に失敗しました");
        setLoading(false);
        return;
      }
      router.push("/dashboard");
    } catch (e) {
      console.error("[consent] accept failed", e);
      setError("ネットワークエラーが発生しました");
      setLoading(false);
    }
  }

  async function handleReject() {
    if (rejectInput !== "DELETE") {
      setError("削除確認のため、入力欄に「DELETE」と入力してください。");
      return;
    }
    setRejecting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/legal/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error?.message ?? "アカウント削除に失敗しました");
        setRejecting(false);
        return;
      }
      router.push("/?rejected=1");
    } catch (e) {
      console.error("[consent] reject failed", e);
      setError("ネットワークエラーが発生しました");
      setRejecting(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <fieldset className="space-y-3 rounded-md border border-border/60 p-4">
        <legend className="px-1 text-sm font-medium">
          ご同意 (5項目すべて必須)
        </legend>
        <p className="text-xs text-muted-foreground">
          各リンクはモーダルで開きます (ページ遷移しません)。
        </p>

        <button
          type="button"
          onClick={() => openLegal("terms")}
          aria-haspopup="dialog"
          className="inline-flex min-h-[44px] items-center px-1 text-xs text-primary underline underline-offset-4"
        >
          3文書 (利用規約・プライバシー・特商法) をまとめて読む
        </button>

        <div className="flex items-start gap-2 pt-1">
          <Checkbox
            id="cg-terms"
            checked={agreeTerms}
            onCheckedChange={(v) => setAgreeTerms(v === true)}
            aria-describedby="cg-terms-desc"
          />
          <div className="text-sm leading-relaxed" id="cg-terms-desc">
            <button
              type="button"
              onClick={() => openLegal("terms")}
              aria-haspopup="dialog"
              className="inline-flex min-h-[44px] items-center px-1 text-primary underline underline-offset-4"
            >
              利用規約
            </button>
            に
            <Label htmlFor="cg-terms" className="cursor-pointer">同意します</Label>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            id="cg-privacy"
            checked={agreePrivacy}
            onCheckedChange={(v) => setAgreePrivacy(v === true)}
            aria-describedby="cg-privacy-desc"
          />
          <div className="text-sm leading-relaxed" id="cg-privacy-desc">
            <button
              type="button"
              onClick={() => openLegal("privacy")}
              aria-haspopup="dialog"
              className="inline-flex min-h-[44px] items-center px-1 text-primary underline underline-offset-4"
            >
              プライバシーポリシー
            </button>
            に
            <Label htmlFor="cg-privacy" className="cursor-pointer">同意します</Label>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            id="cg-tokushoho"
            checked={agreeTokushoho}
            onCheckedChange={(v) => setAgreeTokushoho(v === true)}
            aria-describedby="cg-tokushoho-desc"
          />
          <div className="text-sm leading-relaxed" id="cg-tokushoho-desc">
            <button
              type="button"
              onClick={() => openLegal("tokushoho")}
              aria-haspopup="dialog"
              className="inline-flex min-h-[44px] items-center px-1 text-primary underline underline-offset-4"
            >
              特定商取引法に基づく表記
            </button>
            の内容を
            <Label htmlFor="cg-tokushoho" className="cursor-pointer">確認しました</Label>
          </div>
        </div>

        <div
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-950"
          role="region"
          aria-label="AI分析・越境移転に関する重要な同意"
        >
          <Checkbox
            id="cg-ai"
            checked={agreeAi}
            onCheckedChange={(v) => setAgreeAi(v === true)}
            aria-describedby="cg-ai-desc"
          />
          {/* shadcn Label の base flex が rich content を縦割り化するので
              plain <label> を使用 (consent 同意文は long-form のため) */}
          <label
            htmlFor="cg-ai"
            id="cg-ai-desc"
            className="block min-w-0 flex-1 cursor-pointer text-xs leading-relaxed text-amber-900 dark:text-amber-200"
          >
            過去のビジネスミーティングのトランスクリプトを<strong>米国Anthropic PBC</strong>のClaude Opus等のAIサービスに送信し、
            スキル・ニーズ等の構造化情報を抽出することに同意します (越境移転・委託先処理を含む)。
          </label>
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            id="cg-age"
            checked={agreeAge}
            onCheckedChange={(v) => setAgreeAge(v === true)}
          />
          <label htmlFor="cg-age" className="block min-w-0 flex-1 cursor-pointer text-sm leading-relaxed">
            私は<strong>18歳以上</strong>であり、本サービスを<strong>事業の用に供する目的</strong>で利用する事業従事者であることを表明します。
          </label>
        </div>

        <Button
          type="button"
          onClick={handleAccept}
          disabled={!allAgreed || loading || rejecting}
          className="w-full"
        >
          {loading ? "記録中..." : "同意してサービスを利用開始"}
        </Button>
      </fieldset>

      {/* 削除セクション (誤クリック防止: 別ブロック + DELETE typed confirmation) */}
      <details className="rounded-md border border-border/60 p-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          同意せずアカウントとデータを完全削除する (取り消し不可)
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            このボタンを押すと、あなたのアカウント、招待時の事前分析データ、過去ミーティングに含まれる
            あなたの発言部分(REDACT処理)、同意履歴(仮名化スナップショットは法令上の保管義務により5年間保持)
            が削除されます。<strong>この操作は取り消せません。</strong>
          </p>
          {!showRejectConfirm ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowRejectConfirm(true)}
              className="text-destructive hover:bg-destructive/10"
            >
              削除手続きを開始
            </Button>
          ) : (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <Label htmlFor="reject-confirm" className="text-xs font-medium">
                削除を確定するには、下記に半角大文字で「DELETE」と入力してください
              </Label>
              <Input
                id="reject-confirm"
                value={rejectInput}
                onChange={(e) => setRejectInput(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
                className="font-mono"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowRejectConfirm(false);
                    setRejectInput("");
                    setError(null);
                  }}
                  disabled={rejecting}
                >
                  キャンセル
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleReject}
                  disabled={rejecting || rejectInput !== "DELETE"}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {rejecting ? "削除中..." : "アカウントとデータを完全削除"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </details>

      {/* シングルインスタンス LegalDialog */}
      <LegalDialog
        open={legalDialog.open}
        onOpenChange={(open) => setLegalDialog((s) => ({ ...s, open }))}
        tab={legalDialog.tab}
        onTabChange={(tab) => setLegalDialog((s) => ({ ...s, tab }))}
      />
    </div>
  );
}
