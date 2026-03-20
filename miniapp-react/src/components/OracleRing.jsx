import { useEffect, useState } from "react";
import { motion } from "framer-motion";

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
  const text = "AI SCANNING SOURCES_";

  useEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setTyped(text.slice(0, index));
      if (index >= text.length) clearInterval(timer);
    }, 50);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="mt-5 flex items-center gap-4">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-[-10px] rounded-full bg-[#0098EA]/8 blur-xl" />
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-transparent"
          style={{ background: "conic-gradient(#0098EA, transparent 65%)", padding: 2 }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <div className="h-full w-full rounded-full bg-black/80" />
        </motion.div>
        <motion.div
          className="absolute inset-[7px] rounded-full border border-white/12"
          animate={{ rotate: -360 }}
          transition={{ duration: 9, repeat: Infinity, ease: "linear" }}
        />
        <div className="relative z-10 font-mono text-lg text-[#0098EA]">{count}</div>
      </div>
      <div className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#0098EA] [text-shadow:0_0_10px_rgba(0,152,234,0.45)]">
          {typed}
          <span className="animate-pulse">_</span>
        </div>
        <motion.div
          className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          style={{ animation: "glitchOnce 0.8s ease 1" }}
        >
          Verdict pending
        </motion.div>
      </div>
    </div>
  );
}
