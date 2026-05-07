"use client";

import { useEffect, useRef, useState } from "react";
import {
  Pencil,
  Camera,
  Loader2,
  Mail,
  Building2,
  Briefcase,
  ChevronDown,
  X,
  AtSign,
  Lock,
  Image as ImageIcon,
  Target,
  Gift,
  ShieldCheck,
  Link2,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import dynamic from "next/dynamic";

// AvatarPicker (12 SVG プリセット + Canvas resize lib) を遅延 import。
// pickerOpen=true 初回のみロード → 編集していないユーザーには bundle 載せない
const AvatarPicker = dynamic(
  () =>
    import("@/components/features/profile/avatar-picker").then((m) => ({
      default: m.AvatarPicker,
    })),
  { ssr: false },
);
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useMyProfile } from "@/hooks/queries/use-profile";
import { INDUSTRIES } from "@/lib/constants";
import { useUpdateProfile } from "@/hooks/mutations/use-update-profile";
import { useUploadAvatar } from "@/hooks/mutations/use-upload-avatar";
import { ProfileCompleteness } from "@/components/shared/profile-completeness";
import { UserAvatar } from "@/components/shared/user-avatar";

const labelClass = "text-sm font-medium text-foreground";
// iOS Safari は font-size <16px の input/select/textarea で focus 時に zoom-in する。
// モバイルでは text-base (16px)、sm 以上で text-sm に下げる (Input.tsx と同じ規約)
const selectClass =
  "h-11 w-full rounded-lg border border-input bg-card pl-3 pr-10 py-2 text-base sm:text-sm transition-[box-shadow,border-color] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/70 appearance-none";
