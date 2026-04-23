-- ============================================================
-- 新規テーブル6件: ホームページ動的化 + 設定画面改善
-- 実行: Supabase SQL Editor で実行
-- ============================================================

-- 1. contact_inquiries: お問い合わせフォーム送信の保存
CREATE TABLE IF NOT EXISTS contact_inquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    company TEXT,
    email TEXT NOT NULL,
    phone TEXT,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'read', 'replied', 'closed')),
    admin_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE contact_inquiries ENABLE ROW LEVEL SECURITY;

-- 誰でもINSERT可能（問い合わせフォームはログイン不要）
CREATE POLICY "Anyone can submit inquiries" ON contact_inquiries
    FOR INSERT WITH CHECK (true);

-- 管理者のみ閲覧・更新
CREATE POLICY "Admins can view inquiries" ON contact_inquiries
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

CREATE POLICY "Admins can update inquiries" ON contact_inquiries
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );


-- 2. news_items: ニュース/お知らせ
CREATE TABLE IF NOT EXISTS news_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT,
    category TEXT DEFAULT 'general' CHECK (category IN ('general', 'event', 'system', 'member', 'media', 'campaign')),
    is_published BOOLEAN DEFAULT true,
    published_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE news_items ENABLE ROW LEVEL SECURITY;

-- 公開記事は誰でも閲覧可能
CREATE POLICY "Published news visible to all" ON news_items
    FOR SELECT USING (is_published = true);

-- 管理者のみ作成・更新・削除
CREATE POLICY "Admins can manage news" ON news_items
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );


-- 3. site_settings: サイト全体の設定値（キーバリュー形式）
CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

-- 誰でも読み取り可能（公開設定）
CREATE POLICY "Site settings readable by all" ON site_settings
    FOR SELECT USING (true);

-- 管理者のみ更新
CREATE POLICY "Admins can update site settings" ON site_settings
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );


-- 4. login_sessions: ログイン履歴
CREATE TABLE IF NOT EXISTS login_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device TEXT,
    browser TEXT,
    ip_address TEXT,
    location TEXT,
    logged_in_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_sessions_user_id ON login_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_sessions_logged_in_at ON login_sessions(logged_in_at DESC);

ALTER TABLE login_sessions ENABLE ROW LEVEL SECURITY;

-- ユーザーは自分の履歴のみ閲覧
CREATE POLICY "Users can view own sessions" ON login_sessions
    FOR SELECT USING (auth.uid() = user_id);

-- ログイン時にINSERT（自分のレコードのみ）
CREATE POLICY "Users can insert own sessions" ON login_sessions
    FOR INSERT WITH CHECK (auth.uid() = user_id);


-- 5. faqs: よくある質問
CREATE TABLE IF NOT EXISTS faqs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT DEFAULT 'general' CHECK (category IN ('general', 'membership', 'roi', 'matching', 'billing', 'technical')),
    sort_order INTEGER DEFAULT 0,
    is_published BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE faqs ENABLE ROW LEVEL SECURITY;

-- 公開FAQは誰でも閲覧可能
CREATE POLICY "Published FAQs visible to all" ON faqs
    FOR SELECT USING (is_published = true);

-- 管理者のみ管理
CREATE POLICY "Admins can manage FAQs" ON faqs
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );


-- 6. case_studies: 成功事例
CREATE TABLE IF NOT EXISTS case_studies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    company_description TEXT,
    category TEXT,
    background TEXT,
    solution TEXT,
    metrics JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 0,
    is_published BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE case_studies ENABLE ROW LEVEL SECURITY;

-- 公開事例は誰でも閲覧可能
CREATE POLICY "Published case studies visible to all" ON case_studies
    FOR SELECT USING (is_published = true);

-- 管理者のみ管理
CREATE POLICY "Admins can manage case studies" ON case_studies
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );


-- ============================================================
-- 初期データ投入
-- ============================================================

-- site_settings: サイト統計値・連絡先・キャンペーン
INSERT INTO site_settings (key, value) VALUES
    ('performance_stats', '{
        "matching_rate": "78.5%",
        "annual_matchings": "480件",
        "annual_funding": "18億円",
        "average_roi": "180%",
        "retention_rate": "82.3%",
        "average_revenue_growth": "320万円"
    }'::jsonb),
    ('contact_info', '{
        "phone": "03-XXXX-XXXX",
        "phone_hours": "平日9:00-18:00 / 土日祝10:00-17:00",
        "email": "info@inter-connect.jp",
        "line_id": "@inter-connect"
    }'::jsonb),
    ('campaign', '{
        "title": "期間限定特典",
        "description": "先着30名様限定で合計210,000円分の特典付き",
        "remaining": 22,
        "is_active": true
    }'::jsonb),
    ('pricing', '{
        "standard_monthly": 30000,
        "standard_original": 100000,
        "annual": 300000,
        "free_trial_months": 2,
        "regional_discount_percent": 10
    }'::jsonb)
