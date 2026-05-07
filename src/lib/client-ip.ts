/**
 * Netlify / Cloudflare 配下で **信頼できる** client IP 取得。
 *
 * Wave1 sec audit (2026-05-07) :
 *   x-forwarded-for[0] 直読は攻撃者が任意の IP を埋め込める。
 *   Netlify は実 IP を `x-nf-client-connection-ip`、CloudFlare は `cf-connecting-ip`
 *   に "プロキシ層が上書き不能な header として" 詰めるため、これらを優先する。
 *
 *   x-forwarded-for は **末尾側の信頼 hop** が真の client。最左 token 信用は禁止。
 *
 * 戻り値: 取得不能時は null (呼出側で fail-closed / `unknown` バケット衝突回避を判断)。
 */
export function getClientIp(headers: Headers): string | null {
  const nf = headers.get("x-nf-client-connection-ip");
  if (nf && isValidIp(nf)) return nf.trim();
  const cf = headers.get("cf-connecting-ip");
  if (cf && isValidIp(cf)) return cf.trim();
  const tcip = headers.get("true-client-ip");
  if (tcip && isValidIp(tcip)) return tcip.trim();
  const real = headers.get("x-real-ip");
  if (real && isValidIp(real)) return real.trim();

  // x-forwarded-for は最右(=直近の信頼 proxy が直前 hop として書き込む)を優先。
  // 攻撃者は左側に任意 IP を詰められるが、最右は Netlify edge が常に正しく書く。
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const tokens = xff.split(",").map((t) => t.trim()).filter(Boolean);
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (isValidIp(tokens[i]!)) return tokens[i]!;
    }
  }
  return null;
}

/** 攻撃 header 偽装で任意文字列を IP key にされないよう簡易検証 */
function isValidIp(s: string): boolean {
  const v = s.trim();
  if (!v) return false;
  // IPv4
  if (/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v)) {
    return true;
  }
  // IPv6 (簡易: hex/colon のみ、長さ 2..45)
  if (/^[0-9a-fA-F:]+$/.test(v) && v.length >= 2 && v.length <= 45) {
    return true;
  }
  return false;
}
