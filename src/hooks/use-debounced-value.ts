"use client";

import { useEffect, useState } from "react";

/**
 * 値の変更を一定時間遅延させる (検索 input 用)。
 * 直近の input 変更から `delay` ms 経過後にのみ derived value を更新する。
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}
