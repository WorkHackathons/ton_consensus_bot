import { AnimatePresence, motion } from "framer-motion";
import { TonConnectButton, useTonWallet } from "@tonconnect/ui-react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Background from "./components/Background";
import BetCard from "./components/BetCard";
import Particles from "./components/Particles";
import SuccessExplosion from "./components/SuccessExplosion";
import { API, initData, tg, userId } from "./constants";

const BET_STATUS = {
  pending: "pending",
  active: "active",
  confirming: "confirming",
  oracle: "oracle",
  done: "done",
  refunded: "refunded",
};

const OUTCOME = {
  win: "win",
  lose: "lose",
};

const params = new URLSearchParams(window.location.search);
const initialAction = params.get("action");
const initialBetId = Number(params.get("bet"));
const inviteBetId = initialAction === "join" && Number.isInteger(initialBetId) && initialBetId > 0 ? initialBetId : null;
const TONSCAN_BASE = import.meta.env.VITE_TONSCAN_BASE || "https://testnet.tonscan.org";
const LAST_SELECTED_BET_KEY_PREFIX = "ton-consensus:selected-bet";
const INTRO_SEEN_KEY = "ton-consensus:intro-seen:v1";
const TARGET_TON_NETWORK = import.meta.env.VITE_TON_NETWORK || "testnet";
const EXPECTED_WALLET_CHAIN = TARGET_TON_NETWORK === "mainnet" ? "-239" : "-3";
const LAST_WALLET_ADDRESS_KEY = "ton-consensus:last-wallet-address";

const tabs = [BET_STATUS.pending, BET_STATUS.active, BET_STATUS.oracle, BET_STATUS.done];
const tabLabels = {
  [BET_STATUS.pending]: "OPEN",
  [BET_STATUS.active]: "ACTIVE",
  [BET_STATUS.oracle]: "ORACLE",
  [BET_STATUS.done]: "CLOSED",
  [BET_STATUS.refunded]: "REFUNDED",
};

const tickerItems = [
  "TON CONSENSUS",
  "P2P BETS",
  "AI ORACLE",
  "TELEGRAM NATIVE",
  "TON PAYOUTS",
  "LIVE DISPUTES",
];

const quickDeadlineOptions = [
  { label: "30m", hours: 0.5 },
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 168 },
];
const DEFAULT_DEADLINE_LABEL = "24h";

function isDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function getQuickDeadlineTs(hours) {
  return Math.floor(Date.now() / 1000) + Math.round(hours * 3600);
}

function parseCustomDeadline(value) {
  if (!value) return null;
  const ts = Math.floor(new Date(value).getTime() / 1000);
  return Number.isFinite(ts) ? ts : null;
}

function formatDeadlinePreview(deadlineTs) {
  if (!deadlineTs) return "";
  const date = new Date(deadlineTs * 1000);
  const diff = Math.max(deadlineTs - Math.floor(Date.now() / 1000), 0);
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  return `${date.toLocaleString([], { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} (in ${hours}h ${minutes}m)`;
}

function formatDateTimeLocalValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function shouldReduceVisualFx() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(max-width: 768px), (pointer: coarse), (prefers-reduced-motion: reduce)").matches;
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (initData) {
    headers.set("X-Telegram-Init-Data", initData);
  }
  return fetch(url, { ...options, headers });
}

function humanizeAppError(message = "") {
  if (String(message).toUpperCase().includes("UNAUTHORIZED TELEGRAM SESSION")) {
    return "Open TON Consensus from the Telegram bot so your secure session can be verified.";
  }
  if (String(message).toLowerCase().includes("payout")) {
    return "The result was resolved, but payout could not be sent yet. Please check Telegram notifications and retry later.";
  }
  return message || "Something went wrong.";
}

function isPendingTxHash(value = "") {
  return typeof value === "string" && value.startsWith("pending");
}

function isWinningBetForCurrentUser(bet) {
  if (!bet || !userId || !bet.winner_id) {
    return false;
  }
  return Number(bet.winner_id) === Number(userId);
}

function isLosingBetForCurrentUser(bet) {
  if (!bet || !userId || !bet.winner_id) {
    return false;
  }

  const isParticipant =
    Number(bet?.creator_id || 0) === Number(userId)
    || Number(bet?.opponent_id || 0) === Number(userId);

  return isParticipant && Number(bet.winner_id) !== Number(userId);
}

function getWinnerPayoutAmount(bet) {
  const pot = Number(bet?.amount_ton || 0) * 2;
  const arbiterResolved = Number(bet?.oracle_votes_count || bet?.oracle_votes?.length || 0) >= 2;
  const ratio = arbiterResolved ? 0.85 : 0.9;
  return Number((pot * ratio).toFixed(2));
}

function buildSuccessState(bet, explicitTxHash = "") {
  const txHash = explicitTxHash || bet?.payout_txhash || "";
  const tonscanUrl = txHash && !isPendingTxHash(txHash) ? `${TONSCAN_BASE}/tx/${txHash}` : "";

  if (isWinningBetForCurrentUser(bet)) {
    return {
      variant: "win",
      amount: getWinnerPayoutAmount(bet),
      txHash,
      tonscanUrl,
    };
  }

  if (isLosingBetForCurrentUser(bet)) {
    return {
      variant: "loss",
      amount: 0,
      txHash,
      tonscanUrl,
    };
  }

  return null;
}

function formatOutcomeChoice(outcome, role = "creator") {
  if (!outcome) return "Not submitted";

  if (role === "opponent") {
    if (outcome === OUTCOME.win) return "Claim FALSE";
    if (outcome === OUTCOME.lose) return "Claim TRUE";
    return "Not submitted";
  }

  if (outcome === OUTCOME.win) return "Claim TRUE";
  if (outcome === OUTCOME.lose) return "Claim FALSE";
  return "Not submitted";
}

function getSettlementNotice(bet) {
  if (!bet) {
    return {
      tone: "info",
      text: "Market settled. The payout flow has completed.",
    };
  }

  if (isWinningBetForCurrentUser(bet)) {
    return {
      tone: "success",
      text: "Market settled. You won this round and the payout was released.",
    };
  }

  const isParticipant =
    Number(bet?.creator_id || 0) === Number(userId)
    || Number(bet?.opponent_id || 0) === Number(userId);

  if (isParticipant && Number(bet?.winner_id || 0) > 0) {
    return {
      tone: "info",
      text: "Market settled. The other side won this round.",
    };
  }

  return {
    tone: "info",
    text: "Market settled. The payout flow has completed.",
  };
}

function getResolvedStateBadgeText(bet) {
  if (!bet) return "resolution synced";
  if (isWinningBetForCurrentUser(bet)) return "payout released";

  const isParticipant =
    Number(bet?.creator_id || 0) === Number(userId)
    || Number(bet?.opponent_id || 0) === Number(userId);

  if (isParticipant && Number(bet?.winner_id || 0) > 0) {
    return "result synced";
  }

  return "resolution synced";
}

function getOutcomePayloadForClaim(claimValue, { isCreator, isOpponent }) {
  if (!isCreator && !isOpponent) {
    return null;
  }

  if (claimValue === "true") {
    return isCreator ? OUTCOME.win : OUTCOME.lose;
  }

  if (claimValue === "false") {
    return isCreator ? OUTCOME.lose : OUTCOME.win;
  }

  return null;
}

const actionIntroCopy = {
  join: {
    eyebrow: "Challenge invite",
    title: "A live bet is waiting for your answer.",
    body: "Review the market, join it in one tap, then fund your side directly inside the app.",
    button: "Review bet",
  },
  mybets: {
    eyebrow: "My bets",
    title: "Your markets are now tracked in one place.",
    body: "Inspect status, send deposits, submit outcomes, and watch oracle decisions without leaving the Mini App.",
    button: "Open desk",
  },
  newbet: {
    eyebrow: "New market",
    title: "Launch a challenge without returning to chat.",
    body: "Create the bet here, share it natively through Telegram, and keep the full dispute flow inside the app.",
    button: "Create now",
  },
};

function CountUp({ value, suffix = "", decimals = 0, className = "" }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const target = Number(value) || 0;
    const duration = 600;

    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(target * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <span className={className}>{display.toFixed(decimals)}{suffix}</span>;
}

function TypewriterText({ text, speed = 30, className = "", loop = false }) {
  const [display, setDisplay] = useState("");

  useEffect(() => {
    if (!text) {
      setDisplay("");
      return undefined;
    }

    let timeoutId = 0;
    let index = 0;
    let reverse = false;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;

      if (!loop) {
        setDisplay(text.slice(0, index));
        if (index <= text.length) {
          index += 1;
          timeoutId = window.setTimeout(tick, speed);
        }
        return;
      }

      if (!reverse) {
        setDisplay(text.slice(0, index));
        if (index <= text.length) {
          index += 1;
          timeoutId = window.setTimeout(tick, speed);
        } else {
          reverse = true;
          timeoutId = window.setTimeout(tick, 520);
        }
      } else {
        setDisplay(text.slice(0, index));
        if (index >= 0) {
          index -= 1;
          timeoutId = window.setTimeout(tick, Math.max(24, speed - 4));
        } else {
          reverse = false;
          index = 0;
          timeoutId = window.setTimeout(tick, 260);
        }
      }
    };

    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [loop, speed, text]);

  return <span className={className}>{display}</span>;
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-3 p-4">
      {[0, 1, 2].map((item) => (
        <div key={item} className="overflow-hidden border border-white/10 bg-black p-4">
          <div className="skeleton-line h-3 w-24" />
          <div className="mt-4 skeleton-line h-8 w-[72%]" />
          <div className="mt-2 skeleton-line h-8 w-[58%]" />
          <div className="mt-5 skeleton-line h-3 w-20" />
          <div className="mt-3 skeleton-line h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

function useStickyHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return scrolled;
}

function HeroSphere() {
  const liteFx = shouldReduceVisualFx();
  return (
    <div className="hero-orb-shell relative mx-auto flex h-[220px] w-[220px] max-w-full items-center justify-center md:h-[340px] md:w-[340px]">
      <motion.div className="hero-orb-glow absolute inset-0 rounded-full" animate={liteFx ? { opacity: [0.72, 0.92, 0.72], scale: [1, 1.02, 1] } : { rotate: 360 }} transition={liteFx ? { duration: 3.2, repeat: Infinity, ease: "easeInOut" } : { duration: 18, repeat: Infinity, ease: "linear" }} />
      <motion.div className="hero-orb-ring absolute inset-[16px] rounded-full border border-white/10" animate={liteFx ? { opacity: [0.45, 0.82, 0.45] } : { rotate: -360 }} transition={liteFx ? { duration: 2.8, repeat: Infinity, ease: "easeInOut" } : { duration: 26, repeat: Infinity, ease: "linear" }} />
      <motion.div className="hero-orb-ring absolute inset-[44px] rounded-full border border-white/8" animate={liteFx ? { opacity: [0.3, 0.6, 0.3] } : { rotate: 360 }} transition={liteFx ? { duration: 3.6, repeat: Infinity, ease: "easeInOut" } : { duration: 32, repeat: Infinity, ease: "linear" }} />
      <motion.div className="hero-orb-core relative flex h-[72%] w-[72%] items-center justify-center rounded-full border border-white/12" animate={liteFx ? { y: [0, -4, 0], scale: [1, 1.01, 1] } : { y: [0, -8, 0], rotateX: [0, 8, 0], rotateY: [0, -8, 0] }} transition={{ duration: liteFx ? 4.2 : 8, repeat: Infinity, ease: "easeInOut" }}>
        <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_30%,rgba(255,255,255,0.18),rgba(255,255,255,0.04)_40%,rgba(0,152,234,0.08)_65%,transparent_78%)]" />
        <div className="text-center">
          <div className="display-title text-[34px] font-semibold uppercase text-white md:text-[58px]">TON</div>
          <div className="display-title -mt-1 text-[34px] font-semibold uppercase text-white md:text-[58px]">CONSENSUS</div>
          <div className="mt-3 px-3 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 md:mt-4 md:px-0 md:text-[10px] md:tracking-[0.24em]">BETS / DISPUTES / ORACLE</div>
        </div>
      </motion.div>
    </div>
  );
}

function WelcomeScreen({ onEnter }) {
  return (
    <motion.section className="flex min-h-[100svh] items-center justify-center px-5" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -30, opacity: 0 }} transition={{ duration: 0.25, ease: "easeOut" }}>
      <div className="w-full max-w-md">
        <div className="panel-surface border border-white/10 p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">Telegram Mini App</div>
          <div className="mt-5 flex items-center justify-center border border-white/10 py-8"><HeroSphere /></div>
          <div className="mt-5 grid gap-px border border-white/10 bg-white/5 sm:grid-cols-3">
            <div className="bg-black p-4 font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">lock</div>
            <div className="bg-black p-4 font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">verify</div>
            <div className="bg-black p-4 font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">settle</div>
          </div>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95, boxShadow: "0 0 24px rgba(255,255,255,0.16)" }} transition={{ duration: 0.1 }} onClick={onEnter} className="mt-5 w-full rounded-full border border-white bg-white px-6 py-4 font-mono text-[11px] uppercase tracking-[0.28em] text-black">Enter App</motion.button>
        </div>
      </div>
    </motion.section>
  );
}

