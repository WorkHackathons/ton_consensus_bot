import { AnimatePresence, motion } from "framer-motion";
import confetti from "canvas-confetti";
import { useEffect, useState } from "react";
import { tg } from "../constants";

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

function useLiteSuccessFx() {
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

export default function SuccessExplosion({ amount, visible, txHash, tonscanUrl, onDone }) {
  const [display, setDisplay] = useState(0);
  const [typedHash, setTypedHash] = useState("");
  const lite = useLiteSuccessFx();

  useEffect(() => {
    if (!visible) return undefined;

    tg?.HapticFeedback?.notificationOccurred("success");
    confetti({
      particleCount: lite ? 72 : 120,
      spread: lite ? 64 : 80,
      colors: ["#FFD700", "#FFA500", "#FFE135"],
      origin: { y: 0.6 },
    });

    const start = performance.now();
    let frameId = 0;

    const tick = (now) => {
      const progress = Math.min((now - start) / 800, 1);
      setDisplay(amount * easeOut(progress));
      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      }
    };

    frameId = requestAnimationFrame(tick);
    const timeout = setTimeout(onDone, 1500);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timeout);
    };
  }, [amount, lite, visible, onDone]);

  useEffect(() => {
    if (!visible || !txHash) {
      setTypedHash("");
      return undefined;
    }

    let timeoutId = 0;
    let index = 0;
    const tick = () => {
      setTypedHash(txHash.slice(0, index));
      if (index <= txHash.length) {
        index += 1;
        timeoutId = window.setTimeout(tick, 30);
      }
    };

    tick();
    return () => window.clearTimeout(timeoutId);
  }, [txHash, visible]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          className={`fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 ${lite ? "" : "backdrop-blur-[8px]"}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className={`absolute left-[14%] top-[22%] h-32 w-32 rounded-full bg-[#FFD700]/16 ${lite ? "blur-[44px]" : "blur-[72px]"}`}
              animate={lite ? { opacity: [0.18, 0.3, 0.18] } : { x: [0, 24, 0], y: [0, -18, 0] }}
              transition={{ duration: lite ? 3.4 : 4.8, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className={`absolute bottom-[18%] right-[14%] h-40 w-40 rounded-full bg-white/8 ${lite ? "blur-[48px]" : "blur-[84px]"}`}
              animate={lite ? { opacity: [0.14, 0.24, 0.14] } : { x: [0, -18, 0], y: [0, 18, 0] }}
              transition={{ duration: lite ? 3.8 : 5.4, repeat: Infinity, ease: "easeInOut" }}
            />
          </motion.div>
          <motion.div
            className="panel-surface relative w-full max-w-lg overflow-hidden border border-[#FFD700]/25 px-6 py-8 text-center"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.5, opacity: 0 }}
          >
            <motion.div
              className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#FFD700]/16 to-transparent"
              initial={{ x: "-120%" }}
              animate={{ x: "260%" }}
              transition={{ duration: 1.15, ease: "easeOut" }}
            />
            <motion.div
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/8 text-3xl text-emerald-300"
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.2, 1] }}
              transition={{ type: "spring", stiffness: 320, damping: 18 }}
            >
              OK
            </motion.div>
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#ffe38a]">Payout Sent</div>
            <div className="mt-4 font-[var(--font-display)] text-5xl font-semibold text-[#FFD700] [text-shadow:0_0_26px_rgba(255,215,0,0.6)]">
              +{display.toFixed(2)} TON
            </div>
            <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
              Oracle settled the market and released funds.
            </div>
            {txHash ? (
              <div className="mt-5 space-y-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/36">Transaction</div>
                <div className="break-all font-mono text-[11px] leading-6 text-white/60">{typedHash}</div>
                {tonscanUrl ? (
                  <a
                    href={tonscanUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded-full border border-[#FFD700]/30 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#ffe38a]"
                  >
                    View on Tonscan
                  </a>
                ) : null}
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}


