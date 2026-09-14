"use client";

import { useCallback, useEffect, useState } from "react";
import type { Floor } from "@/lib/types";
import { usePos } from "./pos-provider";

const POLL_MS = 10_000;

/** Floor state polled in the background, plus the offset between server and device clocks. */
export function useFloor() {
  const { api } = usePos();
  const [floor, setFloor] = useState<Floor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  const refresh = useCallback(
    async (passive = false) => {
      try {
        const sentAt = Date.now();
        const next = await api<Floor>("/pos/floor", { passive });
        const receivedAt = Date.now();
        setClockOffsetMs(Date.parse(next.now) - (sentAt + receivedAt) / 2);
        setFloor(next);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load the floor");
      }
    },
    [api],
  );

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void refresh(true);
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { floor, error, clockOffsetMs, refresh: () => refresh(false) };
}

/** Re-renders every second with the server-corrected current time. */
export function useNow(offsetMs: number): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + offsetMs), 1_000);
    return () => window.clearInterval(timer);
  }, [offsetMs]);
  return now;
}