const textareaClass =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-base sm:text-sm transition-[box-shadow,border-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/70";

const BIO_MAX = 1000;
const BIO_WARN = 900;
const BIO_DANGER = 990;
/**
 * use-profile-completeness.ts の BIO_TIERS と整合させた 5 段階マーカー。
 * 各 tier 通過時に +4% (合計 20%) 加点される。
 */
const BIO_TIER_THRESHOLDS = [50, 100, 150, 250, 400] as const;

interface ProfileForm {
  name: string;
  company: string;
  position: string;
  industry: string;
  bio: string;
  contact_info: string;
}

export default function ProfilePage() {
  const { data: profile, isLoading } = useMyProfile();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  // 編集開始時の値を凍結 (refetch でズレないよう ref で保持)
  const originalSnapshotRef = useRef<ProfileForm | null>(null);
  const [editing, setEditing] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [form, setForm] = useState<ProfileForm>({
    name: "",
    company: "",
    position: "",
    industry: "",
    bio: "",
    contact_info: "",
  });

  // editing 終了時に snapshot をクリア
  useEffect(() => {
    if (!editing) originalSnapshotRef.current = null;
  }, [editing]);

  /**
   * 完成度カード (profile-completeness.tsx) の missing item をクリック → /profile#profile-name 等に
   * 着地した時、編集モードに切替えて該当 input にスクロール+focus する。
   * profile-avatar の場合のみ pickerOpen を開く。
   * tab query ?tab=basic も同等に受け付ける (basic = name にフォーカス)。
   */
  useEffect(() => {
    if (!profile) return;
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    // profile-completeness.tsx の resolveHref が ?focus=<field> 形式で
    // basic/avatar/bio/contact/sns 等を渡してくる。`name`/`company`/`position`/
    // `industry`/`avatar_url`/`contact_info` の完成度 field key も直接 input id に変換。
    const focus = params.get("focus");
    const focusToId = (f: string | null): string | null => {
      if (!f) return null;
      switch (f) {
        case "basic":
        case "name":
          return "profile-name";
        case "company":
          return "profile-company";
        case "position":
          return "profile-position";
        case "industry":
          return "profile-industry";
        case "avatar":
        case "avatar_url":
          return "profile-avatar";
        case "bio":
          return "profile-bio";
        case "contact":
        case "contact_info":
          return "profile-contact";
        default:
          return null;
      }
    };
    const targetId = (() => {
      if (hash) return hash;
      const fromFocus = focusToId(focus);
      if (fromFocus) return fromFocus;
      const fromTab = focusToId(tab);
      if (fromTab) return fromTab;
      return null;
    })();
    if (!targetId) return;
    if (targetId === "profile-avatar") {
      setPickerOpen(true);
    } else if (!editing) {
      // 編集 UI に input が描画されていないと focus できないため editing=true にする
      const snap = snapshotFromProfile();
      originalSnapshotRef.current = snap;
      setForm(snap);
      setEditing(true);
    }
    // 次のフレームで描画完了を待ってから focus + scroll
    requestAnimationFrame(() => {
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        if (typeof (el as HTMLElement & { focus?: () => void }).focus === "function") {
          (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).focus();
        }
      }
    });
    // この effect は profile 取得時 (= 初回着地) のみ動かす。
    // editing 状態の変化で再実行されないように依存は profile.id のみに限定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  function snapshotFromProfile(): ProfileForm {
    return {
      name: profile?.name ?? "",
      company: profile?.company ?? "",
      position: profile?.position ?? "",
      industry: profile?.industry ?? "",
      bio: profile?.bio ?? "",
      contact_info: profile?.contact_info ?? "",
    };
  }

  function startEdit() {
    if (!profile) return;
    const snap = snapshotFromProfile();
    originalSnapshotRef.current = snap;
    setForm(snap);
    setEditing(true);
  }

  function isDirty(): boolean {
    const orig = originalSnapshotRef.current ?? snapshotFromProfile();
    return (Object.keys(orig) as Array<keyof ProfileForm>).some(
      (k) => orig[k] !== form[k],
    );
  }

  function handleCancel() {
    if (isDirty()) {
      // window.confirm 撤去 (a11y / モバイル UX / focus trap 改善)
      // shadcn Dialog (AlertDialog 系) で破棄確認、編集継続を default に
      setShowDiscardDialog(true);
      return;
    }
    setEditing(false);
  }

  function confirmDiscard() {
    setShowDiscardDialog(false);
    setEditing(false);
  }

  function handleSave() {
    const payload = {
      ...form,
      industry: form.industry === "" ? undefined : form.industry,
    };
    updateProfile.mutate(payload, {
      onSuccess: () => setEditing(false),
    });
  }

  async function uploadFromFile(file: File): Promise<void> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
      uploadAvatar.mutate(file, {
        onSuccess: () => {
          setAvatarPreview(null);
          setPickerOpen(false);
          resolve();
        },
        onError: () => {
          setAvatarPreview(null);
          resolve();
        },
      });
    });
  }

  async function purgeAvatarStorage() {
    // ベストエフォート: storage の orphan 削除 (失敗しても profile 更新は続行)
    try {
      await fetch("/api/v1/profiles/avatar", { method: "DELETE" });
    } catch {
      // network error 時は即時 invalidate せず、次回 upload で cleanup されるため無視
    }
  }

  async function selectPreset(presetUrl: string) {
    // preset に切替時、過去のアップロード画像は不要 → storage を purge
    await purgeAvatarStorage();
    return new Promise<void>((resolve) => {
      updateProfile.mutate(
        { avatar_url: presetUrl },
        {
          onSuccess: () => {
            setPickerOpen(false);
            resolve();
          },
          onError: () => resolve(),
        },
      );
    });
  }

  async function clearAvatar() {
    await purgeAvatarStorage();
    return new Promise<void>((resolve) => {
      updateProfile.mutate(
        { avatar_url: null },
        {
          onSuccess: () => {
            setPickerOpen(false);
            resolve();
          },
          onError: () => resolve(),
        },
      );
    });
  }

  if (isLoading) return <ProfileSkeleton />;
  if (!profile) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="ds-eyebrow">Profile</p>
          <h1 className="ds-h1 mt-1 tracking-tight text-foreground">プロフィール</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            あなたの情報がマッチング精度に直結します。
          </p>
        </div>
        {!editing && (
          <Button variant="outline" size="sm" onClick={startEdit}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            編集
          </Button>
        )}
      </div>

      {/* Completeness */}
      <ProfileCompleteness profile={profile} hideLink />

      {/* Hero card */}
      <Card data-tour="profile-completeness">
        <CardContent className="space-y-5">
          <div className="flex items-start gap-4">
            <button
              type="button"
              data-tour="profile-avatar"
              className="group relative shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded-full"
              onClick={() => setPickerOpen((v) => !v)}
              disabled={uploadAvatar.isPending || updateProfile.isPending}
              aria-label="プロフィール画像を変更"
              aria-expanded={pickerOpen}
              aria-busy={uploadAvatar.isPending || updateProfile.isPending}
            >
              {avatarPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarPreview}
                  alt="プレビュー"
                  width={64}
                  height={64}
                  decoding="async"
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <UserAvatar
                  name={profile.name}
                  avatarUrl={profile.avatar_url}
                  size="lg"
                />
              )}
              {/* hover が効くデバイス (mouse) のみ初期透明 → hover で表示
                  タブレット・スマホ (pointer:coarse) は常時表示で操作可能 */}
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/60 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
                {uploadAvatar.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden="true" />
                ) : (
                  <ImageIcon className="h-5 w-5 text-white" aria-hidden="true" />
                )}
              </span>
            </button>
            {/* SR 通知 (uploading 状態) */}
            <p role="status" aria-live="polite" className="sr-only">
              {uploadAvatar.isPending ? "プロフィール画像をアップロード中です" : ""}
            </p>
            <div className="min-w-0 flex-1">
              <h2 className="ds-h2 truncate text-foreground">{profile.name}</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {profile.company || "—"}
                {profile.position ? ` / ${profile.position}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {profile.industry && (
                  <Badge
                    variant="outline"
                    className="h-6 border-accent/25 bg-accent/5 px-2.5 text-xs font-medium text-accent-strong"
                  >
                    {profile.industry}
                  </Badge>
                )}
                {profile.position && (
                  <Badge
                    variant="outline"
                    className="h-6 border-border bg-muted px-2.5 text-xs font-medium text-muted-foreground"
                  >
                    {profile.position}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* AvatarPicker 展開パネル (Camera ボタンクリックで表示) */}
          {pickerOpen && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">アイコンを変更</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPickerOpen(false)}
                  aria-label="アイコン変更パネルを閉じる"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  閉じる
                </Button>
              </div>
              <AvatarPicker
                name={profile.name}
                current={profile.avatar_url}
                onUploadFile={uploadFromFile}
                onSelectPreset={selectPreset}
                onClear={clearAvatar}
                pending={uploadAvatar.isPending || updateProfile.isPending}
              />
            </div>
          )}

          {editing ? (
            <ProfileEditForm
              form={form}
              setForm={setForm}
              onSave={handleSave}
              onCancel={handleCancel}
              saving={updateProfile.isPending}
            />
          ) : (
            <ProfileViewMode profile={profile} />
          )}
        </CardContent>
      </Card>

      {/* ゴール/提供/同意の編集導線 (各 ProfileCompleteness の missing から到達)
          /onboarding にジャンプして既存 goals/offerings を再選択・detail 編集できる。
          再同意は /onboarding/consent (prospect 経由ユーザー向け、通常ユーザーは
          onboarding 完了時に取得済 → 再表示用)。 */}
      <Card className="overflow-hidden">
        {/* マッチング項目編集帯 — want vs offer の関係性を視覚化 */}
        <Image
          src="/illustrations/profile-edit-banner.png"
          alt=""
          width={1200}
          height={180}
          className="h-auto w-full"
          aria-hidden="true"
          priority={false}
        />
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="ds-kpi-label">マッチング項目を編集</p>
            <span className="text-xs text-muted-foreground">
              プロフィール完成度の主要項目
            </span>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border">
            <li>
              <Link
                href="/onboarding"
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                aria-label="ゴール (求めていること) を編集"
              >
                <span className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span className="text-foreground">ゴール (求めていること)</span>
                  <span className="text-xs text-muted-foreground">
                    1件 +10% / 3件 +3% / 5件 +2%
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
            <li>
              <Link
                href="/onboarding"
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                aria-label="提供できることを編集"
              >
                <span className="flex items-center gap-2">
                  <Gift className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span className="text-foreground">提供できること</span>
                  <span className="text-xs text-muted-foreground">
                    1件 +10% / 3件 +3% / 5件 +2%
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
            <li>
              <Link
                href="/onboarding/consent"
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
                aria-label="第三者提供同意を再確認"
              >
                <span className="flex items-center gap-2">
                  <ShieldCheck
                    className="h-4 w-4 text-primary"
                    aria-hidden="true"
                  />
                  <span className="text-foreground">同意を再確認</span>
                  <span className="text-xs text-muted-foreground">
                    第三者提供 / プライバシー
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            ゴールと提供は、各カテゴリの<strong>詳細 (30字以上)</strong>を書くと「full」扱いになりマッチング精度が上がります。
          </p>
        </CardContent>
      </Card>

      {/* 編集破棄確認 Dialog (window.confirm 撤去 / a11y 強化) */}
      <Dialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>変更を破棄しますか?</DialogTitle>
            <DialogDescription>
              編集中の変更が保存されていません。破棄すると元の内容に戻ります。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              onClick={() => setShowDiscardDialog(false)}
            >
              編集を続ける
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
              onClick={confirmDiscard}
            >
              破棄する
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────── Subcomponents ───────── */

function ProfileEditForm({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
}: {
  form: ProfileForm;
  setForm: (v: ProfileForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const bioLen = form.bio.length;
  const bioColor =
    bioLen >= BIO_DANGER
      ? "text-destructive"
      : bioLen >= BIO_WARN
      ? "text-warning"
      : "text-muted-foreground";

  return (
    <div className="space-y-5 border-t border-border pt-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="profile-name" className={labelClass}>
            お名前
          </Label>
          <Input
            id="profile-name"
            autoComplete="name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-company" className={labelClass}>
            会社名
          </Label>
          <Input
            id="profile-company"
            autoComplete="organization"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-position" className={labelClass}>
            役職
          </Label>
          <Input
            id="profile-position"
            autoComplete="organization-title"
            value={form.position}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-industry" className={labelClass}>
            業種
          </Label>
          <div className="relative">
            <select
              id="profile-industry"
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
              className={selectClass}
            >
              <option value="">選択してください</option>
              {INDUSTRIES.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>

      <div data-tour="profile-bio" className="space-y-1.5">
        <Label htmlFor="profile-bio" className={labelClass}>
          自己紹介
        </Label>
        <textarea
          id="profile-bio"
          className={textareaClass}
          rows={4}
          maxLength={BIO_MAX}
          value={form.bio}
          onChange={(e) => setForm({ ...form, bio: e.target.value })}
          placeholder="あなたの専門領域や関心事を教えてください（マッチング精度が向上します）"
          aria-describedby="profile-bio-counter profile-bio-tiers"
        />
        <BioTierProgress bioLen={bioLen} />
        <p
          id="profile-bio-counter"
          aria-live="polite"
          aria-atomic="true"
          className={`text-right text-xs tabular-nums ${bioColor}`}
        >
          <span className="sr-only">{bioLen} / {BIO_MAX} 文字</span>
          <span aria-hidden="true">
            {bioLen} / {BIO_MAX}
          </span>
        </p>
      </div>

      <div data-tour="profile-contact" className="space-y-1.5">
        <Label htmlFor="profile-contact" className={labelClass}>
          連絡先 / SNS / Web URL
        </Label>
        <Input
          id="profile-contact"
          value={form.contact_info}
          onChange={(e) => setForm({ ...form, contact_info: e.target.value })}
          placeholder="LinkedIn URL / X (Twitter) handle / メールアドレス / 電話番号"
          aria-describedby="profile-contact-hint profile-contact-sns-hint"
        />
        <p
          id="profile-contact-hint"
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
        >
          <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          コネクションが成立した相手にのみ公開されます。
        </p>
        <p
          id="profile-contact-sns-hint"
          className="flex items-start gap-1.5 text-xs text-accent-strong"
        >
          <Link2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          URL / SNS handle (例: https://linkedin.com/in/xxx, @yourhandle) を含めるとプロフィール完成度 +3%。
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button onClick={onSave} size="lg" disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              保存中...
            </>
          ) : (
            "保存"
          )}
        </Button>
        <Button variant="outline" size="lg" onClick={onCancel} disabled={saving}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          キャンセル
        </Button>
      </div>
    </div>
  );
}

function ProfileViewMode({
  profile,
}: {
  profile: {
    company: string | null;
    position: string | null;
    bio: string | null;
    email: string;
    contact_info: string | null;
  };
}) {
  return (
    <dl className="space-y-4 border-t border-border pt-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <ViewField icon={Building2} label="会社名" value={profile.company} />
        <ViewField icon={Briefcase} label="役職" value={profile.position} />
      </div>
      {profile.bio && (
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            自己紹介
          </dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {profile.bio}
          </dd>
        </div>
      )}
      <EmailField email={profile.email} />
      {profile.contact_info && (
        <div className="rounded-lg border border-accent/25 bg-accent/5 p-3">
          <dt className="flex items-center gap-1.5 text-xs font-medium text-accent-strong">
            <Lock className="h-3 w-3" aria-hidden="true" />
            連絡先（コネクション成立後に公開）
          </dt>
          <dd className="mt-1 flex items-start gap-1.5 text-sm font-medium text-foreground">
            <AtSign className="mt-1 h-3.5 w-3.5 shrink-0 text-accent-strong" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <LinkifiedText text={profile.contact_info} />
            </span>
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * EmailField: メアドを default で mask 表示し、トグルで 10 秒だけ revealed。
 * 共有スクショ・配信時の漏洩リスクを軽減。
 */
function EmailField({ email }: { email: string }) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(false), 10_000);
    return () => clearTimeout(t);
  }, [revealed]);

  // a***@example.com 形式に mask
  const masked = (() => {
    const at = email.indexOf("@");
    if (at <= 1) return email;
    return email[0] + "***" + email.slice(at);
  })();

  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Mail
          className="mr-1 inline-block h-3.5 w-3.5 align-text-bottom"
          aria-hidden="true"
        />
        メールアドレス
      </dt>
      <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono">{revealed ? email : masked}</span>
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-pressed={revealed}
          aria-label={revealed ? "メールアドレスを隠す" : "メールアドレスを表示"}
          className="inline-flex h-7 items-center justify-center rounded-md border border-input bg-card px-2 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {revealed ? "隠す (自動 10 秒)" : "表示する"}
        </button>
      </dd>
    </div>
  );
}

/**
 * LinkifiedText: テキスト中の URL / email / @handle を安全に <a> 化。
 * - URL は new URL() で http(s) スキームのみ allow-list
 * - rel="noopener noreferrer ugc" で SEO/フィッシング対策
 * - React JSX 経由なので文字列 escape は自動
 */
function LinkifiedText({ text }: { text: string }) {
  // URL: http(s)、末尾の句読点 (. , ; : ! ? 。 、 ) ）」』 など) を除外
  // email: 末尾ドットを許容しない / 一般的な部分集合をカバー (RFC5322 完全準拠は過剰)
  const urlRegex = /(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?。、)）」』])/g;
  const emailRegex = /([A-Za-z0-9_.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
  // 1) まず URL でトークン化
  const tokens: Array<{ type: "url" | "text"; value: string }> = [];
  let lastIdx = 0;
  for (const m of text.matchAll(urlRegex)) {
    if (m.index !== undefined && m.index > lastIdx) {
      tokens.push({ type: "text", value: text.slice(lastIdx, m.index) });
    }
    tokens.push({ type: "url", value: m[0] });
    lastIdx = (m.index ?? 0) + m[0].length;
  }
  if (lastIdx < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIdx) });
  }

  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === "url") {
          try {
            const u = new URL(t.value);
            if (u.protocol !== "http:" && u.protocol !== "https:") {
              return <span key={i}>{t.value}</span>;
            }
            return (
              <a
                key={i}
                href={u.toString()}
                target="_blank"
                rel="noopener noreferrer ugc"
                className="break-all text-accent-strong underline underline-offset-2"
              >
                {t.value}
              </a>
            );
          } catch {
            return <span key={i}>{t.value}</span>;
          }
        }
        // text 内の email を mailto: 化
        const sub: Array<React.ReactNode> = [];
        let lastE = 0;
        let key = 0;
        for (const m of t.value.matchAll(emailRegex)) {
          if (m.index !== undefined && m.index > lastE) {
            sub.push(t.value.slice(lastE, m.index));
          }
          sub.push(
            <a
              key={`e-${i}-${key++}`}
              href={`mailto:${m[0]}`}
              className="break-all text-accent-strong underline underline-offset-2"
            >
              {m[0]}
            </a>,
          );
          lastE = (m.index ?? 0) + m[0].length;
        }
        if (lastE < t.value.length) sub.push(t.value.slice(lastE));
        return (
          <span key={i} className="whitespace-pre-wrap">
            {sub}
          </span>
        );
      })}
    </>
  );
}

function ViewField({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: "true" | "false" }>;
  label: string;
  value: string | null;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}

/**
 * BioTierProgress — 自己紹介の 5 段階 tier 達成度を可視化する progress bar。
 * 完成度配点 (50/100/150/250/400 字 × 4 点 = 20 点) と 1:1 で対応する。
 * - 100% bar の幅は最終 tier (400 字) を 100% として scale。
 * - 各 tier 通過時にチェックマーク + 「+4%」ラベル。
 * - 次 tier までの残り字数を hint として表示 (cliff jump 解消)。
 */
function BioTierProgress({ bioLen }: { bioLen: number }) {
  const finalTier = BIO_TIER_THRESHOLDS[BIO_TIER_THRESHOLDS.length - 1] ?? 400;
  const pct = Math.min(100, Math.round((bioLen / finalTier) * 100));
  // 直近の未達 tier を求める (達成済 → 「最高ランク達成」、それ以外 → 残り字数)
  const nextTier = BIO_TIER_THRESHOLDS.find((t) => bioLen < t) ?? null;
  const remainHint = nextTier
    ? `あと ${nextTier - bioLen} 字で +4% (現在 ${bioLen}字 / 目標 ${nextTier}字)`
    : `最高ランク達成 (現在 ${bioLen}字)`;
  return (
    <div
      id="profile-bio-tiers"
      role="group"
      aria-label="自己紹介の充実度 tier"
      className="space-y-1"
    >
      <div className="relative h-1.5 w-full overflow-visible rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-brand transition-[width] duration-300"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
        {/* tier ノッチ (50/100/150/250/400) を bar 上にドット表示 */}
        {BIO_TIER_THRESHOLDS.map((t) => {
          const left = Math.min(100, (t / finalTier) * 100);
          const reached = bioLen >= t;
          return (
            <span
              key={t}
              aria-hidden="true"
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 inline-block h-2 w-2 rounded-full border ${
                reached
                  ? "border-accent-strong bg-accent-strong"
                  : "border-border bg-card"
              }`}
              style={{ left: `${left}%` }}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span aria-hidden="true">
          {BIO_TIER_THRESHOLDS.map((t, i) => {
            const reached = bioLen >= t;
            return (
              <span
                key={t}
                className={`tabular-nums ${reached ? "text-accent-strong" : "text-muted-foreground/60"}`}
              >
                {t}
                {i < BIO_TIER_THRESHOLDS.length - 1 ? " · " : ""}
              </span>
            );
          })}
        </span>
        <span className="tabular-nums">{remainHint}</span>
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-7 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-32 animate-pulse rounded-lg border border-border bg-card" />
      <div className="h-80 animate-pulse rounded-lg border border-border bg-card" />
    </div>
  );
}
