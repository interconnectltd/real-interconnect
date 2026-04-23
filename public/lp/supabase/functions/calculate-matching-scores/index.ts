import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SUPABASE_JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET') ?? ''

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function verifyServiceRoleJWT(token: string): Promise<boolean> {
  try {
    if (!SUPABASE_JWT_SECRET) return false
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(SUPABASE_JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const sig = parts[2].replace(/-/g, '+').replace(/_/g, '/')
    const padded = sig + '='.repeat((4 - sig.length % 4) % 4)
    const sigBytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0))
    const data = encoder.encode(parts[0] + '.' + parts[1])
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, data)
    if (!valid) return false
    const payload = JSON.parse(atob(parts[1]))
    if (payload.role !== 'service_role') return false
    if (payload.exp && Date.now() / 1000 > payload.exp) return false
    return true
  } catch { return false }
}

// ============================================================
// challengeSkillMapping: matching-bundle.js と統一
// ============================================================
const challengeSkillMapping: Record<string, { requiredSkills: string[], weight: number }> = {
  '新規顧客獲得': { requiredSkills: ['デジタルマーケティング', 'SNSマーケティング', 'SEO/SEM', 'コンテンツマーケティング', 'ブランディング', 'PR・広報'], weight: 30 },
  '既存顧客単価': { requiredSkills: ['CRM', 'データ分析', 'マーケティング分析', '商品企画', 'サービス開発', 'プロダクトマネジメント'], weight: 25 },
  '市場シェア拡大': { requiredSkills: ['市場開拓', '事業開発', '経営戦略立案', 'M&A戦略', '事業提携・アライアンス'], weight: 30 },
  'リピート率向上': { requiredSkills: ['CRM', 'カスタマーサクセス', 'データ分析', 'マーケティング分析', 'UXデザイン'], weight: 25 },
  '新規事業開発': { requiredSkills: ['新規事業開発', '事業計画策定', 'ビジネスモデル構築', '市場開拓', 'プロダクトマネジメント'], weight: 35 },
  '人材採用': { requiredSkills: ['人材開発', '組織開発', '採用', 'HRテック', '評価制度'], weight: 25 },
  '人材育成': { requiredSkills: ['人材開発', '組織開発', 'コーチング', 'マネジメント', '研修設計'], weight: 20 },
  '組織文化': { requiredSkills: ['組織変革', '組織開発', 'ビジョン構築', 'チームビルディング', 'ファシリテーション'], weight: 25 },
  '離職防止': { requiredSkills: ['組織文化', '評価制度', '人事制度', 'エンゲージメント', '福利厚生設計'], weight: 25 },
  '評価制度': { requiredSkills: ['人事評価制度', '組織開発', 'KPI設計', 'データ分析', '目標管理'], weight: 20 },
  'DX推進': { requiredSkills: ['DX推進', 'AI・機械学習', 'IoT', 'クラウド', 'ビッグデータ', 'システム設計'], weight: 35 },
  '業務自動化': { requiredSkills: ['RPA', 'AI・機械学習', 'システム設計', 'プロセス改善', 'BPR'], weight: 30 },
  'システム統合': { requiredSkills: ['システム設計', 'クラウド', 'API開発', 'データベース設計', 'セキュリティ'], weight: 25 },
  'データ活用': { requiredSkills: ['ビッグデータ', 'データ分析', 'BI', 'データサイエンス', 'マーケティング分析'], weight: 30 },
  'セキュリティ': { requiredSkills: ['サイバーセキュリティ', 'セキュリティ', 'リスクマネジメント', 'コンプライアンス', 'ISMS'], weight: 25 },
  '差別化戦略': { requiredSkills: ['経営戦略立案', 'ブランディング', 'マーケティング戦略', 'プロダクト戦略', '競合分析'], weight: 30 },
  'ブランディング': { requiredSkills: ['ブランディング', 'PR・広報', 'マーケティング', 'コンテンツマーケティング', 'デザイン思考'], weight: 25 },
  '海外展開': { requiredSkills: ['海外事業', 'グローバル展開', '国際ビジネス', '多言語対応', 'クロスカルチャー'], weight: 30 },
  'パートナーシップ': { requiredSkills: ['事業提携・アライアンス', 'パートナーシップ構築', 'ネゴシエーション', '契約交渉', 'リレーション構築'], weight: 25 },
  'Web集客・SNS活用': { requiredSkills: ['SNSマーケティング', 'デジタルマーケティング', 'SEO/SEM', 'コンテンツマーケティング', 'Web制作'], weight: 25 },
  '営業力強化': { requiredSkills: ['営業戦略', 'セールス', 'CRM', 'ネゴシエーション', 'プレゼンテーション'], weight: 25 },
  'マネジメント育成': { requiredSkills: ['マネジメント', 'コーチング', 'リーダーシップ', '組織開発', '人材開発'], weight: 25 },
  '業務プロセス改善': { requiredSkills: ['BPR', 'プロセス改善', 'リーン', 'シックスシグマ', 'プロジェクトマネジメント'], weight: 25 },
  'AI・自動化': { requiredSkills: ['AI・機械学習', 'RPA', 'データサイエンス', 'システム設計', 'DX推進'], weight: 30 },
  '資金調達': { requiredSkills: ['資金調達', 'ファイナンス', '事業計画策定', 'VC交渉', '財務戦略'], weight: 30 },
  '事業承継': { requiredSkills: ['M&A戦略', '事業承継', '経営戦略立案', '組織変革', '法務'], weight: 30 },
  '法務・コンプライアンス': { requiredSkills: ['コンプライアンス', '法務', 'リスクマネジメント', '契約交渉', '知的財産'], weight: 20 },
}

