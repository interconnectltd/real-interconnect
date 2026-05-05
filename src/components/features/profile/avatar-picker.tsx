"use client";

import { useId, useRef, useState } from "react";
import { Camera, Loader2, Upload, X, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shared/user-avatar";
import {
  AVATAR_PRESETS,
  AVATAR_PRESET_PREFIX,
  isPresetAvatarUrl,
  presetSvgViewBox,
} from "@/lib/avatar-presets";

interface AvatarPickerProps {
  /** 表示用の名前 (preview の initial fallback) */
  name: string | null | undefined;
  /** 現在の avatar_url (`preset:<id>` または http(s) URL または null) */
  current: string | null | undefined;
  /**
   * "image" 選択時に呼ばれる。File を mutation で upload して返した URL を
   * onApply で確定するパターン。upload中の loading は親で持つ。
   */
  onUploadFile: (file: File) => Promise<void>;
  /** プリセット選択時に呼ばれる (preset:<id> 文字列) */
  onSelectPreset: (presetUrl: string) => Promise<void>;
  /** 「画像なし (initial表示)」を選んだ時 (avatar_url=null で更新) */
  onClear: () => Promise<void>;
  /** 親側で upload/save 中ローディングを管理 */
  pending: boolean;
}

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = "image/jpeg,image/png,image/webp,image/gif";

/**
 * AvatarPicker — プリセット 12 + 画像アップロード + 初期 (頭文字) を
 * ひとつの UI で選べるコンポーネント。
 *
 * Profile 編集ページのアバター変更時に <Dialog> 内で使われる想定だが、
 * Sheet/Modal/inline どこでも置けるよう layout 自身は持たない。
 */
export function AvatarPicker({
  name,
  current,
  onUploadFile,
  onSelectPreset,
  onClear,
  pending,
}: AvatarPickerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"preset" | "upload" | "initial">(() => {
    if (isPresetAvatarUrl(current)) return "preset";
    if (current && current.startsWith("http")) return "upload";
    return "initial";
  });
  const uid = useId();
  const tabId = (k: string) => `${uid}-tab-${k}`;
  const panelId = (k: string) => `${uid}-panel-${k}`;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error("画像サイズは5MB以下にしてください");
      return;
    }
    if (!ACCEPTED.split(",").includes(file.type)) {
      toast.error("画像形式は JPEG/PNG/WebP/GIF に対応しています");
      return;
    }
    void onUploadFile(file);
  }

  return (
    <div className="space-y-4">
      {/* 現在のプレビュー */}
      <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/40 p-4">
        <UserAvatar name={name} avatarUrl={current} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">現在のアイコン</p>
          <p className="mt-0.5 text-sm font-medium text-foreground">
            {isPresetAvatarUrl(current)
              ? "プリセット"
              : current
              ? "アップロード画像"
              : `頭文字 (${(name ?? "?").charAt(0).toUpperCase()})`}
          </p>
        </div>
        {current && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onClear()}
            disabled={pending}
            aria-label="アイコンをクリア"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            クリア
          </Button>
        )}
      </div>

      {/* タブ — ARIA APG tabs pattern: 矢印キーで移動、tabIndex roving */}
      <div
        role="tablist"
        aria-label="アイコン選択方法"
        className="inline-flex rounded-lg border border-border bg-muted p-1"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            const order: Array<typeof tab> = ["preset", "upload", "initial"];
            const idx = order.indexOf(tab);
            const next =
              e.key === "ArrowRight"
                ? order[(idx + 1) % order.length]!
                : order[(idx - 1 + order.length) % order.length]!;
            setTab(next);
            document.getElementById(tabId(next))?.focus();
          }
        }}
      >
        {(["preset", "upload", "initial"] as const).map((k) => {
          const label =
            k === "preset" ? "プリセット" : k === "upload" ? "画像アップロード" : "頭文字";
          return (
            <TabBtn
              key={k}
              id={tabId(k)}
              controls={panelId(k)}
              selected={tab === k}
              onClick={() => setTab(k)}
            >
              {label}
            </TabBtn>
          );
        })}
      </div>

      {/* タブパネル */}
      {tab === "preset" && (
        <div role="tabpanel" id={panelId("preset")} aria-labelledby={tabId("preset")}>
          <p className="mb-3 text-xs text-muted-foreground">
            お好きなアイコンを選んでください。背景色とパターンが選べます。
          </p>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {AVATAR_PRESETS.map((p) => {
              const url = `${AVATAR_PRESET_PREFIX}${p.id}`;
              const isCurrent = current === url;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void onSelectPreset(url)}
                  disabled={pending}
                  aria-pressed={isCurrent}
                  aria-label={p.label}
                  className={`group relative inline-flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full transition-all duration-75 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 disabled:opacity-50 ${
                    isCurrent
                      ? "ring-2 ring-accent-strong ring-offset-2 ring-offset-card"
                      : "ring-1 ring-border hover:ring-accent/50"
                  }`}
                  style={{ backgroundColor: p.bgVar, color: p.fgVar }}
                >
                  <svg
                    viewBox={presetSvgViewBox()}
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-full w-full"
                    aria-hidden="true"
                    // SVG paint markup is curated (lib/avatar-presets.ts)
                    dangerouslySetInnerHTML={{ __html: p.paint }}
                  />
                  {isCurrent && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent-strong text-white shadow-md"
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tab === "upload" && (
        <div role="tabpanel" id={panelId("upload")} aria-labelledby={tabId("upload")} className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={handleFile}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={pending}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-10 text-sm text-muted-foreground transition-colors hover:border-accent/50 hover:bg-muted/40 focus-visible:border-accent focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 disabled:opacity-50"
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                アップロード中...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" aria-hidden="true" />
                画像を選択 (JPEG / PNG / WebP / GIF, 最大5MB)
              </>
            )}
          </button>
          <p className="text-xs text-muted-foreground">
            <Camera className="mr-1 inline h-3 w-3" aria-hidden="true" />
            会社の信頼性を高めるためには、ビジネス向きのプロフィール写真を推奨します。
          </p>
        </div>
      )}

      {tab === "initial" && (
        <div role="tabpanel" id={panelId("initial")} aria-labelledby={tabId("initial")} className="space-y-3">
          <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
            <UserAvatar name={name} avatarUrl={null} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {(name ?? "?").charAt(0).toUpperCase()} (頭文字)
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                名前の最初の1文字をアイコンに表示します。シンプルで匿名性が高い選択です。
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="accent"
            onClick={() => void onClear()}
            disabled={pending || !current}
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            頭文字に設定
          </Button>
        </div>
      )}
    </div>
  );
}

function TabBtn({
  id,
  controls,
  selected,
  onClick,
  children,
}: {
  id: string;
  controls: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-controls={controls}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onClick}
      className={`min-h-8 rounded-md px-3.5 text-xs font-medium transition-colors duration-75 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 ${
        selected
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
