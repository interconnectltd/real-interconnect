"use client";

import { useEffect, useState } from "react";
import { Toaster as SonnerToaster } from "sonner";

/**
 * Toaster — SP では bottom-center (sticky header との衝突回避)、
 *           PC では top-center (視線が上に集まる前提)。
 */
export function Toaster() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <SonnerToaster
      position={isMobile ? "bottom-center" : "top-center"}
      richColors
      mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      toastOptions={{
        className: "font-sans",
      }}
    />
  );
}
