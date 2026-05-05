import { z } from "zod/v4";
import { INDUSTRIES } from "@/lib/constants";

const industryValues = INDUSTRIES as readonly [string, ...string[]];

export const profileUpdateSchema = z.object({
  name: z.string().min(1, "お名前を入力してください").optional(),
  company: z.string().optional(),
  position: z.string().optional(),
  industry: z.enum(industryValues).optional(),
  bio: z.string().max(1000, "自己紹介は1000文字以内で入力してください").optional(),
  contact_info: z.string().optional(),
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
