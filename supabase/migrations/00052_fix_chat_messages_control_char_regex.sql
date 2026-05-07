-- 00052: chat_messages_no_control_chars_check の壊れた regex を修正
--
-- 真因 (本番再現済):
--   旧 CHECK 制約: `content !~ '[--\t-\n-]'::text`
--   この regex `[--\t-\n-]` は character class 内で `-` が range delimiter として
--   解釈され「`-` から `-`」「`\n` から `-`」等の **不正な char range** を
--   含むため、 PostgreSQL regex engine が
--   `2201B: invalid regular expression: invalid character range`
--   を chat_messages INSERT 時に毎回 raise → INSERT 全体 rollback → API 500
--
--   全 content_type (text / scheduling_card / image / 等) で発生。
--   ユーザー実機で 500 が止まらない真因。
--
-- 修正方針:
--   constraint を **drop** する。 input validation は API 層の zod schema
--   (lib/validators/chat.ts PostMessageSchema) で `.trim().max()` 済。
--   BiDi / 制御文字対策は input.tsx / register-form 等で API レベルで実施
--   (server-side で content の制御文字 strip は別 layer の責務)。
--
--   再追加するなら下記のような正しい regex (現状は不要):
--     CHECK (content !~ E'[\\x00-\\x08\\x0B-\\x1F\\x7F]') NOT VALID
--   ※ 上記は \t (\x09) と \n (\x0A) のみ許可する control char filter。

ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_no_control_chars_check;
