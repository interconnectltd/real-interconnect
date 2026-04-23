-- ================================================================
-- INTERCONNECT 正規データベーススキーマ
-- 作成日: 2026-02-11
--
-- このファイルが唯一の正しいスキーマ定義です。
-- JSコードの実際の参照と整合させています。
--
-- 実行順序: このファイルを上から下へ順に実行してください。
-- 既存DBに対しては CREATE TABLE IF NOT EXISTS と
-- ADD COLUMN IF NOT EXISTS で安全に適用できます。
-- ================================================================

-- ========================
-- 0. 共通ユーティリティ
-- ========================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ========================
-- 1. user_profiles（メインユーザーテーブル）
-- ========================
-- 注: JSは .from('user_profiles') を使用。
-- 旧 'profiles' テーブルがある場合は RENAME で移行すること。

-- 会員ID用シーケンス
CREATE SEQUENCE IF NOT EXISTS member_id_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    member_id TEXT UNIQUE,
    name TEXT,
    full_name TEXT,
    email TEXT UNIQUE,
    company TEXT,
    position TEXT,
    industry TEXT,
    bio TEXT,
    phone TEXT,
    line_id TEXT,
    location TEXT,
    budget_range TEXT,
    business_challenges JSONB,
    skills TEXT[] DEFAULT '{}',
    interests TEXT[] DEFAULT '{}',
    avatar_url TEXT,
    picture_url TEXT,
    cover_url TEXT,
    line_qr_url TEXT,
    is_active BOOLEAN DEFAULT true,
    is_online BOOLEAN DEFAULT false,
    is_admin BOOLEAN DEFAULT false,
    transcript_analysis_consent BOOLEAN DEFAULT false,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_member_id ON user_profiles(member_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_industry ON user_profiles(industry);
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_active ON user_profiles(is_active) WHERE is_active = true;

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public profiles viewable by authenticated" ON user_profiles;
CREATE POLICY "Public profiles viewable by authenticated" ON user_profiles
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
CREATE POLICY "Users can insert own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ★1 Fix: is_admin / is_active の自己変更を防止するトリガー
-- service_role以外のユーザーが管理者フラグを変更しようとした場合、元の値に戻す
CREATE OR REPLACE FUNCTION protect_admin_fields()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('request.jwt.claim.role', true) != 'service_role' THEN
        NEW.is_admin := OLD.is_admin;
        NEW.is_active := OLD.is_active;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_admin_fields_trigger ON user_profiles;
CREATE TRIGGER protect_admin_fields_trigger
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION protect_admin_fields();

-- 後方互換: 'profiles' ビューを作成（旧コードが参照する場合用）
CREATE OR REPLACE VIEW profiles AS SELECT * FROM user_profiles;

-- 後方互換: 'events' ビューは event_items テーブル作成後に定義（下記参照）

-- ========================
-- 2. connections
-- ========================
-- JS使用ステータス: pending, accepted, rejected, cancelled, removed, blocked

CREATE TABLE IF NOT EXISTS connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    connected_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'removed', 'blocked', 'reaccepted')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    responded_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, connected_user_id)
);

CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_connected_user_id ON connections(connected_user_id);
CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);

ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their connections" ON connections;
CREATE POLICY "Users can view their connections" ON connections
    FOR SELECT USING (auth.uid() = user_id OR auth.uid() = connected_user_id);

DROP POLICY IF EXISTS "Users can create connections" ON connections;
CREATE POLICY "Users can create connections" ON connections
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their connections" ON connections;
CREATE POLICY "Users can update their connections" ON connections
    FOR UPDATE USING (auth.uid() = user_id OR auth.uid() = connected_user_id);

DROP POLICY IF EXISTS "Admin can view all connections" ON connections;
CREATE POLICY "Admin can view all connections" ON connections
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

DROP TRIGGER IF EXISTS update_connections_updated_at ON connections;
CREATE TRIGGER update_connections_updated_at
    BEFORE UPDATE ON connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================
-- 3. notifications
-- ========================

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type VARCHAR(50),
    title VARCHAR(255),
    message TEXT,
    link TEXT,
    actions JSONB,
    data JSONB,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(user_id, is_read) WHERE is_read = false;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
CREATE POLICY "Users can view own notifications" ON notifications
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Users can update own notifications" ON notifications
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can create notifications" ON notifications;
CREATE POLICY "Authenticated users can create notifications" ON notifications
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admin can view all notifications" ON notifications;
CREATE POLICY "Admin can view all notifications" ON notifications
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;
CREATE POLICY "Users can delete own notifications" ON notifications
    FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin can delete all notifications" ON notifications;
CREATE POLICY "Admin can delete all notifications" ON notifications
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

DROP POLICY IF EXISTS "Service role can manage all notifications" ON notifications;
CREATE POLICY "Service role can manage all notifications" ON notifications
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ========================
-- 4. event_items
-- ========================

CREATE TABLE IF NOT EXISTS event_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    event_date TIMESTAMP WITH TIME ZONE NOT NULL,
    start_time TIME,
    end_time TIME,
    event_type VARCHAR(20) CHECK (event_type IN ('online', 'offline', 'hybrid')),
    online_url TEXT,
    location TEXT,
    capacity INTEGER,
    max_participants INTEGER,
    price INTEGER DEFAULT 0,
    image_url TEXT,
    organizer_id UUID REFERENCES auth.users(id),
    is_public BOOLEAN DEFAULT true,
    is_cancelled BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_items_event_date ON event_items(event_date);
CREATE INDEX IF NOT EXISTS idx_event_items_is_public ON event_items(is_public) WHERE is_public = true;

ALTER TABLE event_items ENABLE ROW LEVEL SECURITY;

-- 後方互換: 'events' ビューを作成（JSコードが .from('events') を使用）
CREATE OR REPLACE VIEW events AS SELECT * FROM event_items;

DROP POLICY IF EXISTS "Public events viewable by authenticated" ON event_items;
CREATE POLICY "Public events viewable by authenticated" ON event_items
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Organizers can manage events" ON event_items;
CREATE POLICY "Organizers can manage events" ON event_items
    FOR ALL USING (auth.uid() = organizer_id);

