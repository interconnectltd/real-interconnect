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
  return /Line\/|FBAN|FBAV|FB_IAB|FBIOS|Instagram|Twitter|TwitterAndroid|Snapchat|MicroMessenger|Pinterest/i.test(
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
