"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";

/**
 * Rises its children into view the first time they are scrolled to (D64).
 *
 * The hidden starting state is added **by this component after it mounts**, never in the markup.
 * With JavaScript off, or before hydration, the content is simply visible — a page must not depend
 * on a script running to show its words. `prefers-reduced-motion` is handled in CSS, so the class
 * is still added and simply has no visible effect.
 */
export function Reveal({
  children,
  as: Tag = "div",
  delayMs = 0,
  className = "",
}: {
  children: ReactNode;
  as?: ElementType;
  delayMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No observer (old browser, or a test environment): show everything and stop.
    if (typeof IntersectionObserver === "undefined") return;

    el.classList.add("js-reveal");
    if (delayMs) el.style.transitionDelay = `${delayMs}ms`;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    observer.observe(el);

    // Anything already on screen when the page loads should not wait for a scroll.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) el.classList.add("is-in");

    return () => observer.disconnect();
  }, [delayMs]);

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