-- ========================
-- 5. event_participants
-- ========================

CREATE TABLE IF NOT EXISTS event_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES event_items(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'registered'
        CHECK (status IN ('registered', 'confirmed', 'cancelled')),
    registration_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    attendance_status TEXT CHECK (attendance_status IN ('present', 'absent', 'late', NULL)),
    cancellation_reason TEXT,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    attendance_confirmed_at TIMESTAMP WITH TIME ZONE,
    special_requirements TEXT,
    payment_status TEXT CHECK (payment_status IN ('pending', 'paid', 'refunded', 'free', NULL)),
    UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_participants_event_id ON event_participants(event_id);
CREATE INDEX IF NOT EXISTS idx_event_participants_user_id ON event_participants(user_id);

ALTER TABLE event_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view event participants" ON event_participants;
CREATE POLICY "Users can view event participants" ON event_participants
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can manage own participation" ON event_participants;
CREATE POLICY "Users can manage own participation" ON event_participants
    FOR ALL USING (auth.uid() = user_id);

-- ========================
-- 6. invite_links
-- ========================
-- JS uses: created_by, link_code, description, is_active, referral_count,
--          conversion_count, used_count, created_at, last_used_at, max_uses, expires_at

CREATE TABLE IF NOT EXISTS invite_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    link_code VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    max_uses INTEGER,
    used_count INTEGER DEFAULT 0,
    referral_count INTEGER DEFAULT 0,
    conversion_count INTEGER DEFAULT 0,
    registration_count INTEGER DEFAULT 0,
    completion_count INTEGER DEFAULT 0,
    total_rewards_earned INTEGER DEFAULT 0,
    campaign_code VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_links_created_by ON invite_links(created_by);
CREATE INDEX IF NOT EXISTS idx_invite_links_link_code ON invite_links(link_code);
CREATE INDEX IF NOT EXISTS idx_invite_links_stats ON invite_links(created_by, is_active, created_at DESC);

ALTER TABLE invite_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own invite links" ON invite_links;
CREATE POLICY "Users can view own invite links" ON invite_links
    FOR SELECT USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can create invite links" ON invite_links;
CREATE POLICY "Users can create invite links" ON invite_links
    FOR INSERT WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can update own invite links" ON invite_links;
CREATE POLICY "Users can update own invite links" ON invite_links
    FOR UPDATE USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Active links viewable for invites" ON invite_links;
CREATE POLICY "Active links viewable for invites" ON invite_links
    FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Admin can view all invite links" ON invite_links;
CREATE POLICY "Admin can view all invite links" ON invite_links
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

DROP POLICY IF EXISTS "Users can delete own invite links" ON invite_links;
CREATE POLICY "Users can delete own invite links" ON invite_links
    FOR DELETE USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Admin can delete invite links" ON invite_links;
CREATE POLICY "Admin can delete invite links" ON invite_links
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- ========================
-- 7. invitations
-- ========================
-- 正規カラム名: inviter_id, invitation_code（JSの主要参照に合わせる）

CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    invitee_email TEXT,
    invitee_id UUID REFERENCES auth.users(id),
    invitation_code VARCHAR(20),
    invite_link_id UUID REFERENCES invite_links(id),
    custom_message TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'registered', 'completed', 'expired', 'cancelled')),
    points_earned INTEGER DEFAULT 0,
    reward_points INTEGER DEFAULT 1000,
    reward_status VARCHAR(20) DEFAULT 'pending'
        CHECK (reward_status IN ('pending', 'earned', 'cancelled')),
    reward_earned_at TIMESTAMP WITH TIME ZONE,
    meeting_completed_at TIMESTAMP WITH TIME ZONE,
    fraud_score DECIMAL(3,2) DEFAULT 0.00,
    verification_notes TEXT,
    referral_data JSONB,
    accepted_by UUID REFERENCES auth.users(id),
    accepted_at TIMESTAMP WITH TIME ZONE,
    registered_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 days'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitations_inviter_id ON invitations(inviter_id);
CREATE INDEX IF NOT EXISTS idx_invitations_invitation_code ON invitations(invitation_code);
CREATE INDEX IF NOT EXISTS idx_invitations_accepted_by ON invitations(accepted_by);
CREATE INDEX IF NOT EXISTS idx_invitations_invitee_email ON invitations(invitee_email);
CREATE INDEX IF NOT EXISTS idx_invitations_reward_status ON invitations(reward_status) WHERE reward_status = 'pending';

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view invitations they created" ON invitations;
CREATE POLICY "Users can view invitations they created" ON invitations
    FOR SELECT USING (inviter_id = auth.uid());

DROP POLICY IF EXISTS "Users can view invitations where they are the acceptor" ON invitations;
CREATE POLICY "Users can view invitations where they are the acceptor" ON invitations
    FOR SELECT USING (accepted_by = auth.uid());

DROP POLICY IF EXISTS "Users can create invitations" ON invitations;
CREATE POLICY "Users can create invitations" ON invitations
    FOR INSERT WITH CHECK (inviter_id = auth.uid());

DROP POLICY IF EXISTS "Admin can view all invitations" ON invitations;
CREATE POLICY "Admin can view all invitations" ON invitations
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

DROP POLICY IF EXISTS "Users can update invitations they accepted" ON invitations;
CREATE POLICY "Users can update invitations they accepted" ON invitations
    FOR UPDATE USING (
        accepted_by = auth.uid() OR inviter_id = auth.uid()
    );

-- ========================
-- 8. invite_history
-- ========================

CREATE TABLE IF NOT EXISTS invite_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_link_id UUID REFERENCES invite_links(id) ON DELETE CASCADE,
    invitation_id UUID REFERENCES invitations(id),
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_history_link_id ON invite_history(invite_link_id);

ALTER TABLE invite_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage invite history" ON invite_history;
CREATE POLICY "Service role can manage invite history" ON invite_history
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS "Users can insert invite history" ON invite_history;
CREATE POLICY "Users can insert invite history" ON invite_history
    FOR INSERT WITH CHECK (true);

-- ========================
-- 9. user_points
-- ========================

