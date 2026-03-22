import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import OracleRing from "./OracleRing";

const statusStyles = {
  pending: "text-white/25",
  active: "text-white [text-shadow:0_0_8px_rgba(255,255,255,0.18)]",
  oracle: "text-[#0098EA] animate-pulse",
  confirming: "text-white/80",
  done: "text-white/18",
  refunded: "text-white/25",
};

const statusLabel = {
  pending: "OPEN",
  active: "ACTIVE",
  confirming: "CONFIRMING",
  oracle: "ORACLE",
  done: "CLOSED",
  refunded: "REFUNDED",
};

function GlyphPanel({ status }) {
  if (status === "oracle") {
    return (
      <div className="flex h-full min-h-[120px] items-center justify-center border-l border-white/10 bg-[radial-gradient(circle_at_30%_30%,rgba(0,152,234,0.18),rgba(255,255,255,0.02)_50%,transparent_74%)]">
        <div className="flex h-18 w-18 items-center justify-center rounded-full border border-[#0098EA]/40">
          <div className="h-10 w-10 rounded-full border border-[#0098EA]/55" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[120px] items-center justify-center border-l border-white/10 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.12),rgba(255,255,255,0.02)_48%,transparent_72%)]">
      <div className="flex h-18 w-18 items-center justify-center rounded-full border border-white/12">
        <div className="h-10 w-10 rounded-full border border-white/14" />
      </div>
    </div>
  );
}

function formatCountdown(deadlineTs, nowTs) {
  if (!deadlineTs) return null;
  const diff = Number(deadlineTs) - Number(nowTs);
  if (diff <= 0) return "Expired - awaiting resolution";
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  return `Expires in ${hours}h ${minutes}m`;
}

export default function BetCard({ bet, index, onOpen, onSelect, selected }) {
  const status = bet.status === "done" ? "closed" : bet.status.toUpperCase();
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  const deadlineLabel = formatCountdown(bet.deadline, nowTs);

  useEffect(() => {
    const interval = window.setInterval(() => setNowTs(Math.floor(Date.now() / 1000)), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ type: "spring", stiffness: 300, damping: 25, delay: index * 0.08 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97, transition: { duration: 0.1 } }}
      onClick={() => onSelect?.(bet)}
      className={`market-card group relative border-b border-white/10 bg-black transition-colors ${selected ? "border-[#0098EA]/30 bg-white/[0.03]" : ""}`}
    >
      <div className="grid gap-px bg-white/5 md:grid-cols-[1fr,132px]">
        <div className="bg-black px-4 py-4 md:px-5 md:py-5">
          <div className="mb-3 flex items-center justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.26em]">
            <span className="text-white/28">#{String(bet.id).padStart(4, "0")}</span>
            <span className={statusStyles[bet.status] || "text-white/40"}>
              {statusLabel[bet.status] || status}
            </span>
          </div>

          <h3 className="max-w-[92%] font-[var(--font-display)] text-[24px] font-semibold leading-[1.06] text-white md:text-[30px]">
            {bet.description}
          </h3>

          <div className="mt-4 font-mono text-[12px] uppercase tracking-[0.18em] text-[#0098EA] [text-shadow:0_0_12px_rgba(0,152,234,0.4)]">
            {bet.amount_ton} TON
          </div>
          {deadlineLabel ? (
            <div className={`mt-3 font-mono text-[10px] uppercase tracking-[0.18em] ${Number(bet.deadline) <= nowTs ? "text-[#ffb3b3]" : "text-white/42"}`}>
              {deadlineLabel}
            </div>
          ) : null}

          <div className="mt-5 grid gap-px border border-white/10 bg-white/5 sm:grid-cols-[1fr,auto]">
            <div className="bg-black px-4 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/34">
              {bet.opponent_id ? "opponent joined / ready to continue" : "waiting for opponent"}
            </div>
            <motion.button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpen?.();
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97, transition: { duration: 0.1 } }}
              className="bg-black px-4 py-3 font-mono text-[10px] uppercase tracking-[0.24em] text-white/62 transition hover:text-white"
            >
              Open
            </motion.button>
          </div>

          {bet.status === "oracle" ? <OracleRing confidence={bet.confidence_score || 92} /> : null}
        </div>

        <div className="hidden md:block">
          <GlyphPanel status={bet.status} />
        </div>
      </div>
    </motion.div>
  );
}
