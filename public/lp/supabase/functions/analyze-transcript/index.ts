import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SUPABASE_JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET') ?? ''
const AI_API_KEY = Deno.env.get('AI_API_KEY') ?? ''

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

const PROMPT_VERSION = 'v1.0'

// INTER CONNECTのスキル体系（matching-bundle.jsのchallengeSkillMappingと統一）
const SKILL_TAXONOMY = [
  // マーケティング・営業
  'デジタルマーケティング', 'SNSマーケティング', 'SEO/SEM', 'コンテンツマーケティング',
  'ブランディング', 'PR・広報', 'CRM', 'マーケティング分析', '営業戦略', 'セールス',
  'マーケティング', 'マーケティング戦略', 'カスタマーサクセス', 'データ分析',
  'ネゴシエーション', 'プレゼンテーション',
  // 事業開発
  '新規事業開発', '事業計画策定', 'ビジネスモデル構築', '市場開拓', 'プロダクトマネジメント',
  '事業提携・アライアンス', 'M&A戦略', '事業承継', '事業開発',
  'パートナーシップ構築', '契約交渉', 'リレーション構築',
  // 組織・人材
  '人材開発', '組織開発', '組織変革', 'コーチング', 'マネジメント', 'リーダーシップ',
  'チームビルディング', 'ファシリテーション', '評価制度', '人事制度',
  '採用', 'HRテック', '研修設計', 'ビジョン構築', '組織文化',
  'エンゲージメント', '福利厚生設計', '人事評価制度', 'KPI設計', '目標管理',
  // テクノロジー
  'DX推進', 'AI・機械学習', 'IoT', 'クラウド', 'ビッグデータ', 'システム設計',
  'RPA', 'API開発', 'データベース設計', 'セキュリティ', 'データサイエンス', 'BI',
  'サイバーセキュリティ', 'ISMS',
  // 経営・戦略
  '経営戦略立案', 'ファイナンス', '資金調達', 'リスクマネジメント', 'コンプライアンス',
  '法務', '知的財産', 'プロジェクトマネジメント',
  'プロダクト戦略', '競合分析', 'VC交渉', '財務戦略',
  // 業務改善
  'プロセス改善', 'BPR', 'リーン', 'シックスシグマ',
  // デザイン・クリエイティブ
  'UXデザイン', 'デザイン思考', '商品企画', 'サービス開発', 'Web制作',
  // グローバル
  '海外事業', 'グローバル展開', '国際ビジネス', '多言語対応', 'クロスカルチャー'
]

const CHALLENGE_CATEGORIES = [
  '新規顧客獲得', '既存顧客単価', '市場シェア拡大', 'リピート率向上', '新規事業開発',
  'Web集客・SNS活用', '営業力強化',
  '人材採用', '人材育成', '組織文化', '離職防止', '評価制度', 'マネジメント育成',
  'DX推進', '業務自動化', 'システム統合', 'データ活用', 'セキュリティ',
  '業務プロセス改善', 'AI・自動化',
  '差別化戦略', 'ブランディング', '海外展開', 'パートナーシップ',
  '資金調達', '事業承継', '法務・コンプライアンス'
]

