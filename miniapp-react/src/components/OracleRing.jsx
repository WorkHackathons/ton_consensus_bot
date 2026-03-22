import { useEffect, useState } from "react";
import { motion } from "framer-motion";

function useLiteOracleFx() {
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

function useCountUp(target, duration = 1000) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let frameId = 0;
    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      setValue(Math.round(target * progress));
      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [target, duration]);

  return value;
}

export default function OracleRing({ confidence = 92 }) {
  const count = useCountUp(confidence);
  const [typed, setTyped] = useState("");
  const [dots, setDots] = useState(".");
  const text = "AI SCANNING";
  const lite = useLiteOracleFx();

  useEffect(() => {
    let timeoutId = 0;
    let index = 0;
    let reverse = false;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;

      if (!reverse) {
        setTyped(text.slice(0, index));
        if (index <= text.length) {
          index += 1;
          timeoutId = window.setTimeout(tick, 70);
        } else {
          reverse = true;
          timeoutId = window.setTimeout(tick, 450);
        }
      } else {
        setTyped(text.slice(0, index));
        if (index >= 0) {
          index -= 1;
          timeoutId = window.setTimeout(tick, 42);
        } else {
          reverse = false;
          index = 0;
          timeoutId = window.setTimeout(tick, 220);
        }
      }
    };

    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    const frames = [".", "..", "..."];
    let pointer = 0;
    const timer = window.setInterval(() => {
      pointer = (pointer + 1) % frames.length;
      setDots(frames[pointer]);
    }, 420);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="mt-5 flex items-center gap-4">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className={`absolute inset-[-10px] rounded-full bg-[#0098EA]/8 ${lite ? "blur-lg" : "blur-xl"}`} />
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-transparent"
          style={{ background: "conic-gradient(#0098EA, transparent 65%)", padding: 2 }}
          animate={lite ? { opacity: [0.9, 0.6, 0.9], scale: [1, 1.015, 1] } : { rotate: 360 }}
          transition={lite ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : { duration: 2.8, repeat: Infinity, ease: "linear" }}
        >
          <div className="h-full w-full rounded-full bg-black/80" />
        </motion.div>
        <motion.div
          className="absolute inset-[7px] rounded-full border border-white/12"
          animate={lite ? { opacity: [0.4, 0.7, 0.4] } : { rotate: -360 }}
          transition={lite ? { duration: 2.8, repeat: Infinity, ease: "easeInOut" } : { duration: 12, repeat: Infinity, ease: "linear" }}
        />
        <motion.div
          className="absolute inset-[-8px] rounded-full border border-[#0098EA]/14"
          animate={lite ? { scale: [1, 1.03, 1], opacity: [0.35, 0.55, 0.35] } : { rotate: 360, scale: [1, 1.04, 1] }}
          transition={lite ? { duration: 2.6, repeat: Infinity, ease: "easeInOut" } : { rotate: { duration: 7.5, repeat: Infinity, ease: "linear" }, scale: { duration: 2.4, repeat: Infinity, ease: "easeInOut" } }}
        />
        <div className="relative z-10 font-mono text-lg text-[#0098EA]">{count}</div>
      </div>
      <div className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#0098EA] [text-shadow:0_0_10px_rgba(0,152,234,0.45)]">
          {typed}
          <span className="opacity-70">_</span>
        </div>
        <motion.div
          className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          Verdict pending{dots}
        </motion.div>
      </div>
    </div>
  );
}
