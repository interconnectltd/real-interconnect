"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_PREFIX = "interconnect_dismissed_";

function getKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

function getDismissedIds(userId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getKey(userId));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function setDismissedIds(userId: string, ids: string[]) {
  localStorage.setItem(getKey(userId), JSON.stringify(ids));
  // Notify subscribers
  window.dispatchEvent(new Event("dismissed-users-change"));
}

/**
 * localStorage-backed hook for dismissed matching recommendations (A15).
 * No backend needed — purely client-side for MVP.
 */
export function useDismissedUsers(userId: string | undefined) {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener("storage", cb);
    window.addEventListener("dismissed-users-change", cb);
    return () => {
      window.removeEventListener("storage", cb);
      window.removeEventListener("dismissed-users-change", cb);
    };
  }, []);

  const getSnapshot = useCallback(() => {
    if (!userId) return "[]";
    return localStorage.getItem(getKey(userId)) ?? "[]";
  }, [userId]);

  const getServerSnapshot = useCallback(() => "[]", []);

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const dismissedIds: string[] = (() => {
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  })();

  const dismiss = useCallback(
    (targetId: string) => {
      if (!userId) return;
      const current = getDismissedIds(userId);
      if (!current.includes(targetId)) {
        setDismissedIds(userId, [...current, targetId]);
      }
    },
    [userId],
  );

  const restore = useCallback(
    (targetId: string) => {
      if (!userId) return;
      const current = getDismissedIds(userId);
      if (current.includes(targetId)) {
        setDismissedIds(
          userId,
          current.filter((id) => id !== targetId),
        );
      }
    },
    [userId],
  );

  const resetAll = useCallback(() => {
    if (!userId) return;
    setDismissedIds(userId, []);
  }, [userId]);

  const dismissedSet = new Set(dismissedIds);

  return { dismissedSet, dismiss, restore, resetAll };
}