const skillValueMap: Record<string, { value: number, rarity: number, demand: number }> = {
  'AI・機械学習': { value: 95, rarity: 90, demand: 95 },
  'ブロックチェーン': { value: 85, rarity: 85, demand: 80 },
  'データサイエンス': { value: 90, rarity: 80, demand: 90 },
  'データ分析': { value: 85, rarity: 70, demand: 90 },
  'ビッグデータ': { value: 85, rarity: 75, demand: 85 },
  'M&A戦略': { value: 85, rarity: 90, demand: 75 },
  'IoT': { value: 80, rarity: 75, demand: 80 },
  'DX推進': { value: 90, rarity: 70, demand: 95 },
  'サイバーセキュリティ': { value: 85, rarity: 80, demand: 90 },
  'デジタルマーケティング': { value: 75, rarity: 60, demand: 85 },
  'プロダクトマネジメント': { value: 75, rarity: 65, demand: 80 },
  'システム設計': { value: 75, rarity: 65, demand: 75 },
  'ブランディング': { value: 70, rarity: 55, demand: 75 },
  'SNSマーケティング': { value: 65, rarity: 50, demand: 75 },
  'SEO/SEM': { value: 65, rarity: 55, demand: 70 },
  'CRM': { value: 70, rarity: 60, demand: 75 },
  '事業開発': { value: 75, rarity: 65, demand: 75 },
  '経営戦略立案': { value: 75, rarity: 70, demand: 70 },
  '人材開発': { value: 70, rarity: 60, demand: 75 },
  '組織開発': { value: 70, rarity: 65, demand: 70 },
}
const DEFAULT_SKILL_VALUE = { value: 50, rarity: 50, demand: 50 }

// ============================================================
// ヘルパー関数
// ============================================================

function normalizeSkills(skills: any): string[] {
  if (Array.isArray(skills)) return skills
  if (typeof skills === 'string') return skills.split(',').map((s: string) => s.trim()).filter(Boolean)
  return []
}

function normalizeChallenges(bc: any): string[] {
  if (!bc) return []
  if (Array.isArray(bc)) return bc
  if (typeof bc === 'object' && Array.isArray(bc.challenges)) return bc.challenges
  if (typeof bc === 'string') return bc.split(',').map((s: string) => s.trim())
  return []
}

function calculateSkillQuality(skills: string[]): number {
  if (skills.length === 0) return 0
  let totalValue = 0, totalRarity = 0, totalDemand = 0
  for (const skill of skills) {
    const sv = skillValueMap[skill] ?? DEFAULT_SKILL_VALUE
    totalValue += sv.value
    totalRarity += sv.rarity
    totalDemand += sv.demand
  }
  const n = skills.length
  return Math.round((totalValue / n) * 0.3 + (totalRarity / n) * 0.2 + (totalDemand / n) * 0.5)
}

