"use client";

import { useState, useRef } from "react";
import { Pencil, Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useMyProfile } from "@/hooks/queries/use-profile";
import { INDUSTRIES } from "@/lib/constants";
import { useUpdateProfile } from "@/hooks/mutations/use-update-profile";
import { useUploadAvatar } from "@/hooks/mutations/use-upload-avatar";
import { ProfileCompleteness } from "@/components/shared/profile-completeness";
import { UserAvatar } from "@/components/shared/user-avatar";

export default function ProfilePage() {
  const { data: profile, isLoading } = useMyProfile();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    company: "",
    position: "",
    industry: "",
    bio: "",
    contact_info: "",
  });

  function startEdit() {
    if (!profile) return;
    setForm({
      name: profile.name ?? "",
      company: profile.company ?? "",
      position: profile.position ?? "",
      industry: profile.industry ?? "",
      bio: profile.bio ?? "",
      contact_info: profile.contact_info ?? "",
    });
    setEditing(true);
  }

  function handleSave() {
    updateProfile.mutate(form, {
      onSuccess: () => setEditing(false),
    });
  }

  function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show preview
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Upload
    uploadAvatar.mutate(file, {
      onSuccess: () => setAvatarPreview(null),
      onError: () => setAvatarPreview(null),
    });

    // Reset input so same file can be selected again
    e.target.value = "";
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">プロフィール</h1>
        {!editing && (
          <Button variant="outline" size="sm" onClick={startEdit}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            編集
          </Button>
        )}
      </div>

      <ProfileCompleteness profile={profile} hideLink />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="group relative"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadAvatar.isPending}
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
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-100 md:opacity-0 transition-opacity md:group-hover:opacity-100">
                {uploadAvatar.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                ) : (
                  <Camera className="h-5 w-5 text-white" />
                )}
              </div>
              {uploadAvatar.isPending && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                </div>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handleAvatarSelect}
            />
            <div>
              <CardTitle className="text-lg">{profile.name}</CardTitle>
              {profile.industry && (
                <Badge variant="secondary" className="mt-1">{profile.industry}</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {editing ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>お名前</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>会社名</Label>
                  <Input
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>役職</Label>
                  <Input
                    value={form.position}
                    onChange={(e) => setForm({ ...form, position: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>業種</Label>
                  <select
                    value={form.industry}
                    onChange={(e) => setForm({ ...form, industry: e.target.value })}
                    className="w-full rounded-md border bg-background px-3 py-2 text-base md:text-sm"
                  >
                    <option value="">選択してください</option>
                    {INDUSTRIES.map((ind) => (
                      <option key={ind} value={ind}>{ind}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>自己紹介</Label>
                <textarea
                  className="w-full rounded-md border bg-background px-3 py-2 text-base md:text-sm"
                  rows={4}
                  value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>連絡先（コネクション成立後に公開）</Label>
                <Input
                  value={form.contact_info}
                  onChange={(e) => setForm({ ...form, contact_info: e.target.value })}
                  placeholder="LINE ID、メールアドレス等"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={updateProfile.isPending}>
                  {updateProfile.isPending ? "保存中..." : "保存"}
                </Button>
                <Button variant="outline" onClick={() => setEditing(false)}>
                  キャンセル
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">会社名</p>
                  <p className="text-sm">{profile.company || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">役職</p>
                  <p className="text-sm">{profile.position || "—"}</p>
                </div>
              </div>
              {profile.bio && (
                <div>
                  <p className="text-xs text-muted-foreground">自己紹介</p>
                  <p className="mt-1 text-sm leading-relaxed">{profile.bio}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">メールアドレス</p>
                <p className="text-sm">{profile.email}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
