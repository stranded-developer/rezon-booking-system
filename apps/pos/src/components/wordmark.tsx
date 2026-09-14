export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-black uppercase italic tracking-tight ${className}`}>
      Race<span className="text-flag">ground</span>
    </span>
  );
}