// ============================================================
// profile_score: matching-bundle.js と同一ロジック
// ============================================================
function computeProfileScore(
  userA: any, userB: any
): { score: number, reasons: any[] } {
  const reasons: any[] = []

  const aSkills = normalizeSkills(userA.skills)
  const bSkills = normalizeSkills(userB.skills)
  const aChallenges = normalizeChallenges(userA.business_challenges)
  const bChallenges = normalizeChallenges(userB.business_challenges)

  // --- 補完性 (最大50pt) ---
  let aHelpsBScore = 0, aHelpsBCount = 0
  let bHelpsAScore = 0, bHelpsACount = 0
  const topDetails: any[] = []

  for (const ch of bChallenges) {
    const m = challengeSkillMapping[ch]
    if (!m) continue
    const matched = aSkills.filter(s => m.requiredSkills.includes(s))
    if (matched.length > 0) {
      const rate = matched.length / m.requiredSkills.length
      aHelpsBScore += rate * m.weight
      aHelpsBCount++
      topDetails.push({ type: 'needs_match', challenge: ch, skills: matched, rate: Math.round(rate * 100), direction: 'A→B' })
    }
  }
  for (const ch of aChallenges) {
    const m = challengeSkillMapping[ch]
    if (!m) continue
    const matched = bSkills.filter(s => m.requiredSkills.includes(s))
    if (matched.length > 0) {
      const rate = matched.length / m.requiredSkills.length
      bHelpsAScore += rate * m.weight
      bHelpsACount++
      topDetails.push({ type: 'needs_match', challenge: ch, skills: matched, rate: Math.round(rate * 100), direction: 'B→A' })
    }
  }

  const aHelpsB = aHelpsBCount > 0 ? Math.min(100, (aHelpsBScore / aHelpsBCount) * 3) : 0
  const bHelpsA = bHelpsACount > 0 ? Math.min(100, (bHelpsAScore / bHelpsACount) * 3) : 0
  const average = (aHelpsB + bHelpsA) / 2
  const balance = 100 - Math.abs(aHelpsB - bHelpsA)
  const hasBidirectional = aHelpsB > 0 && bHelpsA > 0
  const qualityBonus = ((calculateSkillQuality(aSkills) + calculateSkillQuality(bSkills)) / 200) * 20
  const complementarityScore = hasBidirectional
    ? (average * 0.6 + balance * 0.2 + qualityBonus)
    : (average * 0.4 + qualityBonus)

  let score = (complementarityScore * 0.5) || 0

  // 理由を追加（上位2つ）
  topDetails.sort((a, b) => b.rate - a.rate)
  for (const d of topDetails.slice(0, 2)) {
    const dirLabel = d.direction === 'A→B' ? 'スキルが相手の課題に合致' : '相手のスキルがあなたの課題に合致'
    reasons.push({ type: 'needs_match', label: `${d.challenge}: ${dirLabel}`, score: d.rate })
  }

  // --- スキル重複 (最大20pt) ---
  if (aSkills.length > 0 && bSkills.length > 0) {
    const common = aSkills.filter(s => bSkills.includes(s))
    if (common.length > 0) {
      score += Math.min((common.length / Math.max(aSkills.length, 1)) * 20, 20)
      reasons.push({ type: 'skill_overlap', label: `共通スキル: ${common.slice(0, 3).join('、')}`, score: Math.round((common.length / aSkills.length) * 100) })
    }
  }

  // --- 興味重複 (最大15pt) ---
  const aInterests = normalizeSkills(userA.interests)
  const bInterests = normalizeSkills(userB.interests)
  if (aInterests.length > 0 && bInterests.length > 0) {
    const common = aInterests.filter(i => bInterests.includes(i))
    if (common.length > 0) {
      score += Math.min((common.length / Math.max(aInterests.length, 1)) * 15, 15)
      reasons.push({ type: 'interest_overlap', label: `共通の興味: ${common.slice(0, 2).join('、')}`, score: Math.round((common.length / aInterests.length) * 100) })
    }
  }

  // --- 業界 (10pt) ---
  if (userA.industry && userB.industry && userA.industry === userB.industry) {
    score += 10
    reasons.push({ type: 'industry', label: `同じ業界: ${userA.industry}`, score: 100 })
  }

  // --- 地域 (5pt) ---
  if (userA.location && userB.location && userA.location === userB.location) {
    score += 5
    reasons.push({ type: 'location', label: `同じ地域: ${userA.location}`, score: 100 })
  }

  return { score: Math.min(Math.round(score), 100), reasons }
}

