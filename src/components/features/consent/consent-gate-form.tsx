"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
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
 *
 * Wave10 modile fix:
 *   旧設計は `<div flex items-start>` 内で `<Checkbox size-4>` と `<button min-h-[44px]>` を inline 混在で
 *   並べていたため、行高 44px の中で Checkbox center 8px と button center 22px が 14px 縦ずれする計算上必発の事故。
 *   → register-form と同一の「規約 button を別行 + 下に Checkbox + Label」パターンに統一。
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
        <div
          role="alert"
          className="scroll-mt-20 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <fieldset className="space-y-5 rounded-md border border-border/60 p-4">
        {/* legend は bg-card で fieldset border の真上を切り抜き、可読性を確保 */}
        <legend className="rounded-sm bg-card px-2 text-sm font-medium">
          ご同意 (5項目すべて必須)
        </legend>
        <p className="text-xs text-muted-foreground">
          各リンクはモーダルで開きます (ページ遷移しません)。
        </p>

        {/* 旧文言「3文書 (利用規約・プライバシー・特商法) をまとめて読む」は 320px viewport で
            fieldset 内幅 256px に対して 350px overflow してた → 短縮 */}
        <button
          type="button"
          onClick={() => openLegal("terms")}
          aria-haspopup="dialog"
          className="inline-flex min-h-[44px] items-center px-1 text-sm font-medium text-primary underline underline-offset-4"
        >
          3文書をまとめて読む
        </button>

        {/* === 1. 利用規約 === */}
        <ConsentBlock>
          <button
            type="button"
            onClick={() => openLegal("terms")}
            aria-haspopup="dialog"
            className="inline-flex min-h-[44px] items-center px-1 font-medium text-primary underline underline-offset-4"
          >
            利用規約を読む
          </button>
          <CheckboxRow
            id="cg-terms"
            checked={agreeTerms}
            onChange={setAgreeTerms}
            label="上記内容に同意します"
          />
        </ConsentBlock>

        {/* === 2. プライバシーポリシー === */}
        <ConsentBlock>
          <button
            type="button"
            onClick={() => openLegal("privacy")}
            aria-haspopup="dialog"
            className="inline-flex min-h-[44px] items-center px-1 font-medium text-primary underline underline-offset-4"
          >
            プライバシーポリシーを読む
          </button>
          <CheckboxRow
            id="cg-privacy"
            checked={agreePrivacy}
            onChange={setAgreePrivacy}
            label="上記内容に同意します"
          />
        </ConsentBlock>

        {/* === 3. 特定商取引法 === */}
        <ConsentBlock>
          <button
            type="button"
            onClick={() => openLegal("tokushoho")}
            aria-haspopup="dialog"
            className="inline-flex min-h-[44px] items-center px-1 font-medium text-primary underline underline-offset-4"
          >
            特定商取引法に基づく表記を読む
          </button>
          <CheckboxRow
            id="cg-tokushoho"
            checked={agreeTokushoho}
            onChange={setAgreeTokushoho}
            label="内容を確認しました"
          />
        </ConsentBlock>

        {/* === 4. AI 越境移転 (重要警告) === */}
        <div
          className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950"
          role="region"
          aria-label="AI分析・越境移転に関する重要な同意"
        >
          <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
            過去のビジネスミーティングのトランスクリプトを
            <strong className="font-bold">米国 Anthropic PBC</strong>
            の Claude Opus 等の AI サービスに送信し、スキル・ニーズ等の構造化情報を抽出します
            (越境移転・委託先処理を含む)。
          </p>
          <CheckboxRow
            id="cg-ai"
            checked={agreeAi}
            onChange={setAgreeAi}
            label="上記内容に同意します"
            tone="amber"
          />
        </div>

        {/* === 5. 18歳以上 + 事業従事者 表明保証 === */}
        <CheckboxRow
          id="cg-age"
          checked={agreeAge}
          onChange={setAgreeAge}
          label={
            <>
              私は<strong className="font-bold">18歳以上</strong>であり、本サービスを
              <strong className="font-bold">事業の用に供する目的</strong>
              で利用する事業従事者であることを表明します
            </>
          }
        />

        <Button
          type="button"
          onClick={handleAccept}
          disabled={!allAgreed || loading || rejecting}
          aria-busy={loading}
          className="w-full"
        >
          {loading ? "記録中..." : "同意してサービスを利用開始"}
        </Button>
      </fieldset>

      {/* 削除セクション (誤クリック防止: 別ブロック + DELETE typed confirmation)
          [&::-webkit-details-marker]:hidden + [&::marker]:hidden で native marker (▼) を撤廃し
          Chrome/Safari で見た目を統一 */}
      <details className="group rounded-md border border-border/60 [&::-webkit-details-marker]:hidden">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span>同意せずアカウントとデータを完全削除する (取り消し不可)</span>
          <ChevronDown
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="space-y-3 px-3 pb-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            このボタンを押すと、あなたのアカウント、招待時の事前分析データ、過去ミーティングに含まれる
            あなたの発言部分(REDACT処理)、同意履歴(仮名化スナップショットは法令上の保管義務により5年間保持)
            が削除されます。
            <strong className="font-semibold text-foreground">この操作は取り消せません。</strong>
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
            <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
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
              {/* mobile では Cancel/削除を縦並び (button 文字長で wrap して col 揃わない事故防止) */}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
                  aria-busy={rejecting}
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

/* ───────── Subcomponents ───────── */

function ConsentBlock({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1">{children}</div>;
}

/**
 * Checkbox + Label を **第1行 text center で揃える**コア row。
 *
 * 計算根拠:
 *   - Checkbox: size-4 = 16px、mt-0.5 (2px) で center y = 10
 *   - Label: text-sm (14px) × leading-snug (1.375) = 19.25px line-height
 *     第1行 center y = 9.625
 *   → 0.4px 以内で完全一致 (人間目で判別不能)
 *
 * 旧実装は items-center で min-h-[44px] と組合せたため、
 * multi-line label (18+ 等) で row 高 = max(content, 44) になり、
 * Checkbox center が「行全体中央」と「label 第1行中央」で最大 10px ずれる致命バグだった。
 *
 * 設計:
 *   - `<label>` で全体 wrap → row 全幅クリック可能 (htmlFor で native checkbox 連動)
 *   - `flex items-start` + Checkbox `mt-0.5` で第1行と完全揃え
 *   - py-2 padding で AAA 44px hit area を保証 (min-h は撤廃、padding ベース)
 *   - hover/active で背景色微変 → タップフィードバック視認性
 *   - 内部 leading-snug 統一 (relaxed だと縦詰まりすぎ vs 行間広すぎの中庸)
 */
function CheckboxRow({
  id,
  checked,
  onChange,
  label,
  tone,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  tone?: "amber";
}) {
  return (
    <label
      htmlFor={id}
      className={
        tone === "amber"
          ? "flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-amber-200/40 active:bg-amber-200/60 dark:hover:bg-amber-800/40 dark:active:bg-amber-800/60"
          : "flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50 active:bg-muted"
      }
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5 shrink-0"
      />
      <span
        className={
          tone === "amber"
            ? "min-w-0 flex-1 text-sm font-medium leading-snug text-amber-900 dark:text-amber-100"
            : "min-w-0 flex-1 text-sm font-medium leading-snug text-foreground"
        }
      >
        {label}
      </span>
    </label>
  );
}
