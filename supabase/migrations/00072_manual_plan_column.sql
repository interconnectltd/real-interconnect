-- 運営手動付与プラン (manual_plan) を user_profiles に追加
--
-- 背景:
--   - 現状の課金判定は subscriptions.status (Stripe由来) を単一情報源としている
--   - モニター募集 (有料機能を運営判断で無料開放) のため、Stripe を経由しない
--     プラン管理が必要になった
--   - 既存の subscriptions テーブルを汚さず、独立した override column として
--     manual_plan を追加し、判定時に Stripe より優先する設計
--
-- 方針/設計判断:
--   - NULL = Stripe 基準で判定 (従来通り)
--   - 'monitor' = 運営付与のモニター会員。有料相当の全機能アクセス、Stripe 課金なし
--   - 'free' = 運営付与の明示的無料会員。モニターからのダウングレード等で使用
--   - 'paid' は意図的に enum に含めない (Stripe 経由のみで paid 化、運営は付与不可)
--   - CHECK 制約で文字列の typo を防止

ALTER TABLE public.user_profiles
  ADD COLUMN manual_plan TEXT
  CHECK (manual_plan IN ('monitor', 'free'));

CREATE INDEX idx_user_profiles_manual_plan
  ON public.user_profiles(manual_plan)
  WHERE manual_plan IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.manual_plan IS
  '運営手動付与プラン。NULL=Stripe基準。monitor=有料相当の無料モニター。free=明示的無料会員。Stripe status より優先される。';