// ============================================================
// transcript_score: AI分析ベースのスコア
// ============================================================
function computeTranscriptScore(
  aiA: any | null, aiB: any | null
): { score: number, reasons: any[] } {
  if (!aiA && !aiB) return { score: 0, reasons: [] }
  const reasons: any[] = []
  let score = 0

  const needsA = aiA?.aggregated_needs ?? []
  const needsB = aiB?.aggregated_needs ?? []
  const offeringsA = aiA?.aggregated_offerings ?? []
  const offeringsB = aiB?.aggregated_offerings ?? []
  const skillsA = aiA?.aggregated_skills ?? []
  const skillsB = aiB?.aggregated_skills ?? []
  const interestsA = aiA?.aggregated_interests ?? []
  const interestsB = aiB?.aggregated_interests ?? []

  // --- ニーズ↔提供一致 (40%) ---
  let needsOfferScore = 0
  // AのニーズにBの提供が一致
  if (needsA.length > 0 && offeringsB.length > 0) {
    const matched = needsA.filter((n: string) =>
      offeringsB.some((o: string) => o.includes(n) || n.includes(o))
    )
    needsOfferScore += matched.length / Math.max(needsA.length, 1)
    if (matched.length > 0) {
      reasons.push({ type: 'ai_needs_offer', label: `AI分析: ${matched[0]}のニーズに対応可能`, score: Math.round((matched.length / needsA.length) * 100) })
    }
  }
  // BのニーズにAの提供が一致
  if (needsB.length > 0 && offeringsA.length > 0) {
    const matched = needsB.filter((n: string) =>
      offeringsA.some((o: string) => o.includes(n) || n.includes(o))
    )
    needsOfferScore += matched.length / Math.max(needsB.length, 1)
  }
  score += (needsOfferScore / 2) * 40

  // --- AIスキル補完 (25%) ---
  let aiSkillScore = 0
  if (skillsB.length > 0 && needsA.length > 0) {
    for (const need of needsA) {
      const mapping = challengeSkillMapping[need]
      if (!mapping) continue
      const matched = skillsB.filter((s: string) => mapping.requiredSkills.includes(s))
      if (matched.length > 0) {
        aiSkillScore += (matched.length / mapping.requiredSkills.length)
        if (reasons.filter(r => r.type === 'ai_skill').length < 1) {
          reasons.push({ type: 'ai_skill', label: `AI分析: ${matched[0]}の専門性がニーズに一致`, score: Math.round((matched.length / mapping.requiredSkills.length) * 100) })
        }
      }
    }
  }
  if (skillsA.length > 0 && needsB.length > 0) {
    for (const need of needsB) {
      const mapping = challengeSkillMapping[need]
      if (!mapping) continue
      const matched = skillsA.filter((s: string) => mapping.requiredSkills.includes(s))
      if (matched.length > 0) aiSkillScore += (matched.length / mapping.requiredSkills.length)
    }
  }
  const totalNeeds = needsA.length + needsB.length
  if (totalNeeds > 0) score += Math.min((aiSkillScore / totalNeeds) * 25, 25)

  // --- コミュニケーション互換 (15%) ---
  const commA = aiA?.communication_profile
  const commB = aiB?.communication_profile
  if (commA && commB) {
    const keys = ['assertiveness', 'detail_orientation', 'collaboration', 'formality', 'energy']
    let compatScore = 0
    for (const key of keys) {
      const va = commA[key] ?? 0.5
      const vb = commB[key] ?? 0.5
      // collaborationは近い方が良い、assertivenessは補完的が良い
      if (key === 'collaboration' || key === 'detail_orientation') {
        compatScore += 1 - Math.abs(va - vb) // 近いほど高い
      } else {
        compatScore += 0.5 + Math.abs(va - vb) * 0.5 // 補完的もOK
      }
    }
    const commScore = (compatScore / keys.length) * 15
    score += commScore
    if (commScore > 8) {
      reasons.push({ type: 'communication', label: 'コミュニケーションスタイルが補完的', score: Math.round(commScore / 15 * 100) })
    }
  }

  // --- 興味収束 (10%) ---
  if (interestsA.length > 0 && interestsB.length > 0) {
    const common = interestsA.filter((i: string) => interestsB.includes(i))
    const jaccard = common.length / (new Set([...interestsA, ...interestsB]).size)
    score += jaccard * 10
  }

  // --- 専門深度 (10%) ---
  const expA = aiA?.expertise_confidence ?? {}
  const expB = aiB?.expertise_confidence ?? {}
  let expertiseScore = 0
  // Bの専門性がAのニーズに合致
  for (const need of needsA) {
    for (const [topic, conf] of Object.entries(expB)) {
      if (topic.includes(need) || need.includes(topic)) {
        expertiseScore += (conf as number)
      }
    }
  }
  for (const need of needsB) {
    for (const [topic, conf] of Object.entries(expA)) {
      if (topic.includes(need) || need.includes(topic)) {
        expertiseScore += (conf as number)
      }
    }
  }
  score += Math.min(expertiseScore * 5, 10)

  return { score: Math.min(Math.round(score), 100), reasons }
}