function IntroSequenceOverlay({ open, onDone }) {
  const liteFx = shouldReduceVisualFx();
  const [step, setStep] = useState(0);
  const sequence = [
    { label: "SYNC", text: "Linking Telegram identity" },
    { label: "VAULT", text: "Preparing TON settlement rails" },
    { label: "ORACLE", text: "Arming dispute resolution mode" },
  ];

  useEffect(() => {
    if (!open) {
      setStep(0);
      return undefined;
    }

    const timers = sequence.map((_, index) => window.setTimeout(() => setStep(index + 1), 720 + index * (liteFx ? 1250 : 1180)));
    const finish = window.setTimeout(onDone, liteFx ? 5600 : 4950);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(finish);
    };
  }, [liteFx, open, onDone]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={`fixed inset-0 z-[115] flex items-center justify-center bg-black/82 px-4 ${liteFx ? "" : "backdrop-blur-[16px]"}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: liteFx ? 0.32 : 0.24, ease: "easeOut" }}
        >
          <motion.div
            className="pointer-events-none absolute inset-0 opacity-80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className={`absolute left-[8%] top-[14%] h-40 w-40 rounded-full bg-[#0098EA]/10 ${liteFx ? "blur-[42px]" : "blur-[80px]"}`}
              animate={liteFx ? { opacity: [0.36, 0.52, 0.36], scale: [1, 1.02, 1] } : { x: [0, 28, 0], y: [0, -16, 0] }}
              transition={{ duration: liteFx ? 6.2 : 8, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className={`absolute bottom-[16%] right-[10%] h-48 w-48 rounded-full bg-white/6 ${liteFx ? "blur-[48px]" : "blur-[96px]"}`}
              animate={liteFx ? { opacity: [0.18, 0.28, 0.18], scale: [1, 1.015, 1] } : { x: [0, -24, 0], y: [0, 18, 0] }}
              transition={{ duration: liteFx ? 6.8 : 10, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute left-0 right-0 top-[22%] h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
              animate={liteFx ? { opacity: [0.08, 0.14, 0.08] } : { opacity: [0.18, 0.55, 0.18], scaleX: [0.92, 1, 0.92] }}
              transition={{ duration: liteFx ? 6.4 : 2.6, repeat: Infinity, ease: "easeInOut" }}
            />
            {!liteFx ? (
              <motion.div
                className="absolute left-0 right-0 top-[22%] h-px bg-gradient-to-r from-transparent via-[#0098EA]/35 to-transparent"
                animate={{ x: ["-18%", "18%", "-18%"] }}
                transition={{ duration: 4.4, repeat: Infinity, ease: "easeInOut" }}
              />
            ) : null}
          </motion.div>
          <motion.div
            className="panel-surface w-full max-w-lg border border-white/10 p-5 md:p-6"
            initial={{ opacity: 0, y: 24, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.99 }}
            transition={{ duration: liteFx ? 0.38 : 0.28, ease: "easeOut" }}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/28">Launch Sequence</div>
            <div className="mt-5 overflow-hidden rounded-full border border-white/10 bg-white/[0.03] p-1">
              <motion.div
                className="h-1 rounded-full bg-gradient-to-r from-[#0098EA]/70 via-white/80 to-[#0098EA]/70"
                initial={{ width: "0%" }}
                animate={{ width: `${Math.max((step / sequence.length) * 100, 8)}%` }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              />
            </div>
            <div className="display-title mt-5 text-[30px] font-semibold leading-[1.02] text-white md:text-[38px]">
              Entering the dispute desk
            </div>
            <div className="mt-4 text-sm leading-7 text-white/52">
              A short product-style intro with calm motion, just enough to feel premium without slowing the flow down.
            </div>
            {liteFx ? <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/28">Mobile-optimized motion</div> : null}
            <div className="mt-6 grid gap-px border border-white/10 bg-white/5">
              {sequence.map((item, index) => {
                const active = step > index;
                return (
                  <motion.div
                    key={item.label}
                    className={`relative flex items-center justify-between overflow-hidden bg-black px-4 py-4 ${active ? "text-white" : "text-white/28"}`}
                    initial={false}
                    animate={liteFx ? { opacity: active ? 1 : 0.45 } : { opacity: active ? 1 : 0.45, x: active ? 0 : -8 }}
                    transition={{ duration: liteFx ? 0.42 : 0.28, ease: "easeOut" }}
                  >
                    {active && !liteFx ? (
                      <motion.div
                        className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#0098EA]/14 to-transparent"
                        initial={{ x: "-120%" }}
                        animate={{ x: "220%" }}
                        transition={{ duration: 0.9, ease: "easeOut" }}
                      />
                    ) : null}
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.24em]">{item.label}</div>
                      <div className="mt-2 text-sm">{item.text}</div>
                    </div>
                    <motion.div
                      className={`h-2.5 w-2.5 rounded-full ${active ? "bg-[#0098EA]" : "bg-white/14"}`}
                      animate={active ? { scale: [1, liteFx ? 1.18 : 1.4, 1], opacity: [1, 0.72, 1] } : { scale: 1, opacity: 1 }}
                      transition={{ duration: liteFx ? 2.4 : 1.8, repeat: active ? Infinity : 0, ease: "easeInOut" }}
                    />
                  </motion.div>
                );
              })}
            </div>
            <div className="mt-6 flex justify-end">
              <motion.button
                type="button"
                onClick={onDone}
                className="rounded-full border border-white/12 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/72"
                whileTap={{ scale: 0.97 }}
              >
                Skip intro
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function CreateBetModal({ value, onChange, onClose, onSubmit, busy, error, deadlinePreview, deadlineError, canSubmit, liteFx }) {
  const customMin = formatDateTimeLocalValue(new Date(Date.now() + 10 * 60 * 1000));
  const customMax = formatDateTimeLocalValue(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

  return (
    <motion.div className={`fixed inset-0 z-[130] flex items-end justify-center overflow-y-auto bg-black/60 px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:items-center md:px-4 md:py-6 ${liteFx ? "" : "backdrop-blur-[18px]"}`} style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div className="panel-surface my-auto flex max-h-[calc(100dvh-1rem-env(safe-area-inset-bottom))] w-full max-w-2xl flex-col overflow-hidden border border-white/10 p-5 md:max-h-[calc(100dvh-3rem)] md:p-6" style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }} initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 400, damping: 40 }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/32">Create Bet</div>
            <div className="display-title mt-2 text-[34px] font-semibold text-white">Launch a new market</div>
          </div>
          <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95, boxShadow: "0 0 20px rgba(255,255,255,0.14)" }} transition={{ duration: 0.1 }} onClick={onClose} className="rounded-full border border-white/12 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/72">Close</motion.button>
        </div>
        <div className="smooth-scroll-area mt-6 min-h-0 flex-1 overflow-y-auto pr-1 touch-pan-y" style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
        <div className="grid gap-4 pb-6">
            <label className="grid gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">Description</span>
            <textarea value={value.description} onChange={(event) => onChange("description", event.target.value)} rows={4} placeholder="Example: Will BTC be below 80,000 USD on March 21 at 18:00 UTC?" className="min-h-[120px] resize-none border border-white/10 bg-black px-4 py-4 font-mono text-sm text-white outline-none placeholder:text-white/20" />
            </label>
          <label className="grid gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">Stake in TON</span>
            <input value={value.amount_ton} onChange={(event) => onChange("amount_ton", event.target.value)} placeholder="1.5" className="border border-white/10 bg-black px-4 py-4 font-mono text-sm text-white outline-none placeholder:text-white/20" />
          </label>
          <div className="grid gap-4 border border-[#0098EA]/18 bg-[radial-gradient(circle_at_top,rgba(0,152,234,0.08),transparent_52%)] p-4 md:p-5">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8fd9ff]">Time Window</div>
              <div className="mt-2 text-sm leading-6 text-white/52">
                Choose when this market expires. Keep the description focused on the event itself, then set the closing time here.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {quickDeadlineOptions.map((option) => (
                <motion.button
                  key={option.label}
                  type="button"
                  onClick={() => onChange("deadlinePreset", option.label)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.95, boxShadow: "0 0 18px rgba(255,255,255,0.12)" }}
                  transition={{ duration: 0.1 }}
                  className={`rounded-full border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
                    value.deadlinePreset === option.label ? "border-white bg-white text-black" : "border-white/12 bg-black/50 text-white/68 hover:border-white/24 hover:text-white"
                  }`}
                >
                  {option.label}
                </motion.button>
              ))}
              <motion.button
                type="button"
                onClick={() => onChange("deadlinePreset", "custom")}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95, boxShadow: "0 0 18px rgba(255,255,255,0.12)" }}
                transition={{ duration: 0.1 }}
                className={`rounded-full border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
                  value.deadlinePreset === "custom" ? "border-white bg-white text-black" : "border-white/12 bg-black/50 text-white/68 hover:border-white/24 hover:text-white"
                }`}
              >
                Custom
              </motion.button>
            </div>
            {value.deadlinePreset === "custom" ? (
              <div className="grid gap-3 border border-white/10 bg-black/60 p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
                  Pick your local date and time
                </div>
                <input
                  type="datetime-local"
                  min={customMin}
                  max={customMax}
                  value={value.customDeadline}
                  onChange={(event) => onChange("customDeadline", event.target.value)}
                  className="border border-white/10 bg-black px-4 py-4 font-mono text-sm text-white outline-none [color-scheme:dark]"
                />
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/28">
                  Minimum 10 minutes from now. Maximum 30 days.
                </div>
              </div>
            ) : null}
            {deadlinePreview ? (
              <div className="border border-[#8fd9ff]/20 bg-[#0098EA]/[0.08] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#8fd9ff]">
                Expires: {deadlinePreview}
              </div>
            ) : null}
            {deadlineError ? (
              <div className="border border-[#ff8f90]/20 bg-[#ff8f90]/8 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#ff8f90]">
                {deadlineError}
              </div>
            ) : null}
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/28">
              Example: description = "Will BTC be below 90,000 USD?" and time window = 30m, 1h, 24h, or a custom local date/time.
            </div>
          </div>
        </div>
        </div>
        {error ? <div className="mt-4 border border-[#ff4d4f]/30 bg-[#ff4d4f]/8 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#ff8f90]">{error}</div> : null}
        <div className="sticky bottom-0 mt-6 flex flex-wrap gap-3 border-t border-white/8 bg-black/86 pt-4 pb-1 backdrop-blur-[18px]">
          <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95, boxShadow: "0 0 24px rgba(255,255,255,0.16)" }} transition={{ duration: 0.1 }} onClick={onSubmit} disabled={busy || !canSubmit} className="action-button-primary disabled:opacity-40">{busy ? "Creating..." : "Create Bet"}</motion.button>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">Opponent joins and resolves inside the Mini App.</div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SectionHeader({ title, aside }) {
  return (
    <div className="section-line mb-4 flex items-end justify-between gap-4 pb-3">
      <div className="display-title text-[32px] font-semibold uppercase leading-none text-white md:text-[42px]">{title}</div>
      {aside ? <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/28">{aside}</div> : null}
    </div>
  );
}

