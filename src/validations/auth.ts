import { z } from "zod/v4";

/**
 * パスワード強度ポリシー (Wave1 sec audit 2026-05-07):
 *   - 10 文字以上 (NIST 800-63B 推奨ライン)
 *   - 英大文字 + 英小文字 + 数字を必須
 *   - 上限 128 文字 (DoS / bcrypt cost 暴発抑止)
 *   HIBP k-anonymity 検証は register-form 側で実施 (CSP connect-src 許可済)。
 */
export const passwordStrengthField = z
  .string()
  .min(10, "パスワードは10文字以上で入力してください")
  .max(128, "パスワードは128文字以下で入力してください")
  .refine((p) => /[A-Z]/.test(p), {
    message: "英大文字を1文字以上含めてください",
  })
  .refine((p) => /[a-z]/.test(p), {
    message: "英小文字を1文字以上含めてください",
  })
  .refine((p) => /\d/.test(p), {
    message: "数字を1文字以上含めてください",
  });

export const loginSchema = z.object({
  email: z.email("有効なメールアドレスを入力してください"),
  password: z.string().min(1, "パスワードを入力してください"),
});

export const registerSchema = z.object({
  invitationCode: z.string().min(1, "招待コードを入力してください").max(64),
  name: z.string().min(1, "お名前を入力してください").max(100),
  email: z.email("有効なメールアドレスを入力してください"),
  password: passwordStrengthField,
  company: z.string().max(200).optional(),
  position: z.string().max(100).optional(),
  industry: z.string().min(1, "業種を選択してください"),
  bio: z.string().max(1000).optional(),
  agreeToTerms: z.boolean().refine((v) => v === true, {
    message: "利用規約への同意が必要です",
  }),
  agreeToPrivacy: z.boolean().refine((v) => v === true, {
    message: "プライバシーポリシーへの同意が必要です",
  }),
  agreeToTokushoho: z.boolean().refine((v) => v === true, {
    message: "特定商取引法に基づく表記への同意が必要です",
  }),
});

export const forgotPasswordSchema = z.object({
  email: z.email("有効なメールアドレスを入力してください"),
});

export const resetPasswordSchema = z
  .object({
    password: passwordStrengthField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "パスワードが一致しません",
    path: ["confirmPassword"],
  });

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "現在のパスワードを入力してください"),
    newPassword: passwordStrengthField,
    confirmNewPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "パスワードが一致しません",
    path: ["confirmNewPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