// ============================================================
// interaction_score: 共同ミーティング実績
// ============================================================
function computeInteractionScore(
  sharedMeetingCount: number
): { score: number, reasons: any[] } {
  if (sharedMeetingCount === 0) return { score: 0, reasons: [] }

  // 逓減報酬: 1回目30pt, 2回目+20pt, 3回目+10pt, 以降+5pt
  let score = 0
  for (let i = 0; i < sharedMeetingCount; i++) {
    if (i === 0) score += 30
    else if (i === 1) score += 20
    else if (i === 2) score += 10
    else score += 5
  }
  score = Math.min(score, 100)

  return {
    score,
    reasons: [{ type: 'shared_meeting', label: `過去${sharedMeetingCount}回のミーティングで共同参加`, score }]
  }
}

// ============================================================
// total_score: 適応的重み付け
// ============================================================
function computeTotalScore(
  profileScore: number, transcriptScore: number, interactionScore: number,
  hasAiA: boolean, hasAiB: boolean
): number {
  if (hasAiA && hasAiB) {
    return Math.round(profileScore * 0.35 + transcriptScore * 0.45 + interactionScore * 0.20)
  } else if (hasAiA || hasAiB) {
    return Math.round(profileScore * 0.60 + transcriptScore * 0.25 + interactionScore * 0.15)
  } else {
    return Math.round(profileScore * 0.85 + interactionScore * 0.15)
  }
}