function ActionIntroOverlay({ action, bet, onContinue }) {
  const copy = actionIntroCopy[action];

  if (!copy) {
    return null;
  }

  return (
    <motion.div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/86 px-4 py-6 backdrop-blur-[18px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24 }}
    >
      <motion.div
        className="panel-surface w-full max-w-xl border border-white/10 p-5 md:p-6"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ duration: 0.26 }}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/28">{copy.eyebrow}</div>
        <div className="mt-6 flex items-center justify-center border border-white/10 py-8">
          <HeroSphere />
        </div>
        <div className="display-title mt-6 text-[30px] font-semibold leading-[1.02] text-white md:text-[38px]">{copy.title}</div>
        <div className="mt-4 max-w-lg text-sm leading-7 text-white/55">{copy.body}</div>
        {bet ? (
          <div className="mt-5 border border-white/10 bg-white/[0.03] p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/32">selected bet</div>
            <div className="market-title-safe mt-2 min-w-0 overflow-hidden display-title text-[22px] font-semibold text-white md:text-[24px]">{bet.description}</div>
            <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#0098EA]">{bet.amount_ton} TON each</div>
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onContinue}
            className="rounded-full border border-white bg-white px-6 py-3 font-mono text-[10px] uppercase tracking-[0.24em] text-black"
          >
            {copy.button}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function App() {
  const liteFx = shouldReduceVisualFx();
  const depositGuideRef = useRef(null);
  const [screen, setScreen] = useState(initialAction ? "main" : "welcome");
  const [directBetLock, setDirectBetLock] = useState(() => inviteBetId || initialBetId || null);
  const [introSequenceOpen, setIntroSequenceOpen] = useState(() => {
    if (typeof window === "undefined") return Boolean(initialAction);
    const introSeen = window.localStorage.getItem(INTRO_SEEN_KEY) === "1";
    return Boolean(initialAction) && !introSeen;
  });
  const [tab, setTab] = useState(BET_STATUS.pending);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBet, setSelectedBet] = useState(null);
  const [count, setCount] = useState(0);
  const [successState, setSuccessState] = useState(null);
  const [appError, setAppError] = useState("");
  const [createOpen, setCreateOpen] = useState(initialAction === "newbet");
  const [createBusy, setCreateBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [createForm, setCreateForm] = useState({
    description: "",
    amount_ton: "1.0",
    deadlinePreset: DEFAULT_DEADLINE_LABEL,
    customDeadline: "",
    deadlineTs: getQuickDeadlineTs(24),
  });
  const [platformWallet, setPlatformWallet] = useState("");
  const [walletBalance, setWalletBalance] = useState(null);
  const [walletBalanceBusy, setWalletBalanceBusy] = useState(false);
  const [walletPulse, setWalletPulse] = useState(false);
  const [actionIntroOpen, setActionIntroOpen] = useState(Boolean(initialAction));
  const [joinFocused, setJoinFocused] = useState(initialAction === "join");
  const [depositMode, setDepositMode] = useState(false);
  const [depositFlash, setDepositFlash] = useState(false);
  const [shareFlash, setShareFlash] = useState(false);
  const [joinFlash, setJoinFlash] = useState(false);
  const [statusNotice, setStatusNotice] = useState(null);
  const [selectionPulseId, setSelectionPulseId] = useState(null);
  const [initialTabResolved, setInitialTabResolved] = useState(false);
  const [depositRetryUntil, setDepositRetryUntil] = useState(0);
  const [depositAttemptError, setDepositAttemptError] = useState("");
  const [me, setMe] = useState(null);
  const prevStatusesRef = useRef(new Map());
  const refreshInFlightRef = useRef(false);
  const selectedSyncInFlightRef = useRef(false);
  const selectedMetaRef = useRef({ status: null, opponentId: null });
  const wallet = useTonWallet();
  const scrolled = useStickyHeader();
  const marquee = useMemo(() => [...tickerItems, ...tickerItems].join("  /  "), []);
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  const selectedBetStorageKey = useMemo(
    () => `${LAST_SELECTED_BET_KEY_PREFIX}:${userId || "guest"}`,
    [userId],
  );
  const persistedBetId = useMemo(() => {
    if (typeof window === "undefined") return null;
    if (directBetLock) return null;
    const raw = window.localStorage.getItem(selectedBetStorageKey);
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [directBetLock, selectedBetStorageKey]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowTs(Math.floor(Date.now() / 1000)), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || !tg) {
      return undefined;
    }

    const applyViewportHeight = () => {
      const height = Number(tg.viewportHeight || 0);
      if (height > 0) {
        document.body.style.height = `${height}px`;
      }
    };

    applyViewportHeight();
    tg.onEvent?.("viewportChanged", applyViewportHeight);

    return () => {
      tg.offEvent?.("viewportChanged", applyViewportHeight);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const previousBodyOverflow = document.body.style.overflow;
    if (createOpen) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [createOpen]);

  const flashStatusNotice = useCallback((tone, text) => {
    setStatusNotice({ tone, text });
    window.setTimeout(() => {
      setStatusNotice((current) => (current?.text === text ? null : current));
    }, 2600);
  }, []);

  useEffect(() => {
    if (!wallet?.account?.address || !userId) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_WALLET_ADDRESS_KEY, wallet.account.address);
    }
    tg?.HapticFeedback?.notificationOccurred("success");
    setWalletPulse(true);
    window.setTimeout(() => setWalletPulse(false), 1400);
    apiFetch(`${API}/api/user/address`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id: userId, address: wallet.account.address }),
    })
      .then(() => {
        setMe((current) => ({
          telegram_id: userId,
          username: current?.username ?? null,
          arbiter_since: current?.arbiter_since ?? null,
          is_premium_arbiter: Number(current?.is_premium_arbiter ?? 0),
          referral_earnings: Number(current?.referral_earnings ?? 0),
          ton_address: wallet.account.address,
        }));
      })
      .catch(() => {});
  }, [userId, wallet?.account?.address]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const loadMe = () => {
      apiFetch(`${API}/api/me`)
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled && data?.telegram_id) {
            setMe(data);
          }
        })
        .catch(() => {});
    };

    loadMe();
    const interval = window.setInterval(() => {
      if (isDocumentVisible()) {
        loadMe();
      }
    }, 8000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadMe();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [userId, wallet?.account?.address]);

  useEffect(() => {
    apiFetch(`${API}/api/platform-wallet`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.address) setPlatformWallet(data.address);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!wallet?.account?.address) {
      setWalletBalance(null);
      setWalletBalanceBusy(false);
      return;
    }

    let cancelled = false;
    setWalletBalanceBusy(true);
    apiFetch(`${API}/api/wallet-balance?address=${encodeURIComponent(wallet.account.address)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setWalletBalance(Number(data?.balanceTon ?? 0));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWalletBalance(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWalletBalanceBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [wallet?.account?.address]);

  useEffect(() => {
    const targetBetId = directBetLock || null;
    if (!targetBetId) {
      return;
    }

    let cancelled = false;

    const loadDirectBet = async () => {
      try {
          const res = await apiFetch(`${API}/api/bet/${targetBetId}`);
        const data = await res.json();
        if (!res.ok || cancelled || !data?.id) {
          return;
        }

        if ((directBetLock || !selectedBet) && data.status && data.status !== tab) {
          setTab(data.status);
        }

        setSelectedBet(data);
        setBets((current) => {
          const exists = current.some((bet) => Number(bet.id) === Number(data.id));
          if (exists) {
            return current.map((bet) => (Number(bet.id) === Number(data.id) ? data : bet));
          }
          return [data, ...current];
        });
      } catch {
      }
    };

    loadDirectBet();
    return () => {
      cancelled = true;
    };
  }, [directBetLock, selectedBet?.id]);

  useEffect(() => {
    if (initialAction !== "mybets" || !userId || initialTabResolved) {
      return;
    }

    apiFetch(`${API}/api/bets/user/${userId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data) || !data.length) {
          setInitialTabResolved(true);
          return;
        }

        const preferred = data.find((bet) => bet.status === BET_STATUS.active)
          || data.find((bet) => bet.status === BET_STATUS.oracle)
          || data.find((bet) => bet.status === BET_STATUS.pending)
          || data[0];

        if (preferred?.status && preferred.status !== tab) {
          setTab(preferred.status);
        }
        setSelectedBet(preferred || null);
        setInitialTabResolved(true);
      })
      .catch(() => setInitialTabResolved(true));
  }, [initialTabResolved, tab]);

  const refreshBets = useCallback(async (preferredBetId = null, options = {}) => {
    const quiet = options.quiet === true;
    const forceIncludePreferred = options.forceIncludePreferred === true;
    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    if (!quiet) {
      setLoading(true);
      setAppError("");
    }
    try {
      let data = [];
      if (userId) {
        const userRes = await apiFetch(`${API}/api/bets/user/${userId}`);
        const userRaw = await userRes.json();
        if (!userRes.ok) throw new Error(userRaw.error || "Failed to load bets");
        data = userRaw.filter((bet) => {
          if (bet.status === tab) return true;
          if (tab === BET_STATUS.done && bet.status === BET_STATUS.refunded) return true;
          if (forceIncludePreferred && preferredBetId && Number(bet.id) === Number(preferredBetId)) return true;
          return false;
        });

      } else {
        const res = await apiFetch(`${API}/api/bets?status=${tab}`);
        const raw = await res.json();
        if (!res.ok) throw new Error(raw.error || "Failed to load bets");
        data = raw;
      }
      const nextMap = new Map();
      data.forEach((bet) => {
        const prev = prevStatusesRef.current.get(bet.id);
        if (prev && prev !== BET_STATUS.done && bet.status === BET_STATUS.done) {
          const nextSuccessState = buildSuccessState(bet);
          if (nextSuccessState) {
            setSuccessState((current) => current || nextSuccessState);
          }
        }
        nextMap.set(bet.id, bet.status);
      });
        startTransition(() => {
          prevStatusesRef.current = nextMap;
          setCount(data.length);
          setBets(data);
          setSelectedBet((current) => {
            if (!data.length) {
              if (preferredBetId && current && Number(current.id) === Number(preferredBetId)) {
                return current;
              }
              return null;
            }
            if (directBetLock) {
              const invited = data.find((bet) => Number(bet.id) === Number(directBetLock));
              if (invited) return invited;
            }
            if (preferredBetId) {
              const preferred = data.find((bet) => Number(bet.id) === Number(preferredBetId));
              if (preferred) return preferred;
            }
            if (current) {
              const found = data.find((bet) => Number(bet.id) === Number(current.id));
              if (found) return found;
            }
            if (directBetLock) {
              const fromQuery = data.find((bet) => Number(bet.id) === Number(directBetLock));
              if (fromQuery) return fromQuery;
            }
            if (persistedBetId) {
              const fromStorage = data.find((bet) => Number(bet.id) === Number(persistedBetId));
              if (fromStorage) return fromStorage;
            }
            return data[0];
          });
        });
    } catch (error) {
      startTransition(() => {
        setBets([]);
        setCount(0);
        setSelectedBet(null);
        setAppError(error.message || "Failed to load bets");
      });
    } finally {
      refreshInFlightRef.current = false;
      if (!quiet) {
        setLoading(false);
      }
    }
  }, [directBetLock, persistedBetId, tab, userId]);

  useEffect(() => {
    refreshBets(directBetLock || null, {
      forceIncludePreferred: Boolean(directBetLock),
    });
  }, [directBetLock, persistedBetId, refreshBets]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!isDocumentVisible()) {
        return;
      }
      const selectedMatchesTab = Boolean(
        selectedBet && (
          selectedBet.status === tab ||
          (tab === BET_STATUS.done && selectedBet.status === BET_STATUS.refunded)
        ),
      );
      refreshBets(selectedMatchesTab ? selectedBet?.id : directBetLock || null, {
        quiet: true,
        forceIncludePreferred: Boolean(directBetLock),
      });
    }, 10000);

    return () => window.clearInterval(interval);
  }, [directBetLock, refreshBets, selectedBet?.id, selectedBet?.status, tab]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (directBetLock) {
      return;
    }

    if (selectedBet?.id) {
      window.localStorage.setItem(selectedBetStorageKey, String(selectedBet.id));
    }
  }, [directBetLock, selectedBet?.id, selectedBetStorageKey]);

  useEffect(() => {
    if (!selectedBet) {
      selectedMetaRef.current = { status: null, opponentId: null };
      return;
    }

    if (directBetLock && Number(selectedBet.id) === Number(directBetLock)) {
      setJoinFocused(true);
    }

    if (
      selectedBet.status === BET_STATUS.pending &&
      selectedBet.opponent_id &&
      userId &&
      (Number(selectedBet.creator_id) === Number(userId) || Number(selectedBet.opponent_id) === Number(userId))
      ) {
        setDepositMode(true);
      }
    }, [directBetLock, selectedBet]);

  useEffect(() => {
    if (!selectedBet) {
      return;
    }

    const previous = selectedMetaRef.current;
    const current = {
      status: selectedBet.status || null,
      opponentId: selectedBet.opponent_id || null,
    };

    if (
      previous.opponentId == null &&
      current.opponentId != null &&
      Number(selectedBet.creator_id) === Number(userId)
    ) {
      flashStatusNotice("success", "Opponent joined. Both sides can proceed to deposit now.");
    }

    if (previous.status && previous.status !== current.status) {
      if (current.status === BET_STATUS.active) {
        flashStatusNotice("success", "Deposits are locked. The market is now active.");
      } else if (current.status === BET_STATUS.confirming) {
        flashStatusNotice("info", "One side submitted an outcome. Waiting for the other side.");
      } else if (current.status === BET_STATUS.oracle) {
        flashStatusNotice("info", "Dispute detected. The oracle is now resolving this market.");
      } else if (current.status === BET_STATUS.done) {
        const settlementNotice = getSettlementNotice(selectedBet);
        flashStatusNotice(settlementNotice.tone, settlementNotice.text);
        setTab(BET_STATUS.done);
      } else if (current.status === BET_STATUS.refunded) {
        flashStatusNotice("info", "Market expired. Funds were returned automatically.");
        setTab(BET_STATUS.done);
      }
    }

    selectedMetaRef.current = current;
  }, [flashStatusNotice, selectedBet, userId]);

  useEffect(() => {
    if (!selectedBet || ![BET_STATUS.pending, BET_STATUS.active, BET_STATUS.confirming, BET_STATUS.oracle].includes(selectedBet.status)) {
      return undefined;
    }

    const intervalMs = selectedBet.status === BET_STATUS.oracle ? 5000 : 7000;
    const interval = window.setInterval(async () => {
      if (!isDocumentVisible() || selectedSyncInFlightRef.current) {
        return;
      }

      selectedSyncInFlightRef.current = true;
      try {
        const res = await apiFetch(`${API}/api/bet/${selectedBet.id}`);
        const data = await res.json();
        if (!res.ok || !data?.id) {
          return;
        }

        startTransition(() => {
          setSelectedBet((current) => (Number(current?.id) === Number(data.id) ? data : current));
          setBets((current) => current.map((bet) => (Number(bet.id) === Number(data.id) ? { ...bet, ...data } : bet)));
        });

        if (data.status === BET_STATUS.done) {
          setTab(BET_STATUS.done);
          const nextSuccessState = buildSuccessState(data);
          if (nextSuccessState) {
            setSuccessState((current) => current || nextSuccessState);
          }
        }
      } catch {
      } finally {
        selectedSyncInFlightRef.current = false;
      }
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [selectedBet?.id, selectedBet?.status]);

  const setCreateField = (field, value) => {
    setCreateForm((current) => {
      if (field === "deadlinePreset") {
        if (value === "custom") {
          return { ...current, deadlinePreset: value, deadlineTs: null };
        }

        const option = quickDeadlineOptions.find((item) => item.label === value);
        return {
          ...current,
          deadlinePreset: value,
          customDeadline: "",
          deadlineTs: option ? getQuickDeadlineTs(option.hours) : null,
        };
      }

      if (field === "customDeadline") {
        return {
          ...current,
          customDeadline: value,
          deadlineTs: parseCustomDeadline(value),
        };
      }

      return { ...current, [field]: value };
    });
  };
  const createDeadlineTs = createForm.deadlineTs;
  const createDeadlineError = createDeadlineTs
    ? createDeadlineTs < nowTs + 600
      ? "Deadline must be at least 10 minutes from now"
      : createDeadlineTs > nowTs + 30 * 24 * 3600
        ? "Deadline cannot be more than 30 days from now"
        : ""
    : "";
  const createDeadlinePreview = createDeadlineTs ? formatDeadlinePreview(createDeadlineTs) : "";
  const canSubmitCreate = Boolean(createDeadlineTs && !createDeadlineError && createForm.description.trim() && Number(createForm.amount_ton) > 0);

  const handleTab = (nextTab) => {
    tg?.HapticFeedback?.selectionChanged();
    setDirectBetLock(null);
    setJoinFocused(false);
    setDepositMode(false);
    setActionIntroOpen(false);
    setTab(nextTab);
  };

  const handleCreateBet = () => {
    tg?.HapticFeedback?.impactOccurred("medium");
    setAppError("");
    setCreateForm((current) => (
      current.deadlineTs
        ? current
        : {
            ...current,
            deadlinePreset: DEFAULT_DEADLINE_LABEL,
            customDeadline: "",
            deadlineTs: getQuickDeadlineTs(24),
          }
    ));
    setCreateOpen(true);
  };

  const handleSelectBet = (bet) => {
    setDirectBetLock(null);
    setJoinFocused(false);
    setSelectedBet(bet);
    if (!directBetLock) {
      window.localStorage.setItem(selectedBetStorageKey, String(bet.id));
    }
    setSelectionPulseId(bet.id);
    window.setTimeout(() => {
      setSelectionPulseId((current) => (current === bet.id ? null : current));
    }, 520);
  };

  const handleSubmitCreateBet = async () => {
    if (!userId) {
      setAppError("Open the Mini App inside Telegram to create bets.");
      return;
    }
    if (!canSubmitCreate || !createDeadlineTs) {
      setAppError(createDeadlineError || "Choose a valid deadline before creating the bet.");
      return;
    }
    setCreateBusy(true);
    setAppError("");
    try {
      const res = await apiFetch(`${API}/api/bets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creator_id: userId,
          description: createForm.description,
          amount_ton: Number(createForm.amount_ton),
          deadline: createDeadlineTs,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create bet");
      tg?.HapticFeedback?.notificationOccurred("success");
      setCreateOpen(false);
      setCreateForm({
        description: "",
        amount_ton: "1.0",
        deadlinePreset: DEFAULT_DEADLINE_LABEL,
        customDeadline: "",
        deadlineTs: getQuickDeadlineTs(24),
      });
      setActionIntroOpen(false);
      setTab(BET_STATUS.pending);
      await refreshBets(data.bet?.id);
    } catch (error) {
      setAppError(humanizeAppError(error.message));
    } finally {
      setCreateBusy(false);
    }
  };

  const handleShareSelected = async () => {
    if (!selectedBet) return;
    const inviteUrl = `https://t.me/ton_consensus_bot?start=join_${selectedBet.id}`;
    const shareCopy =
      `⚖️ TON Consensus Challenge\n\n` +
      `"${selectedBet.description}"\n\n` +
      `Stake: ${selectedBet.amount_ton} TON each\n` +
      `Bet #${selectedBet.id}\n` +
      `AI Oracle resolves the dispute if both sides disagree.\n\n` +
      `Open the Telegram bot below to accept this challenge.`;
    const shareUrl =
      `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}` +
      `&text=${encodeURIComponent(shareCopy)}`;
    tg?.HapticFeedback?.impactOccurred("light");
    const isIosWebView = tg?.platform === "ios" || /iPad|iPhone|iPod/i.test(window.navigator.userAgent || "");

    if (!isIosWebView && tg?.switchInlineQuery) {
      setShareFlash(true);
      window.setTimeout(() => setShareFlash(false), 1600);
      tg.switchInlineQuery(`bet_${selectedBet.id}`, ["users", "groups", "channels"]);
      return;
    }

    if (tg?.openTelegramLink) {
      setShareFlash(true);
      window.setTimeout(() => setShareFlash(false), 1600);
      tg.openTelegramLink(shareUrl);
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setShareFlash(true);
      window.setTimeout(() => setShareFlash(false), 1600);
      setAppError("Invite link copied. Share it with your opponent.");
    } catch {
      window.open(shareUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleJoinSelected = async () => {
    if (!selectedBet || !userId) return;
    setActionBusy("join");
    setAppError("");
    try {
      const res = await apiFetch(`${API}/api/bets/${selectedBet.id}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opponent_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to join bet");
        tg?.HapticFeedback?.notificationOccurred("success");
        setDirectBetLock(null);
        setJoinFocused(false);
        setDepositMode(true);
        setJoinFlash(true);
        window.setTimeout(() => setJoinFlash(false), 1700);
        flashStatusNotice("info", "Challenge accepted. Your side is now unlocked for deposit.");
        setActionIntroOpen(false);
        setSelectedBet(data.bet || selectedBet);
        await refreshBets(data.bet?.id);
        window.setTimeout(() => {
          depositGuideRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 180);
    } catch (error) {
      setAppError(humanizeAppError(error.message));
    } finally {
      setActionBusy("");
    }
  };

  const handleConfirmDeposit = async () => {
    if (!selectedBet || !userId) return;
    setActionBusy("deposit");
    setAppError("");
    setDepositAttemptError("");
    try {
      const storedWalletAddress = typeof window !== "undefined" ? window.localStorage.getItem(LAST_WALLET_ADDRESS_KEY) : "";
      const connectedWalletAddress = wallet?.account?.address || me?.ton_address || storedWalletAddress;
      if (!connectedWalletAddress) {
        throw new Error("Connect your TON wallet first.");
      }
      const res = await apiFetch(`${API}/api/bets/${selectedBet.id}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_id: userId, userWalletAddress: connectedWalletAddress }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to confirm deposit");
        tg?.HapticFeedback?.notificationOccurred("success");
        setDepositMode(false);
        setDepositRetryUntil(0);
        setDepositFlash(true);
        window.setTimeout(() => setDepositFlash(false), 1400);
        flashStatusNotice("info", "Deposit verified on-chain.");
        await refreshBets(data.bet?.id);
    } catch (error) {
      const friendlyError = humanizeAppError(error.message);
      setAppError(friendlyError);
      setDepositAttemptError(friendlyError);
      if ((friendlyError || "").includes("Transaction not found")) {
        setDepositRetryUntil(Date.now() + 30_000);
      }
    } finally {
      setActionBusy("");
    }
  };

  const handleSubmitOutcome = async (outcome) => {
    if (!selectedBet || !userId) return;
    setActionBusy(outcome);
    setAppError("");
    try {
      const res = await apiFetch(`${API}/api/bets/${selectedBet.id}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_id: userId, outcome }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit outcome");
      tg?.HapticFeedback?.notificationOccurred("success");
      if (data.stage === "settled" && data.txHash) {
        const nextSuccessState = buildSuccessState(data.bet || selectedBet, data.txHash);
        if (nextSuccessState) {
          setSuccessState(nextSuccessState);
        }
      }
      await refreshBets(data.bet?.id || selectedBet.id);
    } catch (error) {
      setAppError(humanizeAppError(error.message));
    } finally {
      setActionBusy("");
    }
  };

  const handleHideSelected = async () => {
    if (!selectedBet) return;
    setActionBusy("hide");
    setAppError("");
    try {
      const res = await apiFetch(`${API}/api/bets/${selectedBet.id}/hide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove bet");
      flashStatusNotice("success", "This market was removed from your list.");
      const nextBets = bets.filter((bet) => Number(bet.id) !== Number(selectedBet.id));
      setBets(nextBets);
      setCount(nextBets.length);
      setSelectedBet(nextBets[0] || null);
    } catch (error) {
      setAppError(humanizeAppError(error.message));
    } finally {
      setActionBusy("");
    }
  };

  const handleCopyPlatformWallet = async () => {
    if (!platformWallet) return;
    try {
      await navigator.clipboard.writeText(platformWallet);
      setAppError("Platform wallet copied. Send your stake, then tap I Sent Deposit.");
    } catch {
      setAppError("Copy failed. Hold and copy the wallet address manually.");
    }
  };

  const handleActionIntroContinue = () => {
    if (initialAction === "newbet") {
      setCreateOpen(true);
    }
    setActionIntroOpen(false);
  };

  const handleEnterMain = () => {
    setScreen("main");
    window.scrollTo(0, 0);
    if (typeof window !== "undefined") {
      const introSeen = window.localStorage.getItem(INTRO_SEEN_KEY) === "1";
      setIntroSequenceOpen(!introSeen);
    } else {
      setIntroSequenceOpen(true);
    }
  };

  const isCreator = selectedBet && Number(userId) === Number(selectedBet.creator_id);
  const isOpponent = selectedBet && Number(userId) === Number(selectedBet.opponent_id);
  const isParticipant = Boolean(isCreator || isOpponent);
  const wrongNetwork = Boolean(wallet?.account?.chain && wallet.account.chain !== EXPECTED_WALLET_CHAIN);
  const walletDisplayAddress = wallet?.account?.address || me?.ton_address || "";
  const selectedDeadlineTs = Number(selectedBet?.deadline || 0);
  const selectedExpired = Boolean(selectedDeadlineTs && selectedDeadlineTs < nowTs);
  const selectedLessThanHour = Boolean(selectedDeadlineTs && selectedDeadlineTs >= nowTs && selectedDeadlineTs - nowTs < 3600);
  const selectedStatus = selectedBet ? tabLabels[selectedBet.status] || selectedBet.status : "Ready";
  const selectedPot = selectedBet ? Number(selectedBet.amount_ton) * 2 : 0;
  const oracleMode = selectedBet?.status === BET_STATUS.oracle;
  const disputeMode = Boolean(
    selectedBet &&
    selectedBet.status === BET_STATUS.oracle &&
    selectedBet.creator_outcome &&
    selectedBet.opponent_outcome,
  );
  const canJoinSelected = Boolean(selectedBet && userId && !selectedExpired && selectedBet.status === BET_STATUS.pending && !selectedBet.opponent_id && Number(selectedBet.creator_id) !== Number(userId));
  const needsDeposit = Boolean(selectedBet && !selectedExpired && isParticipant && selectedBet.status === BET_STATUS.pending && ((isCreator && !selectedBet.creator_deposit) || (isOpponent && !selectedBet.opponent_deposit)));
  const hasSubmittedOutcome = Boolean(selectedBet && ((isCreator && selectedBet.creator_outcome) || (isOpponent && selectedBet.opponent_outcome)));
  const canResolve = Boolean(selectedBet && isParticipant && (selectedBet.status === BET_STATUS.active || selectedBet.status === BET_STATUS.confirming) && !hasSubmittedOutcome);
  const showJoinBanner = Boolean(joinFocused && directBetLock && selectedBet && Number(selectedBet.id) === Number(directBetLock));
  const showDepositGuide = Boolean(selectedBet && needsDeposit && (depositMode || Boolean(directBetLock && joinFocused)));
  const showInviteLoading = Boolean(initialAction === "join" && loading && !selectedBet);
  const showInviteMissing = Boolean(initialAction === "join" && !loading && !selectedBet);
  const hasEnoughBalance = typeof walletBalance === "number" && selectedBet ? walletBalance >= Number(selectedBet.amount_ton) : true;
  const depositRetryRemaining = Math.max(0, Math.ceil((depositRetryUntil - Date.now()) / 1000));
  const mySubmittedOutcome = isCreator ? selectedBet?.creator_outcome : isOpponent ? selectedBet?.opponent_outcome : null;
  const roleLabel = isCreator ? "creator" : isOpponent ? "opponent" : "observer";
  const outcomeTitle = isParticipant ? "Mark the statement TRUE or FALSE" : "Outcome flow";
  const outcomeBody = isCreator
    ? "You opened this market. Confirm whether the statement ended up TRUE or FALSE. You are not choosing who gets paid; you are confirming the real-world result once."
    : isOpponent
      ? "You joined this market. Confirm whether the statement ended up TRUE or FALSE. TRUE means it happened. FALSE means it did not."
      : "Only active participants can submit the final result.";
  const oracleVotesCount = Number(selectedBet?.oracle_votes_count || 0);
  const oracleVotesNeeded = Number(selectedBet?.oracle_votes_needed || 2);
  const resolvedFocus = selectedBet?.status === BET_STATUS.done || selectedBet?.status === BET_STATUS.refunded;
  const canHideSelected = Boolean(
    selectedBet &&
    isParticipant &&
    (selectedBet.status === BET_STATUS.done || selectedBet.status === BET_STATUS.refunded),
  );

  useEffect(() => {
    if (!showDepositGuide) return;
    const timer = window.setTimeout(() => {
      depositGuideRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [showDepositGuide, selectedBet?.id]);

  return (
    <div className="app-shell relative min-h-screen overflow-x-hidden bg-black text-white">
      <Background />
      <Particles />
      {!liteFx ? <div className="pointer-events-none fixed inset-0 z-[999] opacity-[0.04]" style={{ filter: "url(#noise)" }} /> : null}
      <SuccessExplosion
        amount={successState?.amount || 0}
        variant={successState?.variant || "win"}
        visible={Boolean(successState)}
        txHash={successState?.txHash}
        tonscanUrl={successState?.tonscanUrl}
        onDone={() => setSuccessState(null)}
      />
        <AnimatePresence>{createOpen ? <CreateBetModal value={createForm} onChange={setCreateField} onClose={() => setCreateOpen(false)} onSubmit={handleSubmitCreateBet} busy={createBusy} error={appError} deadlinePreview={createDeadlinePreview} deadlineError={createDeadlineError} canSubmit={canSubmitCreate} liteFx={liteFx} /> : null}</AnimatePresence>
      <IntroSequenceOverlay open={introSequenceOpen} onDone={() => {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(INTRO_SEEN_KEY, "1");
          window.scrollTo(0, 0);
        }
        setIntroSequenceOpen(false);
      }} />
      <AnimatePresence>{actionIntroOpen ? <ActionIntroOverlay action={initialAction} bet={selectedBet} onContinue={handleActionIntroContinue} /> : null}</AnimatePresence>
      <AnimatePresence mode="wait">
        {screen === "welcome" ? (
          <WelcomeScreen onEnter={handleEnterMain} />
        ) : (
          <motion.div key="main" className="relative z-10 min-h-[100svh] pb-28" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -30, opacity: 0 }} transition={{ duration: 0.25, ease: "easeOut" }}>
            <header className={`sticky top-0 z-40 border-b border-white/6 transition-all duration-300 ${scrolled ? (liteFx ? "bg-black/92" : "bg-black/90 backdrop-blur-[20px]") : (liteFx ? "bg-black/78" : "bg-black/60")}`}>
              <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="orb-button flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.02] font-mono text-[11px] text-white">TON</div>
                  <div className="min-w-0">
                    <div className="display-title text-[18px] font-semibold text-white">TON Consensus</div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">{String(count).padStart(3, "0")} live markets</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <motion.div animate={walletPulse ? { scale: [1, 1.03, 1], boxShadow: ["0 0 0 rgba(34,197,94,0)", "0 0 22px rgba(34,197,94,0.28)", "0 0 0 rgba(34,197,94,0)"] } : { scale: 1, boxShadow: "0 0 0 rgba(34,197,94,0)" }} transition={{ duration: 0.9, ease: "easeOut" }}>
                    <TonConnectButton className="tc-button" />
                  </motion.div>
                </div>
              </div>
              <div className="overflow-hidden border-t border-white/6"><div className="ticker whitespace-nowrap py-2 font-mono text-[10px] uppercase tracking-[0.28em] text-white/42"><span>{marquee}</span></div></div>
            </header>
            <main className="mx-auto max-w-6xl px-4 pt-4 md:pt-6">
              <section className="mb-8 grid gap-px overflow-hidden border border-white/10 bg-white/5 lg:grid-cols-[1.15fr,0.85fr]">
                <div className="panel-surface min-w-0 border-r border-white/6 p-4 md:p-6">
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">Premium telegram flow</div>
                  <div className="mt-4 grid gap-px overflow-hidden border border-white/10 bg-white/5 md:grid-cols-[1.15fr,0.85fr]">
                    <div className="min-w-0 bg-black p-4 md:p-6"><div className="flex items-center justify-center overflow-hidden border border-white/10 py-8 md:py-10"><HeroSphere /></div></div>
                    <div className="min-w-0 grid gap-px bg-white/5">
                      <div className="bg-black p-5"><div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/30">selected</div><div className="display-title mt-3 text-[30px] font-semibold leading-none text-white">{selectedBet ? "#" : ""}<CountUp value={selectedBet?.id || 0} /></div><div className="mt-4 font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">{selectedBet ? selectedStatus : "Ready"}</div></div>
                      <div className="bg-black p-5"><div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/30">wallet</div><div className="display-title mt-3 text-[24px] font-semibold text-white">{walletDisplayAddress ? "Connected" : "Not linked"}</div><div className="mt-2 min-h-[18px] font-mono text-[10px] uppercase tracking-[0.14em] text-white/32">{walletDisplayAddress ? <TypewriterText text={walletDisplayAddress} speed={18} /> : "connect a TON wallet"}</div><div className="mt-4 flex flex-wrap items-center gap-2"><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#0098EA]">TON CONNECT</div>{me?.is_premium_arbiter ? <div className="rounded-full border border-[#FFD700]/18 bg-[#FFD700]/8 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[#ffe38a]">Premium Arbiter</div> : me?.arbiter_since ? <div className="rounded-full border border-[#FFD700]/18 bg-[#FFD700]/8 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[#ffe38a]">Arbiter</div> : null}</div></div>
                      <div className="grid gap-px bg-white/5 sm:grid-cols-2 md:grid-cols-1">
                        <div className="bg-black p-5"><div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/30">stake</div><div className="display-title mt-3 text-[30px] font-semibold text-white">{selectedBet ? <CountUp value={selectedBet.amount_ton} suffix=" TON" decimals={1} /> : "--"}</div></div>
                        <div className="bg-black p-5"><div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/30">pot</div><div className="display-title mt-3 text-[30px] font-semibold text-[#0098EA] [text-shadow:0_0_14px_rgba(0,152,234,0.24)]"><CountUp value={selectedPot} suffix=" TON" decimals={2} /></div></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="panel-surface min-w-0 p-4 md:p-6">
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">selected summary</div>
                    <AnimatePresence mode="wait"><motion.div key={selectedBet ? selectedBet.id : "empty-summary"} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }} className="mt-4">{selectedBet ? <div className="border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_44%)] p-5"><div className="market-title-safe display-title min-w-0 overflow-hidden text-[24px] font-semibold leading-[0.98] text-white md:text-[32px]">{selectedBet.description}</div><div className="mt-6 grid gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/38"><div>Creator: {selectedBet.creator_id}</div><div>Opponent: {selectedBet.opponent_id || "Waiting for opponent"}</div><div>Status: {selectedStatus}</div><div>Deadline: {selectedDeadlineTs ? new Date(selectedDeadlineTs * 1000).toLocaleString() : "not set"}</div>{selectedExpired ? <div className="text-[#ffb3b3]">This bet has expired</div> : null}</div></div> : <div className="border border-white/10 p-5 font-mono text-[11px] uppercase tracking-[0.22em] text-white/35">Select a market to inspect it here.</div>}</motion.div></AnimatePresence>
                </div>
              </section>
                {wrongNetwork ? <section className="mb-8"><div className="border border-[#ff8f90]/20 bg-[#ff8f90]/8 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#ffb3b3]">Please switch to testnet in your wallet.</div></section> : null}
                {appError ? <section className="mb-8"><div className="border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">{appError}</div></section> : null}
                {statusNotice ? (
                  <section className="mb-8">
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`panel-surface relative overflow-hidden border px-4 py-4 md:px-5 ${
                        statusNotice.tone === "success"
                          ? "border-[#FFD700]/22 bg-[#FFD700]/[0.06]"
                          : "border-[#0098EA]/20 bg-[#0098EA]/[0.06]"
                      }`}
                    >
                      <div className={`pointer-events-none absolute inset-y-0 left-0 w-24 ${
                        statusNotice.tone === "success"
                          ? "bg-gradient-to-r from-[#FFD700]/14 to-transparent"
                          : "bg-gradient-to-r from-[#0098EA]/14 to-transparent"
                      }`} />
                      <div className="relative flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                      <div className={`font-mono text-[10px] uppercase tracking-[0.24em] ${
                        statusNotice.tone === "success" ? "text-[#ffe38a]" : "text-[#8fd9ff]"
                      }`}>
                        live update
                      </div>
                      <div className="mt-3 max-w-3xl text-sm leading-7 text-white/72">
                        {statusNotice.text}
                      </div>
                        </div>
                        <div className={`mt-0.5 inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] ${
                          statusNotice.tone === "success"
                            ? "border-[#FFD700]/22 bg-[#FFD700]/8 text-[#ffe38a]"
                            : "border-[#0098EA]/22 bg-[#0098EA]/8 text-[#8fd9ff]"
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${
                            statusNotice.tone === "success" ? "bg-[#FFD700]" : "bg-[#0098EA]"
                          }`} />
                          Synced
                        </div>
                      </div>
                    </motion.div>
                  </section>
                ) : null}
                {showInviteLoading ? (
                <section className="mb-8">
                  <div className="panel-surface border border-[#0098EA]/20 px-4 py-4 md:px-5">
                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#8fd9ff]">invite mode</div>
                    <div className="display-title mt-3 text-[28px] font-semibold text-white">Loading the invited market...</div>
                    <div className="mt-3 max-w-3xl text-sm leading-7 text-white/58">
                      The app is pulling the exact bet from the invite link so you land inside the correct challenge.
                    </div>
                  </div>
                </section>
              ) : null}
                {showInviteMissing ? (
                <section className="mb-8">
                  <div className="panel-surface border border-[#ff8f90]/20 px-4 py-4 md:px-5">
                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#ffb3b3]">invite issue</div>
                    <div className="display-title mt-3 text-[28px] font-semibold text-white">This challenge could not be loaded.</div>
                    <div className="mt-3 max-w-3xl text-sm leading-7 text-white/58">
                      Ask the creator to resend the latest invite link for this exact bet, then open it again from Telegram.
                    </div>
                  </div>
                </section>
              ) : null}
                {showJoinBanner ? (
                <section className="mb-8">
                  <div className="panel-surface border border-[#0098EA]/20 px-4 py-4 md:px-5">
                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#8fd9ff]">invite mode</div>
                    <div className="display-title mt-3 text-[28px] font-semibold text-white">You were challenged to bet on this market.</div>
                    <div className="mt-3 max-w-3xl text-sm leading-7 text-white/58">
                      Review the market details below. If you accept the challenge, join now and the app will immediately move you into the deposit step.
                    </div>
                  </div>
                </section>
              ) : null}
              <AnimatePresence>
                {shareFlash ? (
                  <motion.section
                    className="mb-8"
                    initial={{ opacity: 0, y: 8, scale: 0.99 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.99 }}
                    transition={{ duration: 0.26, ease: "easeOut" }}
                  >
                    <div className="panel-surface relative overflow-hidden border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_44%)] px-4 py-4 md:px-5">
                      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-white/8 to-transparent" />
                      <div className="relative flex items-start justify-between gap-4">
                        <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/38">challenge dispatched</div>
                      <div className="display-title mt-3 text-[24px] font-semibold text-white">Your invite is moving through Telegram now.</div>
                      <div className="mt-3 text-sm leading-7 text-white/56">
                        Once the other side opens the link, this exact market should be loaded straight into join mode.
                      </div>
                        </div>
                        <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-white/45">
                          outbound
                        </div>
                      </div>
                    </div>
                  </motion.section>
                ) : null}
              </AnimatePresence>
              <AnimatePresence>
                {joinFlash ? (
                  <motion.section
                    className="mb-8"
                    initial={{ opacity: 0, y: 8, scale: 0.99 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.99 }}
                    transition={{ duration: 0.26, ease: "easeOut" }}
                  >
                    <div className="panel-surface relative overflow-hidden border border-[#0098EA]/24 bg-[radial-gradient(circle_at_top,rgba(0,152,234,0.14),transparent_44%)] px-4 py-4 md:px-5">
                      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#0098EA]/12 to-transparent" />
                      <div className="relative flex items-start justify-between gap-4">
                        <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#8fd9ff]">challenge accepted</div>
                      <div className="display-title mt-3 text-[24px] font-semibold text-white">You are in. Move to deposit to activate the market.</div>
                      <div className="mt-3 text-sm leading-7 text-white/56">
                        The next step is already prepared below, so both sides can fund and continue without returning to chat.
                      </div>
                        </div>
                        <div className="inline-flex rounded-full border border-[#0098EA]/18 bg-[#0098EA]/10 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#8fd9ff]">
                          active handoff
                        </div>
                      </div>
                    </div>
                  </motion.section>
                ) : null}
              </AnimatePresence>
              {showDepositGuide ? (
                <section ref={depositGuideRef} className="mb-8 scroll-mt-24">
                  <div className="panel-surface border border-white/10 p-4 md:p-5">
                    <div className="grid gap-5 lg:grid-cols-[1.1fr,0.9fr]">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-[#8fd9ff]">deposit instructions</div>
                        <div className="display-title mt-3 text-[28px] font-semibold text-white">Send {selectedBet?.amount_ton} TON to activate your side.</div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <div className="rounded-full border border-[#0098EA]/18 bg-[#0098EA]/10 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#8fd9ff]">
                              Exact amount: {Number(selectedBet?.amount_ton || 0).toFixed(3)} TON
                            </div>
                            <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-white/48">
                              Secure transfer route
                            </div>
                          </div>
                          <div className="mt-3 max-w-2xl text-sm leading-7 text-white/58">
                            Send EXACTLY {Number(selectedBet?.amount_ton || 0).toFixed(3)} TON from your connected wallet to the deposit wallet below. Then return here and verify the transaction on-chain.
                          </div>
                          {selectedLessThanHour ? (
                            <div className="mt-4 border border-[#ffd58f]/20 bg-[#ffd58f]/8 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#ffd58f]">
                              Less than 1 hour remaining to deposit
                            </div>
                          ) : null}
                          <div className="mt-4 border border-[#8fd9ff]/20 bg-[#0098EA]/[0.08] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#8fd9ff]">
                            Send funds from the connected wallet, then tap I Sent Deposit.
                          </div>
                          {walletBalanceBusy ? <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">Checking wallet balance...</div> : null}
                          {typeof walletBalance === "number" && !hasEnoughBalance ? (
                            <div className="mt-4 border border-[#ffd58f]/20 bg-[#ffd58f]/8 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#ffd58f]">
                              Your connected wallet balance is below the required stake.
                            </div>
                          ) : null}
                          {depositAttemptError ? (
                            <div className="mt-4 border border-[#ff8f90]/20 bg-[#ff8f90]/8 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#ffb3b3]">
                              {depositAttemptError}
                            </div>
                          ) : null}
                          <div className="mt-5 flex flex-wrap gap-3">
                          <button type="button" onClick={handleCopyPlatformWallet} disabled={!platformWallet} className="rounded-full border border-white bg-white px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-black disabled:opacity-40">
                            Copy Wallet
                          </button>
                          <button type="button" onClick={handleConfirmDeposit} disabled={actionBusy === "deposit" || wrongNetwork || !hasEnoughBalance || depositRetryRemaining > 0} className="rounded-full border border-white/12 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white disabled:opacity-40">
                            {actionBusy === "deposit" ? "Verifying..." : depositAttemptError ? (depositRetryRemaining > 0 ? `Check Again (${depositRetryRemaining}s)` : "Check Again") : "I Sent Deposit"}
                          </button>
                        </div>
                      </div>
                      <div className="relative overflow-hidden border border-white/10 bg-black p-4">
                        <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-[#0098EA]/8 to-transparent" />
                        <div className="relative flex items-center justify-between gap-3">
                          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">deposit wallet</div>
                          <div className="rounded-full border border-[#0098EA]/16 bg-[#0098EA]/8 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#8fd9ff]">
                            TON route
                          </div>
                        </div>
                        <div className="mt-4 break-all font-mono text-[12px] leading-6 text-[#0098EA] [text-shadow:0_0_14px_rgba(0,152,234,0.22)]">
                          {platformWallet || "Loading wallet..."}
                        </div>
                        <div className="mt-5 grid gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/42">
                          <div>1. Copy the wallet address</div>
                          <div>2. Send EXACTLY {Number(selectedBet?.amount_ton || 0).toFixed(3)} TON</div>
                          <div>3. Return here and tap I Sent Deposit</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}
              <AnimatePresence>
                {depositFlash ? (
                  <motion.section
                    className="mb-8"
                    initial={{ opacity: 0, y: 8, filter: "blur(10px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -8, filter: "blur(10px)" }}
                    transition={{ duration: 0.28, ease: "easeOut" }}
                  >
                    <div className="panel-surface relative overflow-hidden border border-[#0098EA]/24 bg-[radial-gradient(circle_at_top,rgba(0,152,234,0.12),transparent_44%)] px-4 py-4 md:px-5">
                      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#0098EA]/12 to-transparent" />
                      <div className="relative flex items-start justify-between gap-4">
                        <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#8fd9ff]">deposit confirmed</div>
                      <div className="display-title mt-3 text-[24px] font-semibold text-white">Your side is marked as funded.</div>
                      <div className="mt-3 text-sm leading-7 text-white/56">
                        Deposit verified on-chain. Waiting for the counterparty to complete the same step.
                      </div>
                        </div>
                        <div className="inline-flex rounded-full border border-[#0098EA]/18 bg-[#0098EA]/10 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#8fd9ff]">
                          on-chain verified
                        </div>
                      </div>
                    </div>
                  </motion.section>
                ) : null}
              </AnimatePresence>
              <section className="mb-8">
                <SectionHeader title="Actions" aside="inside the app" />
                <div className="flex flex-wrap gap-3">
                  <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95, boxShadow: "0 0 24px rgba(255,255,255,0.16)" }} transition={{ duration: 0.1 }} onClick={handleCreateBet} className="action-button-primary">Create Bet</motion.button>
                  <motion.button type="button" whileHover={!(!selectedBet || !(isCreator || isOpponent)) ? { scale: 1.02 } : undefined} whileTap={!(!selectedBet || !(isCreator || isOpponent)) ? { scale: 0.95, boxShadow: "0 0 22px rgba(0,152,234,0.2)" } : undefined} transition={{ duration: 0.1 }} onClick={handleShareSelected} disabled={!selectedBet || !(isCreator || isOpponent)} className="action-button-secondary disabled:opacity-30">Share Bet</motion.button>
                  {canJoinSelected ? <motion.button type="button" whileHover={actionBusy === "join" ? undefined : { scale: 1.02 }} whileTap={actionBusy === "join" ? undefined : { scale: 0.95, boxShadow: "0 0 22px rgba(0,152,234,0.2)" }} transition={{ duration: 0.1 }} onClick={handleJoinSelected} disabled={actionBusy === "join"} className="action-button-secondary disabled:opacity-40">{actionBusy === "join" ? "Joining..." : showJoinBanner ? "Accept Challenge" : "Join Selected"}</motion.button> : null}
                  {needsDeposit ? <motion.button type="button" whileHover={actionBusy === "deposit" || wrongNetwork || !hasEnoughBalance || depositRetryRemaining > 0 ? undefined : { scale: 1.02 }} whileTap={actionBusy === "deposit" || wrongNetwork || !hasEnoughBalance || depositRetryRemaining > 0 ? undefined : { scale: 0.95, boxShadow: "0 0 22px rgba(0,152,234,0.2)" }} transition={{ duration: 0.1 }} onClick={handleConfirmDeposit} disabled={actionBusy === "deposit" || wrongNetwork || !hasEnoughBalance || depositRetryRemaining > 0} className="action-button-secondary disabled:opacity-40">{actionBusy === "deposit" ? "Verifying..." : depositAttemptError ? (depositRetryRemaining > 0 ? `Check Again (${depositRetryRemaining}s)` : "Check Again") : "I Sent Deposit"}</motion.button> : null}
                  {canHideSelected ? <motion.button type="button" whileHover={actionBusy === "hide" ? undefined : { scale: 1.02 }} whileTap={actionBusy === "hide" ? undefined : { scale: 0.95, boxShadow: "0 0 18px rgba(255,77,79,0.16)" }} transition={{ duration: 0.1 }} onClick={handleHideSelected} disabled={actionBusy === "hide"} className="rounded-full border border-[#ff8f90]/18 bg-[#ff8f90]/6 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[#ffb3b3] disabled:opacity-40">{actionBusy === "hide" ? "Removing..." : "Remove From My List"}</motion.button> : null}
                </div>
                {selectedBet && Number(selectedBet.creator_id) === Number(userId) && showJoinBanner ? <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[#ffb3b3]">You cannot join your own bet.</div> : null}
                {selectedBet && !(isCreator || isOpponent) ? <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-white/38">Only participants can share this market invite.</div> : null}
                {oracleMode ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <div className="rounded-full border border-[#0098EA]/18 bg-[#0098EA]/10 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#8fd9ff]">
                      Oracle mode live
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-white/48">
                      Outcome will sync here automatically
                    </div>
                  </div>
                ) : null}
              </section>
              {(canResolve || hasSubmittedOutcome) && isParticipant ? (
                <section className="mb-8">
                  <SectionHeader title="Outcome" aside={roleLabel} />
                  <div className="panel-surface border border-white/10 p-4 md:p-5">
                    <div className="grid gap-5 lg:grid-cols-[1fr,0.9fr]">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#8fd9ff]">{roleLabel} mode</div>
                        <div className="display-title mt-3 text-[28px] font-semibold text-white">{outcomeTitle}</div>
                        <div className="mt-3 max-w-2xl text-sm leading-7 text-white/58">{outcomeBody}</div>
                        {hasSubmittedOutcome ? (
                          <div className="mt-5 border border-white/10 bg-white/[0.03] px-4 py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">
                            Your claim is locked: {formatOutcomeChoice(mySubmittedOutcome, isOpponent ? "opponent" : "creator")}. The app is waiting for the other side to answer.
                          </div>
                        ) : (
                          <div className="mt-5">
                            <div className="flex flex-wrap gap-3">
                            <button type="button" onClick={() => {
                              const nextOutcome = getOutcomePayloadForClaim("true", { isCreator, isOpponent });
                              if (nextOutcome) handleSubmitOutcome(nextOutcome);
                            }} disabled={Boolean(actionBusy)} className="rounded-full border border-white bg-white px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-black disabled:opacity-40">
                              Claim TRUE
                            </button>
                            <button type="button" onClick={() => {
                              const nextOutcome = getOutcomePayloadForClaim("false", { isCreator, isOpponent });
                              if (nextOutcome) handleSubmitOutcome(nextOutcome);
                            }} disabled={Boolean(actionBusy)} className="rounded-full border border-white/12 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white disabled:opacity-40">
                              Claim FALSE
                            </button>
                          </div>
                            <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-white/42">
                              TRUE = the statement happened. FALSE = it did not.
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="relative overflow-hidden border border-white/10 bg-black p-4">
                        <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-white/6 to-transparent" />
                        <div className="relative flex items-center justify-between gap-3">
                          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">how resolution works</div>
                          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-white/42">
                            guided
                          </div>
                        </div>
                        <div className="mt-4 grid gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/42">
                          <div>1. You mark the statement TRUE or FALSE once</div>
                          <div>2. The counterparty marks theirs</div>
                          <div>3. Matching claims settle instantly</div>
                          <div>4. Conflicting claims trigger oracle mode</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}
              <section className="grid gap-8 lg:grid-cols-[1.05fr,0.95fr]">
                <div>
                  <SectionHeader title="Markets" aside={`${String(count).padStart(3, "0")} visible`} />
                  <div className="panel-surface overflow-hidden border border-white/10">
                    <div className="flex overflow-x-auto border-b border-white/10 px-2 scrollbar-none">
                      {tabs.map((item) => <motion.button key={item} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95, boxShadow: "0 0 20px rgba(0,152,234,0.45)" }} transition={{ duration: 0.1 }} onClick={() => handleTab(item)} className={`relative px-4 py-4 font-mono text-[11px] uppercase tracking-[0.3em] ${tab === item ? "text-white" : "text-white/28"}`}>{tabLabels[item]}{tab === item ? <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-4 right-4 h-[2px] bg-[#0098EA]" transition={{ type: "spring", stiffness: 300, damping: 25 }} /> : null}</motion.button>)}
                    </div>
                    <div>
                      <AnimatePresence mode="wait"><motion.div key={tab} className="smooth-scroll-area" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>{loading ? <LoadingSkeleton /> : bets.length === 0 ? <div className="py-20 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-white/35">No data<div className="mt-4"><motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95, boxShadow: "0 0 18px rgba(255,255,255,0.12)" }} transition={{ duration: 0.1 }} onClick={handleCreateBet} className="rounded-full border border-white/12 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/72">Create First Bet</motion.button></div></div> : bets.map((bet, index) => { const isSelected = selectedBet?.id === bet.id; const isPulsing = selectionPulseId === bet.id; return <motion.div key={bet.id} className={selectedBet && !isSelected ? "opacity-65 transition-opacity duration-200" : "transition-opacity duration-200"} animate={isPulsing ? { y: [0, -3, 0], scale: [1, 1.008, 1] } : { y: 0, scale: 1 }} transition={{ duration: 0.42, ease: "easeOut" }}><BetCard bet={bet} index={index} selected={isSelected} onSelect={handleSelectBet} onOpen={() => handleSelectBet(bet)} /></motion.div>; })}</motion.div></AnimatePresence>
                    </div>
                  </div>
                </div>
                <div>
                  <SectionHeader title="Oracle" aside="selected market" />
                  <motion.div className={`panel-surface grid gap-px border ${oracleMode ? "border-[#0098EA]/35" : resolvedFocus ? "border-[#FFD700]/28" : "border-white/10"}`} animate={{ boxShadow: oracleMode ? "inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 90px rgba(0,152,234,0.16)" : resolvedFocus ? "inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 90px rgba(255,215,0,0.12)" : "inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 80px rgba(0,0,0,0.38)" }} transition={{ duration: 0.35, ease: "easeOut" }}>
                    <div className="p-5 md:p-6">
                      <AnimatePresence mode="wait"><motion.div key={selectedBet ? selectedBet.id : "empty-oracle"} initial={{ opacity: 0, y: 14, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -14, scale: 0.99 }} transition={{ duration: 0.28 }}>{selectedBet ? <div className={`relative overflow-hidden border p-5 ${oracleMode ? "border-[#0098EA]/24 bg-[radial-gradient(circle_at_top,rgba(0,152,234,0.12),transparent_38%)]" : resolvedFocus ? "border-[#FFD700]/22 bg-[radial-gradient(circle_at_top,rgba(255,215,0,0.10),transparent_40%)]" : "border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_38%)]"}`}>{(oracleMode || selectedBet.status === BET_STATUS.done) ? <motion.div className={`pointer-events-none absolute inset-y-0 left-0 w-32 ${resolvedFocus ? "bg-gradient-to-r from-[#FFD700]/16 to-transparent" : "bg-gradient-to-r from-[#0098EA]/12 to-transparent"}`} initial={{ x: "-120%" }} animate={{ x: "240%" }} transition={{ duration: 1.1, ease: "easeOut", repeat: oracleMode ? Infinity : 0, repeatDelay: 2.2 }} /> : null}<div className="flex flex-wrap items-start justify-between gap-5"><div className="min-w-0 flex-1"><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">market focus</div><div className="market-title-safe display-title mt-3 min-w-0 overflow-hidden text-[24px] font-semibold leading-[1.02] text-white md:text-[36px]">{selectedBet.description}</div><div className="mt-4 inline-flex rounded-full border border-[#0098EA]/20 bg-[#0098EA]/8 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#8fd9ff]">Powered by AI Oracle</div></div><div className={`flex h-24 w-24 items-center justify-center rounded-full border border-white/10 ${resolvedFocus ? "bg-[radial-gradient(circle_at_30%_30%,rgba(255,215,0,0.18),rgba(255,255,255,0.02)_50%,transparent_72%)]" : "bg-[radial-gradient(circle_at_30%_30%,rgba(0,152,234,0.14),rgba(255,255,255,0.02)_50%,transparent_72%)]"}`}><div className="text-center"><div className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/34">state</div><motion.div className={`mt-1 font-mono text-[11px] uppercase tracking-[0.2em] ${resolvedFocus ? "text-[#FFD700]" : "text-[#0098EA]"}`} animate={oracleMode ? { opacity: [1, 0.5, 1], scale: [1, 1.04, 1] } : resolvedFocus ? { opacity: [1, 0.7, 1], scale: [1, 1.02, 1] } : { opacity: 1, scale: 1 }} transition={{ duration: 1.8, repeat: oracleMode || resolvedFocus ? Infinity : 0, ease: "easeInOut" }}>{selectedStatus}</motion.div></div></div></div><div className="mt-6 grid gap-px border border-white/10 bg-white/5 sm:grid-cols-3"><div className="bg-black p-4"><div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">bet</div><div className="display-title mt-2 text-[28px] font-semibold text-white">#<CountUp value={selectedBet.id} /></div></div><div className="bg-black p-4"><div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">stake</div><div className="mt-2 font-mono text-lg uppercase tracking-[0.18em] text-[#0098EA] [text-shadow:0_0_12px_rgba(0,152,234,0.45)]"><CountUp value={selectedBet.amount_ton} suffix=" TON" decimals={1} /></div></div><div className="bg-black p-4"><div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">pot</div><div className="mt-2 font-mono text-lg uppercase tracking-[0.18em] text-white"><CountUp value={selectedPot} suffix=" TON" decimals={2} /></div></div></div>{disputeMode ? <div className="mt-5 border border-[#0098EA]/22 bg-[#0098EA]/8 p-4"><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#8fd9ff]">dispute flow</div><div className="display-title mt-3 text-[24px] font-semibold text-white">Both sides submitted conflicting results.</div><div className="mt-4 grid gap-px border border-[#0098EA]/20 bg-[#0098EA]/8 sm:grid-cols-3"><div className="bg-black/60 p-3"><div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/34">step 1</div><div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/58">conflict detected</div></div><div className="bg-black/60 p-3"><div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/34">step 2</div><div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/58">oracle reviews evidence</div></div><div className="bg-black/60 p-3"><div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/34">step 3</div><div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/58">winner gets paid</div></div></div><div className="mt-4 grid gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/48"><div>Creator submitted: {formatOutcomeChoice(selectedBet.creator_outcome, "creator")}</div><div>Opponent submitted: {formatOutcomeChoice(selectedBet.opponent_outcome, "opponent")}</div><div>The AI oracle is deciding the winner automatically now.</div><div>You do not need to go back to chat. Stay here and watch the status update.</div></div>{oracleMode ? <div className="mt-4 border border-[#0098EA]/20 bg-black/40 p-4"><div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[#8fd9ff]"><span>vote progress</span><span>{oracleVotesCount}/{oracleVotesNeeded}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8"><motion.div className="h-full bg-[#0098EA]" initial={{ width: 0 }} animate={{ width: `${Math.min((oracleVotesCount / oracleVotesNeeded) * 100, 100)}%` }} transition={{ duration: 0.4, ease: "easeOut" }} /></div></div> : null}</div> : null}{oracleMode ? <motion.div className="mt-5 flex items-center justify-between rounded-full border border-[#0098EA]/22 bg-[#0098EA]/8 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.24em] text-[#8fd9ff]" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}><span>oracle mode active</span><span>ai is resolving the dispute</span></motion.div> : null}{resolvedFocus ? <motion.div className="mt-5 flex items-center justify-between rounded-full border border-[#FFD700]/24 bg-[#FFD700]/8 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.24em] text-[#ffe38a]" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}><span>market settled</span><span>{getResolvedStateBadgeText(selectedBet)}</span></motion.div> : null}</div> : <div className="border border-white/10 p-5 font-mono text-[11px] uppercase tracking-[0.22em] text-white/35">Select a market to continue.</div>}</motion.div></AnimatePresence>
                    </div>
                    <div className="bg-black px-5 py-5"><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">in-app flow</div><div className="mt-4 grid gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-white/45"><div>Create bets here.</div><div>Share invite links here.</div><div>Join, deposit and submit outcomes here.</div></div></div>
                  </motion.div>
                </div>
              </section>
            </main>
            <footer className="mx-auto mt-8 flex max-w-6xl flex-wrap items-center gap-3 px-4 pb-8">
              <div className="soft-badge">Secured by TON Blockchain</div>
              <div className="soft-badge soft-badge--blue">Telegram Native</div>
              <div className="soft-badge soft-badge--gold">AI-guided Resolution</div>
            </footer>
              <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.95, boxShadow: "0 0 20px rgba(255,255,255,0.18)" }}
              animate={liteFx ? { boxShadow: ["0 10px 26px rgba(255,255,255,0.06)", "0 14px 34px rgba(0,152,234,0.12)", "0 10px 26px rgba(255,255,255,0.06)"], y: [0, -1, 0] } : { boxShadow: ["0 10px 30px rgba(255,255,255,0.08)", "0 16px 46px rgba(0,152,234,0.2)", "0 10px 30px rgba(255,255,255,0.08)"], y: [0, -1.5, 0] }}
              transition={{ duration: liteFx ? 4.2 : 3.4, repeat: Infinity, ease: "easeInOut" }}
              onClick={handleCreateBet}
              className="orb-button fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-white/14 bg-white text-3xl text-black"
            >
              +
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