CREATE TABLE IF NOT EXISTS user_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    total_earned INTEGER DEFAULT 0,
    balance INTEGER DEFAULT 0,
    available_points INTEGER DEFAULT 0,
    referral_points_earned INTEGER DEFAULT 0,
    referral_points_spent INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_points_user_id ON user_points(user_id);

ALTER TABLE user_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own points" ON user_points;
CREATE POLICY "Users can view own points" ON user_points
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin can view all user points" ON user_points;
CREATE POLICY "Admin can view all user points" ON user_points
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

DROP POLICY IF EXISTS "Users can insert own points" ON user_points;
CREATE POLICY "Users can insert own points" ON user_points
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ★2 Fix: user_pointsの直接UPDATE禁止（ポイント操作はSECURITY DEFINER関数経由のみ）
-- DROP POLICY "Users can update own points" -- 削除済み

DROP TRIGGER IF EXISTS update_user_points_updated_at ON user_points;
CREATE TRIGGER update_user_points_updated_at
    BEFORE UPDATE ON user_points
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================
-- 10. point_transactions
-- ========================

CREATE TABLE IF NOT EXISTS point_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    points INTEGER NOT NULL,
    reason TEXT,
    booking_id TEXT,
    referral_code VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_point_transactions_user_id ON point_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_point_transactions_referral_code ON point_transactions(referral_code);

ALTER TABLE point_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transactions" ON point_transactions;
CREATE POLICY "Users can view own transactions" ON point_transactions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage point transactions" ON point_transactions;
CREATE POLICY "Service role can manage point transactions" ON point_transactions
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ========================
-- 11. cashout_requests
-- ========================
-- 正規構造: JS uses amount, gross_amount, tax_amount, net_amount, bank_info (JSONB)

CREATE TABLE IF NOT EXISTS cashout_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    gross_amount DECIMAL(10,2),
    tax_amount DECIMAL(10,2),
    net_amount DECIMAL(10,2),
    bank_info JSONB,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'completed', 'cancelled')),
    processed_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cashout_requests_user_id ON cashout_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_cashout_requests_status ON cashout_requests(status);

ALTER TABLE cashout_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own cashout requests" ON cashout_requests;
CREATE POLICY "Users can view own cashout requests" ON cashout_requests
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create cashout requests" ON cashout_requests;
CREATE POLICY "Users can create cashout requests" ON cashout_requests
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can cancel pending cashout requests" ON cashout_requests;
CREATE POLICY "Users can cancel pending cashout requests" ON cashout_requests
    FOR UPDATE USING (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS "Admin can view all cashout requests" ON cashout_requests;
CREATE POLICY "Admin can view all cashout requests" ON cashout_requests
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

DROP POLICY IF EXISTS "Admin can update cashout requests" ON cashout_requests;
CREATE POLICY "Admin can update cashout requests" ON cashout_requests
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- ========================
-- 12. activities
-- ========================

CREATE TABLE IF NOT EXISTS activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,
    title TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    related_user_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at DESC);

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Activities viewable by authenticated" ON activities;
CREATE POLICY "Activities viewable by authenticated" ON activities
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can insert activities" ON activities;
CREATE POLICY "Users can insert activities" ON activities
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ========================
-- 13. messages（会話テーブル）
-- ========================

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own messages" ON messages;
CREATE POLICY "Users can view own messages" ON messages
    FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

DROP POLICY IF EXISTS "Users can send messages" ON messages;
CREATE POLICY "Users can send messages" ON messages
    FOR INSERT WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "Users can update own messages" ON messages;
CREATE POLICY "Users can update own messages" ON messages
    FOR UPDATE USING (auth.uid() = receiver_id);

-- ========================
-- 14. マッチングシステム
-- ========================

CREATE TABLE IF NOT EXISTS match_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    responded_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(requester_id, recipient_id)
);

CREATE TABLE IF NOT EXISTS match_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user1_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user2_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    match_request_id UUID REFERENCES match_requests(id),
    match_score NUMERIC(3,2),
    match_reasons JSONB,
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user1_id, user2_id),
    CHECK (user1_id < user2_id)
);

-- matchings ビュー（dashboard-unified.jsが参照）
CREATE OR REPLACE VIEW matchings AS
SELECT id, user1_id, user2_id, match_score, connected_at AS created_at
FROM match_connections;

CREATE TABLE IF NOT EXISTS profile_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    viewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    viewed_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    view_duration INTEGER,
    source TEXT
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bookmarked_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, bookmarked_user_id)
);

ALTER TABLE match_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own match requests" ON match_requests;
CREATE POLICY "Users can view own match requests" ON match_requests
    FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = recipient_id);

DROP POLICY IF EXISTS "Users can create match requests" ON match_requests;
CREATE POLICY "Users can create match requests" ON match_requests
    FOR INSERT WITH CHECK (auth.uid() = requester_id);

DROP POLICY IF EXISTS "Recipients can update match request status" ON match_requests;
CREATE POLICY "Recipients can update match request status" ON match_requests
    FOR UPDATE USING (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "Users can view their match connections" ON match_connections;
CREATE POLICY "Users can view their match connections" ON match_connections
    FOR SELECT USING (auth.uid() = user1_id OR auth.uid() = user2_id);

DROP POLICY IF EXISTS "Users can create profile views" ON profile_views;
CREATE POLICY "Users can create profile views" ON profile_views
    FOR INSERT WITH CHECK (auth.uid() = viewer_id);

DROP POLICY IF EXISTS "Users can view who viewed their profile" ON profile_views;
CREATE POLICY "Users can view who viewed their profile" ON profile_views
    FOR SELECT USING (auth.uid() = viewed_user_id OR auth.uid() = viewer_id);

DROP POLICY IF EXISTS "Users can manage their bookmarks" ON bookmarks;
CREATE POLICY "Users can manage their bookmarks" ON bookmarks
    FOR ALL USING (auth.uid() = user_id);

-- ========================
-- 15. 予約システム
-- ========================

CREATE TABLE IF NOT EXISTS booking_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255) UNIQUE NOT NULL,
    user_id UUID REFERENCES auth.users(id),
    user_email VARCHAR(255),
    referral_code VARCHAR(20),
    status VARCHAR(50) DEFAULT 'pending',
    session_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id VARCHAR(255) UNIQUE NOT NULL,
    session_ref VARCHAR(255) REFERENCES booking_sessions(session_id),
    user_email VARCHAR(255) NOT NULL,
    user_name VARCHAR(255),
    staff_name VARCHAR(255),
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_minutes INTEGER DEFAULT 30,
    consultation_type VARCHAR(100),
    consultation_details TEXT,
    referral_code VARCHAR(20),
    meeting_url TEXT,
    status VARCHAR(50) DEFAULT 'confirmed',
    completed_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_sessions_user_id ON booking_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user_email ON bookings(user_email);
