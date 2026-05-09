/**
 * client-side 環境検出 utilities (Wave7 sec audit / mobile UX)。
 *
 * すべて typeof window guard で SSR safe。
 */

/**
 * In-app ブラウザ (LINE / Facebook / Instagram / Twitter 等) 検出。
 * 真の場合は OAuth flow が intent:// 経由で外部アプリに渡せず失敗する事が多いため、
 * 「外部ブラウザで開いてください」案内を出すのが正しい UX。
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // 検出対象を Wave14 で拡充:
  //   - FB4A: Facebook for Android (FBAN/FBAV は iOS 中心)
  //   - MusicalLy / musical_ly / BytedanceWebview / TikTok: TikTok 内ブラウザ
  //   - WeChat (MicroMessenger は中国版だが MiniProgram も含めるよう WeChat も追加)
  //   - Slack/: Slack iOS in-app
  // 1 つでも当たれば OAuth が intent:// で外部に飛べず失敗する想定で外部ブラウザ誘導する。
  return /Line\/|FBAN|FBAV|FB_IAB|FBIOS|FB4A|Instagram|Twitter|TwitterAndroid|Snapchat|MicroMessenger|WeChat|Pinterest|MusicalLy|musical_ly|BytedanceWebview|TikTok|Slack\//i.test(
    ua,
  );
}

/**
 * PWA standalone モードかを判定 (display-mode: standalone)。
 * standalone PWA は OAuth が新タブで開かれて元 PWA タブに戻れない事故を起こすため、
 * 案内 / fallback が必要。
 */
export function isPwaStandalone(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari (旧) は navigator.standalone を使う
    Boolean((window.navigator as { standalone?: boolean }).standalone)
  );
}
