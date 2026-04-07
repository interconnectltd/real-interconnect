import { z } from "zod/v4";

export const loginSchema = z.object({
  email: z.email("有効なメールアドレスを入力してください"),
  password: z.string().min(1, "パスワードを入力してください"),
});

export const registerSchema = z.object({
  invitationCode: z.string().min(1, "招待コードを入力してください"),
  name: z.string().min(1, "お名前を入力してください"),
  email: z.email("有効なメールアドレスを入力してください"),
  password: z
    .string()
    .min(8, "パスワードは8文字以上で入力してください"),
  company: z.string().optional(),
  position: z.string().optional(),
  industry: z.string().min(1, "業種を選択してください"),
  bio: z.string().max(1000).optional(),
  agreeToTerms: z.boolean().refine((v) => v === true, {
    message: "利用規約への同意が必要です",
  }),
});

export const forgotPasswordSchema = z.object({
  email: z.email("有効なメールアドレスを入力してください"),
});

export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "パスワードは8文字以上で入力してください"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "パスワードが一致しません",
    path: ["confirmPassword"],
  });

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "現在のパスワードを入力してください"),
    newPassword: z
      .string()
      .min(8, "新しいパスワードは8文字以上で入力してください"),
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