// ============================================================
// メインハンドラー
// ============================================================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type'
      }
    })
  }

  try {
    // 認証: 署名検証済みservice_role JWT または admin ユーザー
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }
    const token = authHeader.replace('Bearer ', '')
    const isServiceRole = await verifyServiceRoleJWT(token)

    if (!isServiceRole) {
      // admin チェック（Supabaseサーバー側でトークン検証）
      const { data: { user } } = await supabase.auth.getUser(token)
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      }
      const { data: profile } = await supabase.from('user_profiles').select('is_admin').eq('id', user.id).maybeSingle()
      if (!profile?.is_admin) {
        return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
      }
    }

    const body = await req.json()
    const mode = body.mode ?? 'users' // 'users' | 'stale' | 'full'
    const userIds: string[] = body.user_ids ?? []

    console.log(`[calculate-matching-scores] mode=${mode}, userIds=${userIds.length}`)

    // ============================================================
    // 1. 全アクティブユーザープロフィール取得
    // ============================================================
    const { data: allProfiles, error: profError } = await supabase
      .from('user_profiles')
      .select('id, name, skills, interests, business_challenges, industry, location, transcript_analysis_consent')
      .eq('is_active', true)

    if (profError || !allProfiles) {
      return new Response(JSON.stringify({ error: 'Failed to fetch profiles', detail: profError?.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    const profileMap: Record<string, any> = {}
    for (const p of allProfiles) profileMap[p.id] = p

    // ============================================================
    // 2. 全 member_ai_profiles 取得
    // ============================================================
    const { data: aiProfiles } = await supabase
      .from('member_ai_profiles')
      .select('*')

    const aiMap: Record<string, any> = {}
    if (aiProfiles) {
      for (const a of aiProfiles) aiMap[a.user_id] = a
    }

    // ============================================================
    // 3. 共同ミーティング回数マップ構築
    // ============================================================
    const { data: participants } = await supabase
      .from('meeting_participants')
      .select('transcript_id, user_id')
      .not('user_id', 'is', null)

    // transcript_id → [user_id, ...]
    const meetingUserMap: Record<string, string[]> = {}
    if (participants) {
      for (const p of participants) {
        if (!meetingUserMap[p.transcript_id]) meetingUserMap[p.transcript_id] = []
        meetingUserMap[p.transcript_id].push(p.user_id)
      }
    }
    // ペアごとの共同ミーティング回数
    const sharedMeetings: Record<string, number> = {}
    for (const users of Object.values(meetingUserMap)) {
      for (let i = 0; i < users.length; i++) {
        for (let j = i + 1; j < users.length; j++) {
          const [a, b] = users[i] < users[j] ? [users[i], users[j]] : [users[j], users[i]]
          const key = `${a}:${b}`
          sharedMeetings[key] = (sharedMeetings[key] ?? 0) + 1
        }
      }
    }

    // ============================================================
    // 4. 計算対象ペアを決定
    // ============================================================
    let targetUserIds: string[]

    if (mode === 'users' && userIds.length > 0) {
      // 指定ユーザーと全ユーザーのペア
      targetUserIds = userIds.filter(id => profileMap[id])
    } else if (mode === 'stale') {
      // stale行のユーザーを取得
      const { data: staleRows } = await supabase
        .from('matching_scores_cache')
        .select('user_a_id, user_b_id')
        .eq('is_stale', true)
        .limit(500)

      const staleUserSet = new Set<string>()
      if (staleRows) {
        for (const r of staleRows) {
          staleUserSet.add(r.user_a_id)
          staleUserSet.add(r.user_b_id)
        }
      }
      targetUserIds = Array.from(staleUserSet).filter(id => profileMap[id])
    } else {
      // full: 全ユーザー
      targetUserIds = allProfiles.map(p => p.id)
    }

    if (targetUserIds.length === 0) {
      return new Response(JSON.stringify({ success: true, pairs_computed: 0, message: 'No target users' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    // ============================================================
    // 5. 既存スコアを取得（高スコア通知判定用）
    // ============================================================
    const existingScores: Record<string, number> = {}
    if (mode === 'full') {
      // fullモード: 全スコアを取得（重複通知防止のため既存スコアが必要）
      const { data: existing } = await supabase
        .from('matching_scores_cache')
        .select('user_a_id, user_b_id, total_score')
      if (existing) {
        for (const e of existing) {
          existingScores[`${e.user_a_id}:${e.user_b_id}`] = Number(e.total_score)
        }
      }
    } else if (targetUserIds.length > 0 && targetUserIds.length <= 50) {
      // usersモード: 対象ユーザーのスコアのみ取得（URLサイズ制限対策で50件以下）
      const { data: existing } = await supabase
        .from('matching_scores_cache')
        .select('user_a_id, user_b_id, total_score')
        .or(targetUserIds.map(id => `user_a_id.eq.${id},user_b_id.eq.${id}`).join(','))

      if (existing) {
        for (const e of existing) {
          existingScores[`${e.user_a_id}:${e.user_b_id}`] = Number(e.total_score)
        }
      }
    }

    // ============================================================
    // 6. ペアごとにスコア計算 + バッチ upsert
    // ============================================================
    const allUserIds = allProfiles.map(p => p.id)
    const upsertBatch: any[] = []
    const notifications: any[] = []
    const computedPairs = new Set<string>()

    for (const targetId of targetUserIds) {
      const profileA = profileMap[targetId]
      if (!profileA) continue

      for (const otherId of allUserIds) {
        if (otherId === targetId) continue

        // IDの順序を保証（CHECK制約: user_a_id < user_b_id）
        const [aId, bId] = targetId < otherId ? [targetId, otherId] : [otherId, targetId]

        // 同じペアの重複計算を防止（O(1)ルックアップ）
        const pairKey = `${aId}:${bId}`
        if (computedPairs.has(pairKey)) continue
        computedPairs.add(pairKey)

        const userA = profileMap[aId]
        const userB = profileMap[bId]
        if (!userA || !userB) continue

        const aiA = aiMap[aId] ?? null
        const aiB = aiMap[bId] ?? null
        const hasAiA = !!aiA
        const hasAiB = !!aiB

        // profile_score
        const profileResult = computeProfileScore(userA, userB)

        // transcript_score (同意チェック)
        let transcriptResult = { score: 0, reasons: [] as any[] }
        const consentA = userA.transcript_analysis_consent
        const consentB = userB.transcript_analysis_consent
        if ((consentA && aiA) || (consentB && aiB)) {
          transcriptResult = computeTranscriptScore(
            consentA ? aiA : null,
            consentB ? aiB : null
          )
        }

        // interaction_score
        const meetCount = sharedMeetings[pairKey] ?? 0
        const interactionResult = computeInteractionScore(meetCount)

        // total_score
        const totalScore = computeTotalScore(
          profileResult.score, transcriptResult.score, interactionResult.score,
          hasAiA, hasAiB
        )

        // match_reasons (全理由を統合、上位5つ)
        const allReasons = [...profileResult.reasons, ...transcriptResult.reasons, ...interactionResult.reasons]
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)

        upsertBatch.push({
          user_a_id: aId,
          user_b_id: bId,
          profile_score: profileResult.score,
          transcript_score: transcriptResult.score,
          interaction_score: interactionResult.score,
          total_score: totalScore,
          match_reasons: allReasons,
          calculated_at: new Date().toISOString(),
          is_stale: false
        })

        // 高スコア通知判定
        const prevScore = existingScores[pairKey] ?? 0
        if (totalScore >= 75 && prevScore < 75) {
          // 両ユーザーに通知
          for (const uid of [aId, bId]) {
            const otherId = uid === aId ? bId : aId
            const otherProfile = profileMap[otherId]
            notifications.push({
              user_id: uid,
              type: 'match_recommendation',
              title: '新しいマッチング候補が見つかりました',
              message: `${otherProfile?.name ?? '会員'}さんとの相性スコアが${totalScore}%です。AI分析に基づく高い補完性が確認されました。`,
              link: `/matching.html?highlight=${otherId}`,
              data: { matched_user_id: otherId, score: totalScore, reasons: allReasons.slice(0, 3) },
              is_read: false
            })
          }
        }
      }
    }

    // ============================================================
    // 7. バッチ upsert (500件ずつ)
    // ============================================================
    let upsertedCount = 0
    for (let i = 0; i < upsertBatch.length; i += 500) {
      const batch = upsertBatch.slice(i, i + 500)
      const { error: upsertError } = await supabase
        .from('matching_scores_cache')
        .upsert(batch, { onConflict: 'user_a_id,user_b_id' })

      if (upsertError) {
        console.error(`[calculate-matching-scores] Upsert error batch ${i}:`, upsertError)
      } else {
        upsertedCount += batch.length
      }
    }

    // ============================================================
    // 8. 通知挿入
    // ============================================================
    if (notifications.length > 0) {
      const { error: notifError } = await supabase
        .from('notifications')
        .insert(notifications)

      if (notifError) {
        console.error('[calculate-matching-scores] Notification insert error:', notifError)
      } else {
        console.log(`[calculate-matching-scores] ${notifications.length} notifications sent`)
      }
    }

    console.log(`[calculate-matching-scores] Complete: ${upsertedCount} pairs, ${notifications.length} notifications`)

    return new Response(
      JSON.stringify({
        success: true,
        pairs_computed: upsertedCount,
        notifications_sent: notifications.length,
        mode,
        target_users: targetUserIds.length
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[calculate-matching-scores] Error:', error)
    return new Response(
      JSON.stringify({ error: String((error as any)?.message ?? error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
