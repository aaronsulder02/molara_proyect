"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refresca los datos del servidor cada N segundos (bandeja en "tiempo real" sin websockets). */
export function AutoRefresh({ seconds = 8 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

export function ScrollBottom({ id }: { id: string }) {
  useEffect(() => { const el = document.getElementById(id); if (el) el.scrollTop = el.scrollHeight; });
  return null;
}
