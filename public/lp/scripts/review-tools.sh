#!/bin/bash
# ============================================================
# INTERCONNECT Review Tool Layer
# 静的解析を実行し、結果をレビューエージェントに渡す
#
# 使い方:
#   bash scripts/review-tools.sh              # フルスキャン
#   bash scripts/review-tools.sh --diff       # git差分のみ
#   bash scripts/review-tools.sh --staged     # ステージ済みのみ
#   bash scripts/review-tools.sh --files "a.js b.html"
#
# 出力: テキスト形式のセクション別レポート
# → メインエージェントがレビューエージェントに渡す
# ============================================================

set -uo pipefail
# Note: -e は使わない。grep が0件のとき exit 1 を返すため

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

MODE="${1:---full}"
FILES_ARG="${2:-}"

# ── ターゲットファイル決定 ──────────────────────────────
case "$MODE" in
  --diff)
    TARGET_FILES=$(git diff --name-only HEAD -- '*.js' '*.html' '*.ts' '*.css' '*.toml' 2>/dev/null || echo "")
    ;;
  --staged)
    TARGET_FILES=$(git diff --cached --name-only -- '*.js' '*.html' '*.ts' '*.css' '*.toml' 2>/dev/null || echo "")
    ;;
  --files)
    TARGET_FILES="$FILES_ARG"
    ;;
  --full|*)
    TARGET_FILES="__FULL__"
    ;;
esac

if [ "$TARGET_FILES" != "__FULL__" ] && [ -z "$TARGET_FILES" ]; then
  echo "対象ファイルなし（変更なし）"
  exit 0
fi

# 除外パターン（dist/ は stale build、node_modules は外部コード）
EXCLUDE="--exclude-dir=dist --exclude-dir=node_modules --exclude-dir=.git"

# grep ラッパー: --full ならプロジェクト全体、それ以外はターゲットのみ
search_files() {
  local pattern="$1"
  shift
  if [ "$TARGET_FILES" = "__FULL__" ]; then
    grep -rn $EXCLUDE "$@" -E "$pattern" . 2>/dev/null || true
  else
    echo "$TARGET_FILES" | tr ' ' '\n' | while read -r f; do
      [ -f "$f" ] && grep -nE "$pattern" "$f" 2>/dev/null | sed "s|^|$f:|" || true
    done
  fi
}

# ── レポート開始 ────────────────────────────────────────
echo "=========================================="
echo "INTERCONNECT Static Analysis Report"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Mode: $MODE"
echo "=========================================="

# ── 1. シークレット検出 ─────────────────────────────────
echo ""
echo "## 1. SECRET DETECTION"
echo "---"

# パターン: APIキー・トークン・パスワードのハードコード
# 注意: SUPABASE_ANON_KEY は supabase-unified.js でクライアント用として意図的に公開
SECRETS=$(grep -rn -E "(api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*['\"][^'\"]{8,}" \
  --include='*.js' --include='*.ts' --include='*.html' --include='*.env' --include='*.toml' \
  $EXCLUDE . 2>/dev/null | \
  grep -v 'SUPABASE_ANON_KEY' | \
  grep -v 'integrity="sha' | \
  grep -v 'node_modules/' | \
  grep -v 'console\.\(log\|warn\|error\)' | \
  grep -v 'YOUR_.*SECRET' || true)

if [ -n "$SECRETS" ]; then
  echo "FOUND:"
  echo "$SECRETS"
else
  echo "CLEAN: No hardcoded secrets detected"
fi

# .env ファイルの存在チェック
if [ -f ".env" ]; then
  echo "WARNING: .env file exists in project root"
  echo "  Verify it is in .gitignore"
  grep -c "." .env | xargs -I{} echo "  Lines in .env: {}"
fi

# ── 2. npm audit ────────────────────────────────────────
echo ""
echo "## 2. NPM AUDIT (netlify/functions)"
echo "---"

