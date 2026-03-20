import { AnimatePresence, motion } from "framer-motion";
import confetti from "canvas-confetti";
import { useEffect, useState } from "react";
import { tg } from "../constants";

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

export default function SuccessExplosion({ amount, visible, txHash, tonscanUrl, onDone }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!visible) return undefined;

    tg?.HapticFeedback?.notificationOccurred("success");
    confetti({
      particleCount: 120,
      spread: 80,
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
  }, [amount, visible, onDone]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 backdrop-blur-[8px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="panel-surface w-full max-w-lg border border-[#FFD700]/25 px-6 py-8 text-center"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.5, opacity: 0 }}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#ffe38a]">Payout Sent</div>
            <div className="mt-4 font-[var(--font-display)] text-5xl font-semibold text-[#FFD700] [text-shadow:0_0_26px_rgba(255,215,0,0.6)]">
              +{display.toFixed(2)} TON
            </div>
            {txHash ? (
              <div className="mt-5 space-y-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/36">Transaction</div>
                <div className="break-all font-mono text-[11px] leading-6 text-white/60">{txHash}</div>
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