ON CONFLICT (key) DO NOTHING;


-- news_items: 最新ニュース（2026年2月時点のデータ）
INSERT INTO news_items (title, content, category, published_at) VALUES
    ('累計会員数200名突破', 'おかげさまで多くの経営者にご参加いただいています', 'member', '2026-02-01T00:00:00+09:00'),
    ('マッチング精度向上アップデート', 'より適切な紹介ができるようシステムを改善いたしました', 'system', '2026-01-20T00:00:00+09:00'),
    ('月次オンライン交流会を開催', '30名の経営者が参加し活発な情報交換が行われました', 'event', '2026-01-15T00:00:00+09:00'),
    ('1:1メッセージ機能をリリース', 'コネクション済みのメンバー間でチャットが可能になりました', 'system', '2026-02-10T00:00:00+09:00'),
    ('今月のマッチング成功件数28件を達成', '過去最高のマッチング数を更新しました', 'general', '2026-01-31T00:00:00+09:00'),
    ('新規メンバー向けオンボーディング改善', 'ご登録から初回マッチングまでの流れを簡略化しました', 'system', '2026-01-10T00:00:00+09:00');


-- faqs: よくある質問
INSERT INTO faqs (question, answer, category, sort_order) VALUES
    ('どのような経営者が参加していますか？',
     'IT・ソフトウェア・Web制作業（22%）、製造業・町工場・メーカー（18%）、飲食・小売・EC事業（15%）など、幅広い業界から参加いただいています。平均年商8,500万円、平均従業員数12名、創業年数平均6年の成長志向の中小企業経営者が中心です。',
     'membership', 1),
    ('入会に必要な条件は？',
     '会社の社長・取締役・役員で、何らかの事業をしている方（業種・規模問わず）。MLM・風俗・ギャンブル業以外であれば、95%以上の方が即座に承認されます。',
     'membership', 2),
    ('実際にどのような成果が期待できますか？',
     '新規顧客獲得（年平均2-3社）、売上向上（平均15%成長）、コスト削減（仕入れ先紹介で平均8%削減）、人材確保（採用成功率向上）、業務効率化（月20-30時間の時短）などの成果が期待できます。',
     'roi', 3),
    ('ROIはどの程度ですか？',
     '約70%のメンバーが1年以内に投資回収を実現しています。平均ROIは180%（年間）、新規取引による追加収益は年平均320万円です。',
     'roi', 4);


-- case_studies: 成功事例
INSERT INTO case_studies (title, company_description, category, background, solution, metrics, sort_order) VALUES
    ('印刷会社CEO A氏（従業員12名）',
     '印刷会社CEO A氏（従業員12名）',
     '新規取引先開拓成功',
     '従来の取引先に依存度が高く、売上の70%を3社に頼っている状況。新規開拓の営業ノウハウがなく、飛び込み営業も成果が出ない。',
     '独自のマッチングシステムが過去面談データから最適な相手を発見。印刷物を必要とする異業種経営者との接点を創出。',
     '[{"value": "5社", "label": "新規取引先獲得"}, {"value": "+37%", "label": "月間売上向上"}, {"value": "1名", "label": "正社員新規雇用"}]'::jsonb,
     1),
    ('金属加工業CEO B氏（従業員18名）',
     '金属加工業CEO B氏（従業員18名）',
     '生産性向上成功',
     '創業35年の町工場、熟練工の高齢化が課題。受注管理が紙ベース、在庫管理も手作業。ITツール導入を検討するも何から始めればよいか不明。',
     '同規模製造業での成功経験者とのマッチング実現。実際に使える低コストソリューションの紹介。段階的導入プランの策定から実行まで継続サポート。',
     '[{"value": "15%", "label": "作業時間短縮"}, {"value": "30%", "label": "在庫ロス削減"}, {"value": "20%", "label": "残業時間減少"}]'::jsonb,
     2),
    ('和菓子製造業CEO C氏（従業員6名）',
     '和菓子製造業CEO C氏（従業員6名）',
     '隣県展開成功',
     '地方の老舗和菓子店、地元での知名度は高いが売上が頭打ち。隣県の県庁所在地への進出を検討するも販路開拓の方法が不明。',
     '同じ食品業界で県外展開経験者との戦略的マッチング。実際に取引のある卸業者・小売店の具体的紹介。低コストでの配送ルート確立をアドバイス。',
     '[{"value": "35%", "label": "隣県売上比率"}, {"value": "+59%", "label": "月商拡大"}, {"value": "3名", "label": "新規雇用"}]'::jsonb,
     3);