if [ -f "netlify/functions/package-lock.json" ]; then
  cd netlify/functions
  npm audit --json 2>/dev/null | jq -r '
    if .vulnerabilities then
      "Total: \(.metadata.vulnerabilities.total // 0)",
      "  critical: \(.metadata.vulnerabilities.critical // 0)",
      "  high: \(.metadata.vulnerabilities.high // 0)",
      "  moderate: \(.metadata.vulnerabilities.moderate // 0)",
      "  low: \(.metadata.vulnerabilities.low // 0)",
      "",
      (if (.metadata.vulnerabilities.total // 0) > 0 then
        (.vulnerabilities | to_entries[] | "  \(.key): \(.value.severity) - \(.value.via[0].title // .value.via[0] // "unknown")")
      else empty end)
    else "CLEAN: No vulnerabilities" end
  ' 2>/dev/null || echo "npm audit failed or jq not available"
  cd "$PROJECT_ROOT"
elif [ -f "netlify/functions/package.json" ]; then
  echo "WARNING: package.json exists but no package-lock.json (npm audit requires lock file)"
else
  echo "SKIP: No netlify/functions/package.json"
fi

# root package.json もチェック
if [ -f "package-lock.json" ]; then
  echo ""
  echo "Root package:"
  npm audit --json 2>/dev/null | jq -r '
    "Total: \(.metadata.vulnerabilities.total // 0) (critical: \(.metadata.vulnerabilities.critical // 0), high: \(.metadata.vulnerabilities.high // 0))"
  ' 2>/dev/null || echo "npm audit failed"
fi

# ── 3. XSS ベクター検出（精密版）────────────────────────
echo ""
echo "## 3. XSS VECTOR DETECTION"
echo "---"

# 3a. onclick に動的値を注入 & escapeAttr なし → HIGH RISK
echo "### 3a. onclick with dynamic content WITHOUT escapeAttr:"
ONCLICK_RISKY=$(search_files 'onclick="[^"]*\$\{' --include='*.js' | grep -v 'dist/' | grep -v 'escapeAttr' || true)
if [ -n "$ONCLICK_RISKY" ]; then
  echo "FOUND (no escapeAttr):"
  echo "$ONCLICK_RISKY"
else
  echo "  CLEAN (all dynamic onclick values use escapeAttr)"
fi

echo ""
echo "### 3b. onclick with escapeAttr (safe, for reference):"
search_files 'onclick="[^"]*\$\{' --include='*.js' | grep -v 'dist/' | grep 'escapeAttr' | wc -l | xargs -I{} echo "  {} occurrences (properly escaped)"

# 3c. innerHTML にテンプレートリテラル変数 & escapeHtml なし → HIGH RISK
echo ""
echo "### 3c. innerHTML with template variables WITHOUT escapeHtml:"
echo "  (Scanning for \${...} inside innerHTML that lack escapeHtml...)"
# 各JSファイルを走査: innerHTML = `...${var}...` があって同じテンプレート内に escapeHtml がない箇所
for jsfile in js/*.js; do
  [ -f "$jsfile" ] || continue
  basename_f=$(basename "$jsfile")
  # innerHTML の行を抽出し、テンプレートリテラル内の変数展開を検出
  grep -n '\.innerHTML\s*=' "$jsfile" 2>/dev/null | while read -r line; do
    lineno=$(echo "$line" | cut -d: -f1)
    # この行から20行先まで読んで、escapeHtml なしの ${...} を探す
    content=$(sed -n "${lineno},$((lineno+20))p" "$jsfile" 2>/dev/null)
    # テンプレートリテラル内に ${...} があるか
    if echo "$content" | grep -q '\${' 2>/dev/null; then
      # ${...} の中身を抽出
      vars=$(echo "$content" | grep -oE '\$\{[^}]+\}' | grep -v 'escapeHtml' | grep -v 'escapeAttr' | grep -v 'formatDate\|formatTime\|formatNumber\|toLocaleString\|Math\.\|parseInt\|JSON\.' | grep -v '^\${[0-9]' | grep -v '^\${\s*i\s*}' || true)
      if [ -n "$vars" ]; then
        echo "  $basename_f:$lineno"
        echo "$vars" | head -5 | sed 's/^/    /'
      fi
    fi
  done
done

# 3d. setAttribute で on* イベントを動的設定
echo ""
echo "### 3d. setAttribute with event handler:"
search_files "setAttribute\s*\(\s*['\"]on" --include='*.js' | grep -v 'dist/' || echo "  CLEAN"

# 3e. eval / new Function
echo ""
echo "### 3e. eval / new Function (code injection risk):"
search_files '\beval\s*\(' --include='*.js' | grep -v 'dist/' || true
search_files 'new\s+Function\s*\(' --include='*.js' | grep -v 'dist/' || true
echo "  (end)"

# 3f. insertAdjacentHTML with dynamic content
echo ""
echo "### 3f. insertAdjacentHTML with template variables:"
search_files 'insertAdjacentHTML' --include='*.js' | grep -v 'dist/' || echo "  CLEAN"

# ── 4. スクリプト読み込み順序チェック ────────────────────
echo ""
echo "## 4. SCRIPT LOAD ORDER"
echo "---"
echo "Rule: supabase-unified.js MUST load before any *-bundle.js or *-unified.js (except itself)"

AUTH_PAGES="dashboard.html profile.html connections.html messages.html notifications.html events.html matching.html members.html settings.html referral.html activities.html billing.html book-consultation.html admin.html super-admin.html admin-referral.html admin-site-settings.html"

ORDER_OK=true
for html in $AUTH_PAGES; do
  if [ ! -f "$html" ]; then continue; fi

  SUPABASE_LINE=$(grep -n 'supabase-unified\.js' "$html" 2>/dev/null | head -1 | cut -d: -f1)
  BUNDLE_LINE=$(grep -n '\-bundle\.js\|dashboard-unified\.js\|notifications-unified\.js\|registration-unified\.js' "$html" 2>/dev/null | head -1 | cut -d: -f1)

  if [ -n "$BUNDLE_LINE" ]; then
    if [ -z "$SUPABASE_LINE" ]; then
      echo "FAIL: $html — bundle found (line $BUNDLE_LINE) but supabase-unified.js missing"
      ORDER_OK=false
    elif [ "$SUPABASE_LINE" -gt "$BUNDLE_LINE" ]; then
      echo "FAIL: $html — supabase-unified.js (line $SUPABASE_LINE) loads AFTER bundle (line $BUNDLE_LINE)"
      ORDER_OK=false
    fi
  fi
done

if $ORDER_OK; then
  echo "CLEAN: All auth pages load supabase-unified.js before bundles"
fi

# notification-system-unified.js の存在チェック
echo ""
echo "### notification-system-unified.js presence:"
TOAST_PAGES="dashboard.html connections.html messages.html notifications.html events.html matching.html members.html settings.html referral.html profile.html"
for html in $TOAST_PAGES; do
  if [ -f "$html" ] && ! grep -q 'notification-system-unified\.js' "$html" 2>/dev/null; then
    echo "WARNING: $html — notification-system-unified.js not loaded (showToast unavailable)"
  fi
done
echo "  (end)"

# ── 5. カラム名整合性 ────────────────────────────────────
echo ""
echo "## 5. COLUMN NAME CONSISTENCY"
echo "---"
echo "Rule: user_profiles uses 'position' NOT 'title' for job title"

# user_profiles コンテキストで title を使っている箇所
TITLE_REFS=$(search_files '\btitle\b' --include='*.js' | \
  grep -v 'dist/' | \
  grep -iE 'user_profile|profile\.|member\.' | \
  grep -v 'document\.title' | \
  grep -vE 'event.*title|notification.*title|meeting.*title|news.*title|certificate.*title|case_stud.*title' || true)

if [ -n "$TITLE_REFS" ]; then
  echo "SUSPECT (may use 'title' where 'position' is correct):"
  echo "$TITLE_REFS"
else
  echo "CLEAN: No suspicious title/position mismatches"
fi

# ── 6. URL 整合性 ────────────────────────────────────────
echo ""
echo "## 6. URL CONSISTENCY"
echo "---"
echo "Rule: All references should use 'inter-connect.app'"

OLD_URLS=$(grep -rn -E 'interconnect-auto|interconnect-system\.netlify\.app' $EXCLUDE --exclude-dir=scripts . 2>/dev/null | grep -v '.git/' || true)
if [ -n "$OLD_URLS" ]; then
  echo "FOUND (old URL references):"
  echo "$OLD_URLS"
else
  echo "CLEAN: No old URL references"
fi

# ── 7. 既知のバグパターン ────────────────────────────────
echo ""
echo "## 7. KNOWN BUG PATTERNS"
echo "---"

echo "### supabaseClientClient typo:"
search_files 'supabaseClientClient' --include='*.js' | grep -v 'dist/' || echo "  CLEAN"

echo ""
echo "### .single() usage (should often be .maybeSingle()):"
search_files '\.single\(\)' --include='*.js' | grep -v 'dist/' | head -20 || echo "  CLEAN"

echo ""
echo "### Unclosed template literals in HTML attributes:"
search_files '="\$\{[^}]*$' --include='*.js' | grep -v 'dist/' | head -10 || echo "  CLEAN"

echo ""
echo "### window.supabase direct usage (should be supabaseClient):"
search_files 'window\.supabase[^C]' --include='*.js' | grep -v 'dist/' | grep -v 'supabase-unified' | head -10 || echo "  CLEAN"

# ── 8. HTTP URL（非HTTPS）────────────────────────────────
echo ""
echo "## 8. INSECURE HTTP URLS"
echo "---"

HTTP_URLS=$(search_files 'http://' --include='*.js' --include='*.html' --include='*.toml' | \
  grep -v 'dist/' | \
  grep -v 'localhost' | \
  grep -v '127\.0\.0\.1' | \
  grep -v 'http://www.w3.org' | \
  grep -v 'http://schemas' || true)

if [ -n "$HTTP_URLS" ]; then
  echo "FOUND:"
  echo "$HTTP_URLS"
else
  echo "CLEAN: No insecure HTTP URLs"
fi

# ── 9. エラーハンドリング ────────────────────────────────
echo ""
echo "## 9. ERROR HANDLING GAPS"
echo "---"

echo "### Empty catch blocks:"
search_files 'catch\s*\(.*\)\s*\{\s*\}' --include='*.js' | grep -v 'dist/' | head -10 || echo "  CLEAN"

echo ""
echo "### catch that only logs (potential silent failures):"
CATCH_LOG_COUNT=$(search_files 'catch.*console\.(log|warn)' --include='*.js' | grep -v 'dist/' | wc -l | tr -d ' ')
echo "  $CATCH_LOG_COUNT occurrences (review if critical paths)"

# ── 10. CSP / CORS 設定チェック ──────────────────────────
echo ""
echo "## 10. CSP & CORS CONFIGURATION"
echo "---"

if [ -f "netlify.toml" ]; then
  echo "### CSP directives:"
  grep -o "Content-Security-Policy.*" netlify.toml | tr ';' '\n' | sed 's/^/  /' || echo "  Not found"

  echo ""
  echo "### CORS origin:"
  grep -i "Access-Control-Allow-Origin" netlify.toml || echo "  Not found"

  echo ""
  echo "### unsafe-inline usage:"
  grep -c "unsafe-inline" netlify.toml | xargs -I{} echo "  {} occurrences of 'unsafe-inline'"
fi

# ── サマリー ─────────────────────────────────────────────
echo ""
echo "=========================================="
echo "ANALYSIS COMPLETE"
echo "=========================================="
echo "Pass results to Review Agent for interpretation."