CREATE INDEX IF NOT EXISTS idx_bookings_referral_code ON bookings(referral_code);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_scheduled_at ON bookings(scheduled_at);

ALTER TABLE booking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own booking sessions" ON booking_sessions;
CREATE POLICY "Users can view own booking sessions" ON booking_sessions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own booking sessions" ON booking_sessions;
CREATE POLICY "Users can insert own booking sessions" ON booking_sessions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage booking sessions" ON booking_sessions;
CREATE POLICY "Service role can manage booking sessions" ON booking_sessions
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS "Users can view bookings by email" ON bookings;
CREATE POLICY "Users can view bookings by email" ON bookings
    FOR SELECT USING (user_email = (SELECT email FROM auth.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Service role can manage all bookings" ON bookings;
CREATE POLICY "Service role can manage all bookings" ON bookings
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ========================
-- 16. 不正検知・管理
-- ========================

CREATE TABLE IF NOT EXISTS fraud_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    flag_type TEXT,
    severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
    description TEXT,
    resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ip_registration_stats (
    ip_address INET PRIMARY KEY,
    user_count INTEGER DEFAULT 1,
    first_registration TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_registration TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_clicks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referral_code VARCHAR(20) NOT NULL,
    clicked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_agent TEXT,
    referrer TEXT,
    landing_url TEXT,
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_clicks_code ON referral_clicks(referral_code);

-- ========================
-- 17. その他テーブル
-- ========================

CREATE TABLE IF NOT EXISTS search_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    search_query TEXT,
    filters JSONB,
    searched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS share_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    platform TEXT,
    share_url TEXT,
    shared_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL,
    related_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meeting_confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    invitation_id UUID REFERENCES invitations(id),
    meeting_datetime TIMESTAMP WITH TIME ZONE,
    meeting_method TEXT,
    duration_minutes INTEGER,
    verification_methods JSONB,
    meeting_summary TEXT,
    admin_notes TEXT,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tldv_meeting_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id TEXT,
    invitee_email TEXT,
    meeting_date TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,
    is_valid BOOLEAN DEFAULT true,
    recording_url TEXT,
    transcript_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ========================
-- 14b. tl;dv トランスクリプト連携 × AIマッチング
-- ========================

CREATE TABLE IF NOT EXISTS meeting_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tldv_meeting_id TEXT NOT NULL,
    tldv_record_id UUID REFERENCES tldv_meeting_records(id),
    title TEXT,
    meeting_date TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,
    raw_transcript JSONB,
    full_text TEXT,
    language TEXT DEFAULT 'ja',
    word_count INTEGER,
    speaker_count INTEGER,
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'fetching', 'ready', 'analyzing', 'analyzed', 'error')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_transcripts_tldv_id ON meeting_transcripts(tldv_meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_status ON meeting_transcripts(status);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_date ON meeting_transcripts(meeting_date DESC);

CREATE TABLE IF NOT EXISTS meeting_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transcript_id UUID NOT NULL REFERENCES meeting_transcripts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email TEXT,
    speaker_name TEXT,
    speaking_duration_seconds INTEGER,
    speaking_ratio DECIMAL(5,4),
    word_count INTEGER,
    is_linked BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(transcript_id, email)
);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_user ON meeting_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_email ON meeting_participants(email);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_transcript ON meeting_participants(transcript_id);

CREATE TABLE IF NOT EXISTS transcript_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transcript_id UUID NOT NULL REFERENCES meeting_transcripts(id) ON DELETE CASCADE,
    participant_id UUID REFERENCES meeting_participants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    extracted_interests TEXT[] DEFAULT '{}',
    extracted_skills TEXT[] DEFAULT '{}',
    extracted_needs TEXT[] DEFAULT '{}',
    extracted_offerings TEXT[] DEFAULT '{}',
    extracted_industries TEXT[] DEFAULT '{}',
    key_topics TEXT[] DEFAULT '{}',
    sentiment_score DECIMAL(3,2),
    communication_style JSONB,
    expertise_indicators JSONB,
    ai_model TEXT,
    ai_prompt_version TEXT,
    confidence_score DECIMAL(3,2),
    raw_ai_response JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcript_insights_user ON transcript_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_transcript_insights_transcript ON transcript_insights(transcript_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_insights_unique ON transcript_insights(transcript_id, participant_id);

CREATE TABLE IF NOT EXISTS member_ai_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    aggregated_interests TEXT[] DEFAULT '{}',
    aggregated_skills TEXT[] DEFAULT '{}',
    aggregated_needs TEXT[] DEFAULT '{}',
    aggregated_offerings TEXT[] DEFAULT '{}',
    primary_industries TEXT[] DEFAULT '{}',
    communication_profile JSONB DEFAULT '{}',
    expertise_confidence JSONB DEFAULT '{}',
    total_meetings_analyzed INTEGER DEFAULT 0,
    total_speaking_minutes INTEGER DEFAULT 0,
    last_analysis_at TIMESTAMP WITH TIME ZONE,
    profile_version INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_member_ai_profiles_user ON member_ai_profiles(user_id);

CREATE TABLE IF NOT EXISTS matching_scores_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_b_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    profile_score DECIMAL(5,2) DEFAULT 0,
    transcript_score DECIMAL(5,2) DEFAULT 0,
    interaction_score DECIMAL(5,2) DEFAULT 0,
    total_score DECIMAL(5,2) DEFAULT 0,
    match_reasons JSONB DEFAULT '[]',
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_stale BOOLEAN DEFAULT false,
    UNIQUE(user_a_id, user_b_id),
    CHECK (user_a_id < user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_matching_cache_user_a ON matching_scores_cache(user_a_id);
CREATE INDEX IF NOT EXISTS idx_matching_cache_user_b ON matching_scores_cache(user_b_id);
CREATE INDEX IF NOT EXISTS idx_matching_cache_score ON matching_scores_cache(total_score DESC);
CREATE INDEX IF NOT EXISTS idx_matching_cache_stale ON matching_scores_cache(is_stale) WHERE is_stale = true;

CREATE TABLE IF NOT EXISTS meeting_minutes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    meeting_title TEXT,
    meeting_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    summary TEXT,
    content TEXT,
    participants TEXT[],
    topics TEXT[],
    action_items JSONB,
    referral_processed BOOLEAN DEFAULT false,
    referral_invitation_id UUID REFERENCES invitations(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    theme TEXT DEFAULT 'light',
    language TEXT DEFAULT 'ja',
    notifications_enabled BOOLEAN DEFAULT true,
    email_notifications BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES event_items(id) ON DELETE CASCADE,
    participant_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    certificate_number TEXT UNIQUE,
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    certificate_url TEXT,
    UNIQUE(event_id, participant_id)
);

CREATE TABLE IF NOT EXISTS referral_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invitation_id UUID UNIQUE REFERENCES invitations(id),
    referrer_id UUID REFERENCES auth.users(id),
    referred_id UUID REFERENCES auth.users(id),
    meeting_minutes_id UUID REFERENCES meeting_minutes(id),
    referrer_ip INET,
    referred_ip INET,
    same_device_flag BOOLEAN DEFAULT false,
    same_network_flag BOOLEAN DEFAULT false,
    fraud_score DECIMAL(3,2) DEFAULT 0.00,
    fraud_reasons JSONB,
    verification_status VARCHAR(20) DEFAULT 'pending'
        CHECK (verification_status IN ('pending', 'verified', 'rejected', 'flagged')),
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by UUID REFERENCES auth.users(id),
    verification_notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ========================
-- 17b. RLSポリシー（追加分）
-- ========================

-- settings: ユーザーは自分の設定のみ読み書き可能
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own settings" ON settings
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON settings
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON settings
    FOR UPDATE USING (auth.uid() = user_id);

-- search_history: ユーザーは自分の検索履歴のみ
ALTER TABLE search_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own search history" ON search_history
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own search history" ON search_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own search history" ON search_history
    FOR DELETE USING (auth.uid() = user_id);

-- user_activities: ユーザーは自分のアクティビティのみ
ALTER TABLE user_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own activities" ON user_activities
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own activities" ON user_activities
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- share_activities: ユーザーは自分のシェアのみ
ALTER TABLE share_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own shares" ON share_activities
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own shares" ON share_activities
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- event_certificates: ユーザーは自分の証明書のみ
ALTER TABLE event_certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own certificates" ON event_certificates
    FOR SELECT USING (auth.uid() = participant_id);
CREATE POLICY "Service role can insert certificates" ON event_certificates
    FOR INSERT WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- meeting_confirmations: ユーザーは自分のミーティング確認のみ
ALTER TABLE meeting_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own meeting confirmations" ON meeting_confirmations
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own meeting confirmations" ON meeting_confirmations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin can manage meeting confirmations" ON meeting_confirmations;
CREATE POLICY "Admin can manage meeting confirmations" ON meeting_confirmations
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- meeting_minutes: ユーザーは自分の議事録のみ
ALTER TABLE meeting_minutes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own meeting minutes" ON meeting_minutes
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own meeting minutes" ON meeting_minutes
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own meeting minutes" ON meeting_minutes
    FOR UPDATE USING (auth.uid() = user_id);

-- referral_details: ユーザーは自分が関係する紹介詳細のみ
ALTER TABLE referral_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own referral details" ON referral_details
    FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
CREATE POLICY "Users can insert own referral details" ON referral_details
    FOR INSERT WITH CHECK (auth.uid() = referrer_id);

-- fraud_flags: service_role + admin
ALTER TABLE fraud_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only for fraud flags" ON fraud_flags
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
DROP POLICY IF EXISTS "Admin can manage fraud flags" ON fraud_flags;
CREATE POLICY "Admin can manage fraud flags" ON fraud_flags
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- ip_registration_stats: service_role + admin
ALTER TABLE ip_registration_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only for ip stats" ON ip_registration_stats
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
DROP POLICY IF EXISTS "Admin can view ip stats" ON ip_registration_stats;
CREATE POLICY "Admin can view ip stats" ON ip_registration_stats
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- tldv_meeting_records: service_role + admin
ALTER TABLE tldv_meeting_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only for tldv records" ON tldv_meeting_records
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
DROP POLICY IF EXISTS "Admin can manage tldv records" ON tldv_meeting_records;
CREATE POLICY "Admin can manage tldv records" ON tldv_meeting_records
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- referral_clicks: 匿名挿入可、閲覧はservice_roleのみ
ALTER TABLE referral_clicks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert referral clicks" ON referral_clicks
    FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can view referral clicks" ON referral_clicks
    FOR SELECT USING (auth.jwt() ->> 'role' = 'service_role');

-- ========================
-- 18. ビュー
-- ========================

CREATE OR REPLACE VIEW v_referral_history AS
SELECT
    i.id,
    i.inviter_id,
    i.invitee_email,
    i.invitation_code,
    i.custom_message,
    i.status,
    i.points_earned,
    i.sent_at,
    i.accepted_at,
    i.accepted_by,
    i.expires_at,
    p.name AS invitee_name,
    p.company AS invitee_company,
    p.avatar_url AS invitee_avatar
FROM invitations i
LEFT JOIN user_profiles p ON p.id = i.accepted_by;

CREATE OR REPLACE VIEW booking_details AS
SELECT
    b.*,
    bs.session_id,
    bs.session_data,
    p.name AS user_profile_name,
    p.email AS user_profile_email
FROM bookings b
LEFT JOIN booking_sessions bs ON b.session_ref = bs.session_id
LEFT JOIN user_profiles p ON p.email = b.user_email;

CREATE OR REPLACE VIEW booking_stats AS
SELECT
    DATE(scheduled_at) AS booking_date,
    COUNT(*) AS total_bookings,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed_bookings,
    COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled_bookings,
    COUNT(CASE WHEN referral_code IS NOT NULL AND referral_code != 'DIRECT' THEN 1 END) AS referred_bookings
FROM bookings
GROUP BY DATE(scheduled_at)
ORDER BY booking_date DESC;

-- dashboard用集計ビュー
CREATE OR REPLACE VIEW member_growth_stats AS
SELECT
    DATE_TRUNC('month', created_at) AS month,
    COUNT(*) AS new_members,
    SUM(COUNT(*)) OVER (ORDER BY DATE_TRUNC('month', created_at)) AS total_members
FROM user_profiles
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;

CREATE OR REPLACE VIEW industry_distribution AS
SELECT
    COALESCE(industry, 'その他') AS industry,
    COUNT(*) AS count
FROM user_profiles
WHERE is_active = true
GROUP BY industry
ORDER BY count DESC;

-- イベント統計ビュー（dashboard-unified.js チャート用）
CREATE OR REPLACE VIEW event_stats AS
SELECT
    DATE_TRUNC('week', event_date) AS week,
    event_type,
    COUNT(*) AS event_count,
    COALESCE(SUM(max_participants), 0) AS total_capacity
FROM event_items
WHERE is_cancelled = false
GROUP BY DATE_TRUNC('week', event_date), event_type
ORDER BY week DESC;

CREATE OR REPLACE VIEW referral_statistics AS
SELECT
    il.link_code,
    il.description,
    il.created_by AS inviter_id,
    p.email AS inviter_email,
    COUNT(DISTINCT rc.id) AS click_count,
    COUNT(DISTINCT i.id) AS registration_count,
    COUNT(DISTINCT b.id) AS booking_count,
    COALESCE(SUM(pt.points), 0) AS total_points_earned,
    il.created_at AS link_created_at
FROM invite_links il
LEFT JOIN user_profiles p ON p.id = il.created_by
LEFT JOIN referral_clicks rc ON rc.referral_code = il.link_code
LEFT JOIN invitations i ON i.invitation_code = il.link_code
LEFT JOIN bookings b ON b.referral_code = il.link_code
LEFT JOIN point_transactions pt ON pt.referral_code = il.link_code
WHERE il.is_active = true
GROUP BY il.id, il.link_code, il.description, il.created_by, p.email, il.created_at
ORDER BY il.created_at DESC;

-- ========================
-- 19. RPC関数
-- ========================

-- 紹介統計取得
DROP FUNCTION IF EXISTS get_referral_stats(UUID);
CREATE OR REPLACE FUNCTION get_referral_stats(p_user_id UUID)
RETURNS TABLE(
    available_points INTEGER,
    total_points_earned INTEGER,
    total_referrals INTEGER,
    successful_referrals INTEGER,
    conversion_rate NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH user_stats AS (
        SELECT
            COALESCE(up.available_points, 0) AS available_points,
            COALESCE(up.total_earned, 0) AS total_points_earned
        FROM user_points up
        WHERE up.user_id = p_user_id
    ),
    referral_stats AS (
        SELECT
            COUNT(*) AS total_referrals,
            COUNT(CASE WHEN i.status IN ('completed', 'registered') THEN 1 END) AS successful_referrals
        FROM invitations i
        WHERE i.inviter_id = p_user_id
    )
    SELECT
        COALESCE((SELECT us.available_points FROM user_stats us), 0)::INTEGER,
        COALESCE((SELECT us.total_points_earned FROM user_stats us), 0)::INTEGER,
        COALESCE((SELECT rs.total_referrals FROM referral_stats rs), 0)::INTEGER,
        COALESCE((SELECT rs.successful_referrals FROM referral_stats rs), 0)::INTEGER,
        CASE
            WHEN (SELECT rs.total_referrals FROM referral_stats rs) > 0
            THEN ROUND(((SELECT rs.successful_referrals FROM referral_stats rs)::NUMERIC
                / (SELECT rs.total_referrals FROM referral_stats rs)) * 100, 2)
            ELSE 0
        END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 紹介ポイント付与
DROP FUNCTION IF EXISTS add_referral_points(TEXT, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS add_referral_points(UUID, INTEGER, TEXT, TEXT);
CREATE OR REPLACE FUNCTION add_referral_points(
    p_referral_code TEXT,
    p_points INTEGER,
    p_reason TEXT,
    p_booking_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    inviter_user_id UUID;
BEGIN
    SELECT created_by INTO inviter_user_id
    FROM invite_links
    WHERE link_code = p_referral_code
    AND is_active = true
    LIMIT 1;

    IF inviter_user_id IS NULL THEN
        RETURN;
    END IF;

    -- user_pointsを更新（存在しなければ作成）
    INSERT INTO user_points (user_id, total_earned, balance, available_points, referral_points_earned)
    VALUES (inviter_user_id, p_points, p_points, p_points, p_points)
    ON CONFLICT (user_id) DO UPDATE SET
        total_earned = user_points.total_earned + p_points,
        balance = user_points.balance + p_points,
        available_points = user_points.available_points + p_points,
        referral_points_earned = user_points.referral_points_earned + p_points,
        updated_at = NOW();

    -- トランザクション記録
    INSERT INTO point_transactions (user_id, points, reason, booking_id, referral_code)
    VALUES (inviter_user_id, p_points, p_reason, p_booking_id, p_referral_code);
END;
$$;

-- ユーザーポイント減算（キャッシュアウト用）
CREATE OR REPLACE FUNCTION deduct_user_points(p_user_id UUID, p_amount INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE user_points
    SET balance = balance - p_amount,
        available_points = available_points - p_amount,
        referral_points_spent = referral_points_spent + p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id
    AND available_points >= p_amount;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ポイント残高が不足しています';
    END IF;
END;
$$;

-- 招待作成
CREATE OR REPLACE FUNCTION create_invitation(
    p_inviter_id UUID,
    p_invitee_email TEXT,
    p_custom_message TEXT DEFAULT NULL,
    p_invite_link_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_invitation_id UUID;
    v_invitation_code TEXT;
BEGIN
    v_invitation_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT), 1, 6));

    IF EXISTS (
        SELECT 1 FROM invitations
        WHERE inviter_id = p_inviter_id
        AND invitee_email = p_invitee_email
        AND status = 'pending'
        AND (expires_at IS NULL OR expires_at > NOW())
    ) THEN
        RAISE EXCEPTION '既にこのメールアドレスに対する有効な招待が存在します';
    END IF;

    INSERT INTO invitations (
        inviter_id, invitee_email, invitation_code, custom_message,
        invite_link_id, status, sent_at, expires_at
    ) VALUES (
        p_inviter_id, p_invitee_email, v_invitation_code, p_custom_message,
        p_invite_link_id, 'pending', NOW(), NOW() + INTERVAL '30 days'
    ) RETURNING id INTO v_invitation_id;

    IF p_invite_link_id IS NOT NULL THEN
        UPDATE invite_links SET used_count = used_count + 1 WHERE id = p_invite_link_id;
    END IF;

    RETURN v_invitation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 招待承認
CREATE OR REPLACE FUNCTION accept_invitation(p_invitation_code TEXT, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_invitation RECORD;
BEGIN
    SELECT * INTO v_invitation
    FROM invitations
    WHERE invitation_code = p_invitation_code
    AND status = 'pending'
    AND (expires_at IS NULL OR expires_at > NOW());

    IF NOT FOUND THEN
        RAISE EXCEPTION '有効な招待が見つかりません';
    END IF;

    UPDATE invitations
    SET status = 'registered', accepted_at = NOW(), accepted_by = p_user_id, registered_at = NOW()
    WHERE id = v_invitation.id;

    INSERT INTO notifications (user_id, type, title, message, data)
    VALUES (
        v_invitation.inviter_id,
        'referral_accepted',
        '紹介が承認されました',
        v_invitation.invitee_email || 'さんが登録しました',
        jsonb_build_object('invitation_id', v_invitation.id, 'invitee_email', v_invitation.invitee_email)
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================
-- 19b. 追加RPC関数（管理画面用）
-- ========================

-- トップ紹介者を取得（admin-referral-bundle.js用）
CREATE OR REPLACE FUNCTION get_top_referrers(limit_count INTEGER DEFAULT 10)
RETURNS TABLE(
    user_id UUID,
    user_name TEXT,
    user_email TEXT,
    user_company TEXT,
    total_referrals BIGINT,
    successful_referrals BIGINT,
    total_points_earned INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        up.id AS user_id,
        up.name AS user_name,
        up.email AS user_email,
        up.company AS user_company,
        COUNT(i.id) AS total_referrals,
        COUNT(CASE WHEN i.status IN ('registered', 'completed') THEN 1 END) AS successful_referrals,
        COALESCE(upt.total_earned, 0) AS total_points_earned
    FROM user_profiles up
    INNER JOIN invitations i ON i.inviter_id = up.id
    LEFT JOIN user_points upt ON upt.user_id = up.id
    GROUP BY up.id, up.name, up.email, up.company, upt.total_earned
    ORDER BY total_referrals DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 紹介分析データ取得（admin-referral-bundle.js用）
CREATE OR REPLACE FUNCTION get_referral_analytics(start_date DATE, end_date DATE)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'daily_referrals', (
            SELECT json_agg(row_to_json(dr))
            FROM (
                SELECT DATE(created_at) AS date, COUNT(*) AS count
                FROM invitations
                WHERE DATE(created_at) BETWEEN start_date AND end_date
                GROUP BY DATE(created_at)
                ORDER BY date
            ) dr
        ),
        'total_referrals', (
            SELECT COUNT(*) FROM invitations
            WHERE DATE(created_at) BETWEEN start_date AND end_date
        ),
        'successful_referrals', (
            SELECT COUNT(*) FROM invitations
            WHERE DATE(created_at) BETWEEN start_date AND end_date
            AND status IN ('registered', 'completed')
        ),
        'total_points_awarded', (
            SELECT COALESCE(SUM(points), 0) FROM point_transactions
            WHERE DATE(created_at) BETWEEN start_date AND end_date
        )
    ) INTO result;
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 管理者ポイント付与（admin-referral-bundle.js用）
CREATE OR REPLACE FUNCTION add_user_points(p_user_id UUID, p_amount INTEGER)
RETURNS VOID AS $$
BEGIN
    INSERT INTO user_points (user_id, total_earned, balance, available_points)
    VALUES (p_user_id, p_amount, p_amount, p_amount)
    ON CONFLICT (user_id) DO UPDATE SET
        total_earned = user_points.total_earned + p_amount,
        balance = user_points.balance + p_amount,
        available_points = user_points.available_points + p_amount,
        updated_at = NOW();

    INSERT INTO point_transactions (user_id, points, reason)
    VALUES (p_user_id, p_amount, '管理者によるポイント付与');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 紹介報酬処理（admin-referral-bundle.js用）
CREATE OR REPLACE FUNCTION process_referral_reward(p_invitation_id UUID)
RETURNS JSON AS $$
DECLARE
    v_invitation RECORD;
    v_reward_points INTEGER := 1000;
BEGIN
    SELECT * INTO v_invitation FROM invitations WHERE id = p_invitation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION '招待が見つかりません';
    END IF;

    -- 招待ステータスを更新
    UPDATE invitations
    SET status = 'completed',
        reward_status = 'earned',
        reward_earned_at = NOW(),
        meeting_completed_at = NOW(),
        points_earned = v_reward_points
    WHERE id = p_invitation_id;

    -- 紹介者にポイントを付与
    INSERT INTO user_points (user_id, total_earned, balance, available_points, referral_points_earned)
    VALUES (v_invitation.inviter_id, v_reward_points, v_reward_points, v_reward_points, v_reward_points)
    ON CONFLICT (user_id) DO UPDATE SET
        total_earned = user_points.total_earned + v_reward_points,
        balance = user_points.balance + v_reward_points,
        available_points = user_points.available_points + v_reward_points,
        referral_points_earned = user_points.referral_points_earned + v_reward_points,
        updated_at = NOW();

    -- トランザクション記録
    INSERT INTO point_transactions (user_id, points, reason)
    VALUES (v_invitation.inviter_id, v_reward_points, '紹介報酬（面談完了）');

    RETURN json_build_object('success', true, 'points_awarded', v_reward_points);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================
-- 20. 新規ユーザー作成トリガー
-- ========================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (id, member_id, email, name, full_name, created_at, updated_at)
    VALUES (
        NEW.id,
        'IC-' || LPAD(nextval('member_id_seq')::TEXT, 5, '0'),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO settings (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO user_points (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ========================
-- 21. ストレージバケット
-- ========================

INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('covers', 'covers', true) ON CONFLICT DO NOTHING;

-- ストレージRLS
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
CREATE POLICY "Avatar images are publicly accessible" ON storage.objects
    FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
CREATE POLICY "Users can upload own avatar" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
CREATE POLICY "Users can update own avatar" ON storage.objects
    FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Cover images are publicly accessible" ON storage.objects;
CREATE POLICY "Cover images are publicly accessible" ON storage.objects
    FOR SELECT USING (bucket_id = 'covers');

DROP POLICY IF EXISTS "Users can upload own cover" ON storage.objects;
CREATE POLICY "Users can upload own cover" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'covers' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ========================
-- 22. contact_inquiries（お問い合わせ）
-- ========================

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

CREATE POLICY "Anyone can submit inquiries" ON contact_inquiries
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can view inquiries" ON contact_inquiries
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

CREATE POLICY "Admins can update inquiries" ON contact_inquiries
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- ========================
-- 23. news_items（ニュース/お知らせ）
-- ========================

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

CREATE POLICY "Published news visible to all" ON news_items
    FOR SELECT USING (is_published = true);

CREATE POLICY "Admins can manage news" ON news_items
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- ========================
-- 24. site_settings（サイト設定キーバリュー）
-- ========================

CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Site settings readable by all" ON site_settings
    FOR SELECT USING (true);

CREATE POLICY "Admins can update site settings" ON site_settings
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- ========================
-- 25. login_sessions（ログイン履歴）
-- ========================

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

CREATE POLICY "Users can view own sessions" ON login_sessions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions" ON login_sessions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ========================
-- 26. faqs（よくある質問）
-- ========================

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

CREATE POLICY "Published FAQs visible to all" ON faqs
    FOR SELECT USING (is_published = true);

CREATE POLICY "Admins can manage FAQs" ON faqs
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- ========================
-- 27. case_studies（成功事例）
-- ========================

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

CREATE POLICY "Published case studies visible to all" ON case_studies
    FOR SELECT USING (is_published = true);

CREATE POLICY "Admins can manage case studies" ON case_studies
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- ========================
-- 28. 権限付与
-- ========================

-- ========================
-- マッチングスコア計算用 追加ポリシー・関数
-- ========================

-- member_ai_profilesの公開データ取得関数（SECURITY DEFINERでRLSバイパス）
-- ニーズ・弱点・コミュニケーション詳細を除外し、提供価値とスキルのみ返す
CREATE OR REPLACE FUNCTION get_public_ai_profiles()
RETURNS TABLE (
    user_id UUID,
    aggregated_skills TEXT[],
    aggregated_offerings TEXT[],
    aggregated_interests TEXT[],
    primary_industries TEXT[],
    total_meetings_analyzed INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.user_id,
        m.aggregated_skills,
        m.aggregated_offerings,
        m.aggregated_interests,
        m.primary_industries,
        m.total_meetings_analyzed
    FROM member_ai_profiles m
    INNER JOIN user_profiles u ON u.id = m.user_id
    WHERE u.is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- プロフィール更新時にマッチングキャッシュを無効化するRPC
CREATE OR REPLACE FUNCTION mark_matching_cache_stale(p_user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE matching_scores_cache
  SET is_stale = true
  WHERE user_a_id = p_user_id OR user_b_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION get_referral_stats(UUID) TO authenticated;
-- ★3 Fix: add_referral_points は service_role 専用（一般ユーザーへのGRANT削除）
-- deduct_user_points: admin/service_role専用（Fix C1で一般ユーザーへのGRANT削除）
GRANT EXECUTE ON FUNCTION create_invitation(UUID, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_invitation(TEXT, UUID) TO authenticated;
GRANT SELECT ON v_referral_history TO authenticated;
GRANT SELECT ON booking_details TO authenticated;
GRANT SELECT ON booking_stats TO authenticated;
GRANT SELECT ON member_growth_stats TO authenticated;
GRANT SELECT ON industry_distribution TO authenticated;
GRANT SELECT ON referral_statistics TO authenticated;
GRANT SELECT ON matchings TO authenticated;
GRANT SELECT ON profiles TO authenticated;
GRANT SELECT ON events TO authenticated;
GRANT SELECT ON event_stats TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_referrers(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_referral_analytics(DATE, DATE) TO authenticated;
-- add_user_points, deduct_user_points, process_referral_reward は
-- admin専用。一般ユーザーからの直接呼出を禁止。
-- admin-referral-bundle.js はis_admin=trueのユーザーのみが使用する画面だが、
-- RPC自体にはauth.uid()チェックがないため、GRANTレベルで制限する。
-- 注: 以下のREVOKEはFix C1（2026-03-27）で追加
GRANT EXECUTE ON FUNCTION mark_matching_cache_stale(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_public_ai_profiles() TO authenticated;

-- 同意撤回時のAI分析データ削除（GDPR対応）
CREATE OR REPLACE FUNCTION purge_ai_analysis_data(p_user_id UUID)
RETURNS void AS $$
BEGIN
  -- 本人のみ実行可能（auth.uid()チェック）
  IF auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  DELETE FROM transcript_insights WHERE user_id = p_user_id;
  DELETE FROM member_ai_profiles WHERE user_id = p_user_id;
  UPDATE matching_scores_cache SET is_stale = true
    WHERE user_a_id = p_user_id OR user_b_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION purge_ai_analysis_data(UUID) TO authenticated;
