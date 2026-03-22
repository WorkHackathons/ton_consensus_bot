import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const blobs = [
  {
    color: "#06111F",
    size: 420,
    mobileSize: 260,
    className: "left-[-140px] top-[-110px]",
    animate: { x: [-18, 18, -18], y: [-12, 12, -12] },
    transition: { duration: 12, repeat: Infinity, ease: "easeInOut" },
  },
  {
    color: "#12081F",
    size: 360,
    mobileSize: 220,
    className: "bottom-[-120px] right-[-90px]",
    animate: { x: [12, -12, 12], y: [16, -16, 16] },
    transition: { duration: 14, repeat: Infinity, ease: "easeInOut" },
  },
  {
    color: "#071A20",
    size: 320,
    mobileSize: 0,
    className: "right-[12%] top-[30%]",
    animate: { x: [-8, 18, -8], y: [8, -18, 8] },
    transition: { duration: 16, repeat: Infinity, ease: "easeInOut" },
  },
];

function useLiteBackground() {
  const [lite, setLite] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;

    const media = window.matchMedia("(max-width: 768px), (pointer: coarse), (prefers-reduced-motion: reduce)");
    const apply = () => setLite(media.matches);
    apply();

    media.addEventListener?.("change", apply);
    return () => media.removeEventListener?.("change", apply);
  }, []);

  return lite;
}

export default function Background() {
  const lite = useLiteBackground();

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {blobs.map((blob) => {
        const size = lite ? blob.mobileSize : blob.size;
        if (!size) return null;

        return (
          <motion.div
            key={blob.color}
            className={`absolute rounded-full ${lite ? "blur-[42px]" : "blur-[80px]"} ${blob.className}`}
            style={{ width: size, height: size, background: blob.color, opacity: lite ? 0.78 : 1 }}
            animate={lite ? { opacity: [0.62, 0.8, 0.62], scale: [1, 1.02, 1] } : blob.animate}
            transition={lite ? { duration: 7.5, repeat: Infinity, ease: "easeInOut" } : blob.transition}
          />
        );
      })}
      <div className={`absolute inset-0 ${lite ? "bg-black/92" : "bg-black/88"}`} />
      <div className={`absolute inset-0 ${lite ? "bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.02),transparent_32%)]" : "bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.03),transparent_38%)]"}`} />
      {!lite ? <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.018)_22%,transparent_38%,transparent_62%,rgba(0,152,234,0.045)_82%,transparent_100%)] opacity-80" /> : null}
      <div className={`absolute inset-x-0 top-0 ${lite ? "h-36" : "h-52"} bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.035),transparent_58%)]`} />
    </div>
  );
}
