-- Goals/Offerings タクソノミの大幅拡張
-- 旧: 6種(partnership/consulting/investment/recruitment/information/mentoring)
-- 新: 15種(B2B商談で実際に頻出するカテゴリに細分化)

-- enum を維持しつつ ADD VALUE で拡張 (旧値は legacy として残す = 既存データ無破壊)
-- IF NOT EXISTS で冪等性を担保。 EXCEPTION での握り潰しは removed (致命エラー伝搬すべき)
ALTER TYPE public.goal_type ADD VALUE IF NOT EXISTS 'client_intro';
ALTER TYPE public.goal_type ADD VALUE IF NOT EXISTS 'investment_seek';
ALTER TYPE public.goal_type ADD VALUE IF NOT EXISTS 'investment_offer';
ALTER TYPE public.goal_type ADD VALUE IF NOT EXISTS 'outsourcing_seek';
ALTER TYPE public.goal_type ADD VALUE IF NOT EXISTS 'expertise_pro';
ALTER TYPE public.goal_type ADD VALUE IF NOT EXISTS 'dx_systemize';
ALTER TYPE public.goal_type ADD VALUE IF NOT EXISTS 'marketing_pr';
ALTER TYPE public.goal_type ADD VALUE IF NOT EXISTS 'sales_support';
ALTER TYPE public.goal_type ADD VALUE IF NOT EXISTS 'subsidy';
ALTER TYPE public.goal_type ADD VALUE IF NOT EXISTS 'm_and_a';
ALTER TYPE public.goal_type ADD VALUE IF NOT EXISTS 'international';

-- user_goals/offerings に詳細補足カラム (free-text で選択理由・希望条件等)
ALTER TABLE public.user_goals
  ADD COLUMN IF NOT EXISTS detail TEXT;
ALTER TABLE public.user_offerings
  ADD COLUMN IF NOT EXISTS detail TEXT;

COMMENT ON COLUMN public.user_goals.detail IS
  '選択カテゴリの詳細・条件・希望(任意). 例: "AI関連スタートアップ向け500万-3000万", "東京都内限定" 等';
COMMENT ON COLUMN public.user_offerings.detail IS
  '提供できる詳細・条件(任意). 例: "金融セクター10年経験、上場企業3社のCFO経験", "国内年間500社の販路" 等';