// Claude APIでトランスクリプトを分析
async function analyzeWithAI(speakerName: string, speakerText: string): Promise<any> {
  const prompt = `あなたはビジネスコミュニティプラットフォーム「INTER CONNECT」のAI分析エンジンです。
以下のビジネスミーティングにおける「${speakerName}」の発言内容を分析し、この人物のプロフィールを抽出してください。

【発言内容】
${speakerText.slice(0, 8000)}

【抽出項目】
以下のJSON形式で返してください。各項目は日本語で、できるだけ以下の定義済みリストから選んでください。

定義済みスキルリスト: ${SKILL_TAXONOMY.join(', ')}
定義済み課題カテゴリ: ${CHALLENGE_CATEGORIES.join(', ')}

{
  "interests": ["この人が興味を持っている分野（最大5つ）"],
  "skills": ["この人が持っていると思われる専門スキル（定義済みリストから、最大8つ）"],
  "needs": ["この人のビジネスニーズ・課題（定義済み課題カテゴリから、最大5つ）"],
  "offerings": ["この人が他者に提供できる価値・サービス（最大5つ）"],
  "industries": ["この人が関わっている業界（最大3つ）"],
  "key_topics": ["ミーティングで話された主要トピック（最大5つ）"],
  "sentiment": 0.5,
  "communication_style": {
    "assertiveness": 0.5,
    "detail_orientation": 0.5,
    "collaboration": 0.5,
    "formality": 0.5,
    "energy": 0.5
  },
  "expertise_indicators": {"トピック名": 0.8},
  "confidence": 0.7
}

注意:
- sentimentは-1.0（ネガティブ）〜1.0（ポジティブ）
- communication_styleの各値は0.0〜1.0
- expertise_indicatorsは言及されたトピックの専門度を0.0〜1.0で
- confidenceは分析全体の信頼度を0.0〜1.0で
- 発言が少ない場合はconfidenceを低く設定
- JSONのみ返してください（説明文不要）`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AI_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Claude API error: ${response.status} ${errorText}`)
  }

  const result = await response.json()
  const text = result.content?.[0]?.text ?? ''

  // JSONを抽出（```json ... ``` で囲まれている場合も対応）
  // コードブロック内のJSONを優先、なければ最初の{...}を使用
  let jsonStr: string | null = null
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim()
  } else {
    // 最外側の{...}を抽出（ネスト対応）
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) {
      jsonStr = text.slice(start, end + 1)
    }
  }
  if (!jsonStr) {
    throw new Error('AI response did not contain valid JSON')
  }

  try {
    return JSON.parse(jsonStr)
  } catch (parseErr) {
    console.error('[analyze-transcript] JSON parse failed, raw text:', jsonStr.slice(0, 200))
    throw new Error('AI response contained invalid JSON: ' + (parseErr as Error).message)
  }
}

// member_ai_profilesを集約更新
async function updateMemberAiProfile(userId: string) {
  // このユーザーの全インサイトを取得
  const { data: insights } = await supabase
    .from('transcript_insights')
    .select('*')
    .eq('user_id', userId)

  if (!insights || insights.length === 0) return

  // 配列フィールドを集約（出現回数でランキング）
  const aggregate = (field: string) => {
    const counts: Record<string, number> = {}
    for (const insight of insights) {
      const arr = insight[field] ?? []
      for (const item of arr) {
        counts[item] = (counts[item] ?? 0) + 1
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)
      .slice(0, 15)
  }

  // コミュニケーションスタイルを平均化
  const commStyles = insights
    .filter(i => i.communication_style)
    .map(i => i.communication_style)

  const avgComm: Record<string, number> = {}
  if (commStyles.length > 0) {
    const keys = ['assertiveness', 'detail_orientation', 'collaboration', 'formality', 'energy']
    for (const key of keys) {
      const values = commStyles.map(s => s[key] ?? 0.5).filter(v => typeof v === 'number')
      avgComm[key] = values.length > 0
        ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
        : 0.5
    }
  }

  // 専門性信頼度を集約
  const expertiseMap: Record<string, number[]> = {}
  for (const insight of insights) {
    const indicators = insight.expertise_indicators ?? {}
    for (const [topic, score] of Object.entries(indicators)) {
      if (!expertiseMap[topic]) expertiseMap[topic] = []
      expertiseMap[topic].push(score as number)
    }
  }
  const avgExpertise: Record<string, number> = {}
  for (const [topic, scores] of Object.entries(expertiseMap)) {
    avgExpertise[topic] = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
  }

  // 発言時間合計
  const { data: participations } = await supabase
    .from('meeting_participants')
    .select('speaking_duration_seconds')
    .eq('user_id', userId)

  const totalMinutes = participations
    ? Math.floor(participations.reduce((sum, p) => sum + (p.speaking_duration_seconds ?? 0), 0) / 60)
    : 0

  await supabase
    .from('member_ai_profiles')
    .upsert({
      user_id: userId,
      aggregated_interests: aggregate('extracted_interests'),
      aggregated_skills: aggregate('extracted_skills'),
      aggregated_needs: aggregate('extracted_needs'),
      aggregated_offerings: aggregate('extracted_offerings'),
      primary_industries: aggregate('extracted_industries'),
      communication_profile: avgComm,
      expertise_confidence: avgExpertise,
      total_meetings_analyzed: insights.length,
      total_speaking_minutes: totalMinutes,
      last_analysis_at: new Date().toISOString(),
      profile_version: 1,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })

  // マッチングキャッシュをstaleに
  await supabase
    .from('matching_scores_cache')
    .update({ is_stale: true })
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type'
      }
    })
  }

  let transcript_id: string | null = null

  try {
    // 認証チェック: 署名検証済みservice_role JWTのみ許可
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '') ?? ''
    if (!token || !(await verifyServiceRoleJWT(token))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!AI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'AI_API_KEY not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()
    transcript_id = body.transcript_id
    if (!transcript_id) {
      return new Response(
        JSON.stringify({ error: 'transcript_id required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // トランスクリプトを取得
    const { data: transcript, error: fetchError } = await supabase
      .from('meeting_transcripts')
      .select('*')
      .eq('id', transcript_id)
      .single()

    if (fetchError || !transcript) {
      return new Response(
        JSON.stringify({ error: 'Transcript not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 短すぎるトランスクリプトはスキップ
    if ((transcript.word_count ?? 0) < 100) {
      await supabase
        .from('meeting_transcripts')
        .update({ status: 'analyzed', error_message: 'Too short to analyze', updated_at: new Date().toISOString() })
        .eq('id', transcript_id)

      return new Response(
        JSON.stringify({ message: 'Transcript too short, skipped' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 既に分析済み or 分析中ならスキップ（重複呼び出し防止）
    if (transcript.status === 'analyzed' || transcript.status === 'analyzing') {
      return new Response(
        JSON.stringify({ message: `Already ${transcript.status}, skipping` }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // ステータスを analyzing に原子的に更新（TOCTOU対策: readyの場合のみ更新）
    const { data: lockResult } = await supabase
      .from('meeting_transcripts')
      .update({ status: 'analyzing', updated_at: new Date().toISOString() })
      .eq('id', transcript_id)
      .eq('status', 'ready')
      .select('id')

    if (!lockResult || lockResult.length === 0) {
      return new Response(
        JSON.stringify({ message: 'Could not acquire lock, another process may be analyzing' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 参加者を取得
    const { data: participants } = await supabase
      .from('meeting_participants')
      .select('*')
      .eq('transcript_id', transcript_id)

    if (!participants || participants.length === 0) {
      await supabase
        .from('meeting_transcripts')
        .update({ status: 'error', error_message: 'No participants found', updated_at: new Date().toISOString() })
        .eq('id', transcript_id)

      return new Response(
        JSON.stringify({ error: 'No participants' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const segments = transcript.raw_transcript ?? []
    const analyzedUsers: string[] = []
    let successCount = 0
    let failCount = 0

    // 各参加者の発言を分析
    for (const participant of participants) {
      // user_id未解決の参加者はスキップ（同意確認不可のためプライバシー保護）
      if (!participant.user_id) {
        console.log(`Speaker ${participant.speaker_name} has no linked user_id, skipping`)
        continue
      }

      // 同意していないユーザーはスキップ（エラー時も安全側に倒してスキップ）
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('transcript_analysis_consent')
        .eq('id', participant.user_id)
        .maybeSingle()

      if (profileError || !profile || !profile.transcript_analysis_consent) {
        console.log(`User ${participant.user_id} has not consented or profile not found, skipping`)
        continue
      }

      // スピーカーの発言を結合
      const speakerText = segments
        .filter((s: any) => (s.speaker_name ?? s.speaker) === participant.speaker_name)
        .map((s: any) => s.text ?? s.content ?? '')
        .join('\n')

      // 発言が少なすぎる場合はスキップ
      if (speakerText.length < 50) {
        console.log(`Speaker ${participant.speaker_name} has too little text, skipping`)
        continue
      }

      try {
        // AI分析実行
        const analysis = await analyzeWithAI(participant.speaker_name, speakerText)

        // transcript_insightsに保存（重複時は上書き）
        await supabase
          .from('transcript_insights')
          .upsert({
            transcript_id: transcript_id,
            participant_id: participant.id,
            user_id: participant.user_id,
            extracted_interests: analysis.interests ?? [],
            extracted_skills: analysis.skills ?? [],
            extracted_needs: analysis.needs ?? [],
            extracted_offerings: analysis.offerings ?? [],
            extracted_industries: analysis.industries ?? [],
            key_topics: analysis.key_topics ?? [],
            sentiment_score: analysis.sentiment ?? null,
            communication_style: analysis.communication_style ?? null,
            expertise_indicators: analysis.expertise_indicators ?? null,
            ai_model: 'claude-haiku-4-5-20251001',
            ai_prompt_version: PROMPT_VERSION,
            confidence_score: analysis.confidence ?? null,
            raw_ai_response: analysis,
            updated_at: new Date().toISOString()
          }, { onConflict: 'transcript_id,participant_id' })

        // member_ai_profilesを更新
        if (participant.user_id) {
          await updateMemberAiProfile(participant.user_id)
          analyzedUsers.push(participant.user_id)
        }

        console.log(`Analyzed speaker: ${participant.speaker_name}`)
        successCount++
      } catch (aiError) {
        failCount++
        console.error(`AI analysis failed for ${participant.speaker_name}:`, aiError)
      }
    }

    // ステータス更新: 全員失敗ならerror、一部成功ならpartially_analyzed、全員成功ならanalyzed
    const finalStatus = successCount === 0 && failCount > 0 ? 'error'
      : failCount > 0 ? 'partially_analyzed'
      : 'analyzed'
    await supabase
      .from('meeting_transcripts')
      .update({
        status: finalStatus,
        error_message: failCount > 0 ? `${failCount}/${successCount + failCount} speakers failed` : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', transcript_id)

    // マッチングスコア再計算をトリガー（fire-and-forget）
    if (analyzedUsers.length > 0) {
      const uniqueUserIds = [...new Set(analyzedUsers)]
      console.log(`[analyze-transcript] Triggering score recalculation for ${uniqueUserIds.length} users`)
      fetch(`${SUPABASE_URL}/functions/v1/calculate-matching-scores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ user_ids: uniqueUserIds, mode: 'users' })
      }).catch(e => console.warn('[analyze-transcript] Score recalculation trigger failed:', e))
    }

    return new Response(
      JSON.stringify({
        success: true,
        transcript_id,
        analyzed_participants: analyzedUsers.length
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Analysis error:', error)

    // transcript_idが取得できていた場合、ステータスをerrorに更新
    if (transcript_id) {
      try {
        await supabase
          .from('meeting_transcripts')
          .update({ status: 'error', error_message: String(error?.message ?? error), updated_at: new Date().toISOString() })
          .eq('id', transcript_id)
      } catch (_) { /* ステータス更新失敗は無視 */ }
    }

    return new Response(
      JSON.stringify({ error: String(error?.message ?? error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
