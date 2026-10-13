import Image from "next/image";
import logo from "@/assets/racegrounds-logo.png";

/** The owner's logo (white on transparent, so dark backgrounds only). Size it with a width class. */
export function Wordmark({ className = "" }: { className?: string }) {
  return <Image src={logo} alt="Racegrounds" loading="eager" className={`h-auto ${className}`} />;
}
