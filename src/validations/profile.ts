import { z } from "zod/v4";
import { INDUSTRIES } from "@/lib/constants";

const industryValues = INDUSTRIES as readonly [string, ...string[]];

/**
 * 全角空白 (U+3000) や ZWSP を含む「視覚的に空文字」のケースを弾くための
 * trim ヘルパ。半角/全角空白 + ZWSP を全て除去した結果が空なら invalid。
 *
 *  ・"  " (半角空白だけ)        → invalid (旧版は通っていた)
 *  ・"　　" (全角空白だけ)       → invalid
 *  ・"​" (zero-width space) → invalid
 */
const stripBlanks = (s: string): string =>
  s.replace(/[\s　​-‍﻿]/g, "");

export const profileUpdateSchema = z.object({
  name: z
    .string()
    .max(80, "お名前は80文字以内で入力してください")
    .refine((v) => stripBlanks(v).length > 0, "お名前を入力してください")
    .optional(),
  company: z
    .string()
    .max(100, "会社名は100文字以内で入力してください")
    .optional(),
  position: z
    .string()
    .max(60, "役職は60文字以内で入力してください")
    .optional(),
  industry: z.enum(industryValues).optional(),
  bio: z.string().max(1000, "自己紹介は1000文字以内で入力してください").optional(),
  contact_info: z
    .string()
    .max(500, "連絡先は500文字以内で入力してください")
    .optional(),
  /** preset:<id> | https:// (no http/data/javascript) | null (= 頭文字 fallback) */
  avatar_url: z
    .union([
      z
        .string()
        .max(2048)
        .refine(
          (v) =>
            v.startsWith("preset:") ||
            v.startsWith("https://") ||
            v.length === 0,
          {
            message:
              "avatar_url は preset:<id> もしくは https:// のみ許可されます",
          },
        ),
      z.null(),
    ])
    .optional(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
