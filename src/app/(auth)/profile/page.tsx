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
} from "lucide-react";
import { toast } from "sonner";
import { AvatarPicker } from "@/components/features/profile/avatar-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useMyProfile } from "@/hooks/queries/use-profile";
import { INDUSTRIES } from "@/lib/constants";
import { useUpdateProfile } from "@/hooks/mutations/use-update-profile";
import { useUploadAvatar } from "@/hooks/mutations/use-upload-avatar";
import { ProfileCompleteness } from "@/components/shared/profile-completeness";
import { UserAvatar } from "@/components/shared/user-avatar";

const labelClass = "text-sm font-medium text-foreground";
const selectClass =
  "h-10 w-full rounded-lg border border-input bg-card pl-3 pr-10 py-2 text-sm transition-[box-shadow,border-color] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/70 appearance-none";
const textareaClass =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm transition-[box-shadow,border-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/70";

const BIO_MAX = 1000;
const BIO_WARN = 900;
const BIO_DANGER = 990;

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
    if (isDirty() && !window.confirm("変更が保存されていません。破棄しますか？")) {
      return;
    }
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

  async function selectPreset(presetUrl: string) {
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
                <img
                  src={avatarPreview}
                  alt="プレビュー"
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <UserAvatar
                  name={profile.name}
                  avatarUrl={profile.avatar_url}
                  size="lg"
                />
              )}
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/60 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
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
          aria-describedby="profile-bio-counter"
        />
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
          連絡先
        </Label>
        <Input
          id="profile-contact"
          value={form.contact_info}
          onChange={(e) => setForm({ ...form, contact_info: e.target.value })}
          placeholder="LINE ID、メールアドレス等"
          aria-describedby="profile-contact-hint"
        />
        <p
          id="profile-contact-hint"
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
        >
          <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          コネクションが成立した相手にのみ公開されます。
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
      <ViewField icon={Mail} label="メールアドレス" value={profile.email} />
      {profile.contact_info && (
        <div className="rounded-lg border border-accent/25 bg-accent/5 p-3">
          <dt className="flex items-center gap-1.5 text-xs font-medium text-accent-strong">
            <Lock className="h-3 w-3" aria-hidden="true" />
            連絡先（コネクション成立後に公開）
          </dt>
          <dd className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <AtSign className="h-3.5 w-3.5 text-accent-strong" aria-hidden="true" />
            {profile.contact_info}
          </dd>
        </div>
      )}
    </dl>
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
