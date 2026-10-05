"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

/**
 * The rig, turning through the owner's seven renders (D88). Each angle crossfades into the next;
 * the dots pick one. It holds still while someone is pointing at it or has focus inside it, and
 * never moves on its own for anyone who has asked their device to reduce motion.
 *
 * The renders were cut out of their grey studio background (see build/40), so the rig sits on
 * the page itself, as in the mockup.
 */
const ANGLES = [
  { src: "/rigs/rig-1.webp", alt: "A Racegrounds simulator: triple curved screens, direct-drive wheel and bucket seat" },
  { src: "/rigs/rig-2.webp", alt: "The simulator from the other side, with the shifter and handbrake" },
  { src: "/rigs/rig-3.webp", alt: "The simulator from behind the seat, facing the three screens" },
  { src: "/rigs/rig-4.webp", alt: "The simulator from the front: pedals under the screens" },
  { src: "/rigs/rig-5.webp", alt: "The simulator from the front corner" },
  { src: "/rigs/rig-6.webp", alt: "The simulator from the other front corner" },
  { src: "/rigs/rig-7.webp", alt: "The simulator side on" },
];
const EVERY_MS = 3500;

export function RigGallery({ className = "" }: { className?: string }) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (held || still) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % ANGLES.length), EVERY_MS);
    return () => window.clearInterval(timer);
  }, [held, still]);

  return (
    <div
      className={className}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div className="relative aspect-[10/9] w-full">
        {/* A soft violet floor-glow under the rig, as in the mockup. */}
        <div aria-hidden className="absolute inset-x-[10%] bottom-[4%] h-1/4 rounded-[50%] bg-violet/35 blur-3xl" />
        {ANGLES.map((angle, i) => (
          <Image
            key={angle.src}
            src={angle.src}
            alt={i === index ? angle.alt : ""}
            aria-hidden={i !== index}
            fill
            priority={i === 0}
            sizes="(max-width: 1024px) 92vw, 560px"
            className={`object-contain drop-shadow-[0_30px_40px_rgba(0,0,0,0.6)] transition-opacity duration-1000 ${i === index ? "opacity-100" : "opacity-0"}`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-center gap-2" role="group" aria-label="Choose an angle">
        {ANGLES.map((angle, i) => (
          <button
            key={angle.src}
            type="button"
            aria-label={`Angle ${i + 1} of ${ANGLES.length}`}
            aria-pressed={i === index}
            onClick={() => setIndex(i)}
            className={`h-1.5 rounded-full transition-all ${i === index ? "w-6 bg-flag" : "w-1.5 bg-ink-500/50 hover:bg-ink-600"}`}
          />
        ))}
      </div>
    </div>
  );
}
