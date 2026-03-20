import { AnimatePresence, motion } from "framer-motion";
import { TonConnectButton, useTonWallet } from "@tonconnect/ui-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Background from "./components/Background";
import BetCard from "./components/BetCard";
import Particles from "./components/Particles";
import SuccessExplosion from "./components/SuccessExplosion";
import { API, tg, userId } from "./constants";

const BET_STATUS = {
  pending: "pending",
  active: "active",
  confirming: "confirming",
  oracle: "oracle",
  done: "done",
};

const OUTCOME = {
  win: "win",
  lose: "lose",
};

const params = new URLSearchParams(window.location.search);
const initialAction = params.get("action");
const initialBetId = Number(params.get("bet"));
const TONSCAN_BASE = import.meta.env.VITE_TONSCAN_BASE || "https://testnet.tonscan.org";

const tabs = [BET_STATUS.pending, BET_STATUS.active, BET_STATUS.oracle, BET_STATUS.done];
const tabLabels = {
  [BET_STATUS.pending]: "OPEN",
  [BET_STATUS.active]: "ACTIVE",
  [BET_STATUS.oracle]: "ORACLE",
  [BET_STATUS.done]: "CLOSED",
};

const tickerItems = [
  "TON CONSENSUS",
  "P2P BETS",
  "AI ORACLE",
  "TELEGRAM NATIVE",
  "TON PAYOUTS",
  "LIVE DISPUTES",
];

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
    const duration = 700;

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
  return (
    <div className="hero-orb-shell relative mx-auto flex h-[260px] w-[260px] items-center justify-center md:h-[340px] md:w-[340px]">
      <motion.div className="hero-orb-glow absolute inset-0 rounded-full" animate={{ rotate: 360 }} transition={{ duration: 18, repeat: Infinity, ease: "linear" }} />
      <motion.div className="hero-orb-ring absolute inset-[16px] rounded-full border border-white/10" animate={{ rotate: -360 }} transition={{ duration: 26, repeat: Infinity, ease: "linear" }} />
      <motion.div className="hero-orb-ring absolute inset-[44px] rounded-full border border-white/8" animate={{ rotate: 360 }} transition={{ duration: 32, repeat: Infinity, ease: "linear" }} />
      <motion.div className="hero-orb-core relative flex h-[72%] w-[72%] items-center justify-center rounded-full border border-white/12" animate={{ y: [0, -8, 0], rotateX: [0, 8, 0], rotateY: [0, -8, 0] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}>
        <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_30%,rgba(255,255,255,0.18),rgba(255,255,255,0.04)_40%,rgba(0,152,234,0.08)_65%,transparent_78%)]" />
        <div className="text-center">
          <div className="display-title text-[42px] font-semibold uppercase text-white md:text-[58px]">TON</div>
          <div className="display-title -mt-1 text-[42px] font-semibold uppercase text-white md:text-[58px]">CONSENSUS</div>
          <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">BETS / DISPUTES / ORACLE</div>
        </div>
      </motion.div>
    </div>
  );
}

function WelcomeScreen({ onEnter }) {
  return (
    <motion.section className="flex min-h-screen items-center justify-center px-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -24 }} transition={{ duration: 0.35 }}>
      <div className="w-full max-w-md">
        <div className="panel-surface border border-white/10 p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">Telegram Mini App</div>
          <div className="mt-5 flex items-center justify-center border border-white/10 py-8"><HeroSphere /></div>
          <div className="mt-5 grid gap-px border border-white/10 bg-white/5 sm:grid-cols-3">
            <div className="bg-black p-4 font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">lock</div>
            <div className="bg-black p-4 font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">verify</div>
            <div className="bg-black p-4 font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">settle</div>
          </div>
          <motion.button whileTap={{ scale: 0.97, boxShadow: "0 0 24px rgba(255,255,255,0.16)" }} onClick={onEnter} className="mt-5 w-full rounded-full border border-white bg-white px-6 py-4 font-mono text-[11px] uppercase tracking-[0.28em] text-black">Enter App</motion.button>
        </div>
      </div>
    </motion.section>
  );
}

function CreateBetModal({ value, onChange, onClose, onSubmit, busy, error }) {
  return (
    <motion.div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/88 px-4 py-6 backdrop-blur-[18px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div className="panel-surface w-full max-w-2xl border border-white/10 p-5 md:p-6" initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.98 }} transition={{ duration: 0.24 }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/32">Create Bet</div>
            <div className="display-title mt-2 text-[34px] font-semibold text-white">Launch a new market</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-white/12 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/72">Close</button>
        </div>
        <div className="mt-6 grid gap-4">
          <label className="grid gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">Description</span>
            <textarea value={value.description} onChange={(event) => onChange("description", event.target.value)} rows={4} placeholder="Will BTC close above 90k on Friday?" className="border border-white/10 bg-black px-4 py-4 font-mono text-sm text-white outline-none placeholder:text-white/20" />
          </label>
          <label className="grid gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">Stake in TON</span>
            <input value={value.amount_ton} onChange={(event) => onChange("amount_ton", event.target.value)} placeholder="1.5" className="border border-white/10 bg-black px-4 py-4 font-mono text-sm text-white outline-none placeholder:text-white/20" />
          </label>
        </div>
        {error ? <div className="mt-4 border border-[#ff4d4f]/30 bg-[#ff4d4f]/8 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#ff8f90]">{error}</div> : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={onSubmit} disabled={busy} className="rounded-full border border-white bg-white px-6 py-3 font-mono text-[10px] uppercase tracking-[0.24em] text-black disabled:opacity-40">{busy ? "Creating..." : "Create Bet"}</motion.button>
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
            <div className="mt-2 display-title text-[24px] font-semibold text-white">{bet.description}</div>
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
  const [screen, setScreen] = useState(initialAction ? "main" : "welcome");
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
  const [createForm, setCreateForm] = useState({ description: "", amount_ton: "1.0" });
  const [platformWallet, setPlatformWallet] = useState("");
  const [actionIntroOpen, setActionIntroOpen] = useState(Boolean(initialAction));
  const [joinFocused, setJoinFocused] = useState(initialAction === "join");
  const [depositMode, setDepositMode] = useState(false);
  const [initialTabResolved, setInitialTabResolved] = useState(false);
  const prevStatusesRef = useRef(new Map());
  const wallet = useTonWallet();
  const scrolled = useStickyHeader();
  const marquee = useMemo(() => [...tickerItems, ...tickerItems].join("  /  "), []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      refreshBets(selectedBet?.id || initialBetId || null);
    }, 10000);

    return () => window.clearInterval(interval);
  }, [tab, selectedBet?.id]);

  useEffect(() => {
    if (!wallet?.account?.address) return;
    fetch(`${API}/api/user/address`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id: userId, address: wallet.account.address }),
    }).catch(() => {});
  }, [wallet]);

  useEffect(() => {
    fetch(`${API}/api/platform-wallet`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.address) setPlatformWallet(data.address);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initialAction !== "mybets" || !userId || initialTabResolved) {
      return;
    }

    fetch(`${API}/api/bets/user/${userId}`)
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

  async function refreshBets(preferredBetId = null) {
    setLoading(true);
    setAppError("");
    try {
      const url = userId ? `${API}/api/bets/user/${userId}` : `${API}/api/bets?status=${tab}`;
      const res = await fetch(url);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error || "Failed to load bets");
      const data = userId ? raw.filter((bet) => bet.status === tab) : raw;
      const nextMap = new Map();
      data.forEach((bet) => {
        const prev = prevStatusesRef.current.get(bet.id);
        if (prev && prev !== BET_STATUS.done && bet.status === BET_STATUS.done) {
          setSuccessState((current) => current || {
            amount: Number(bet.amount_ton) * 2,
            txHash: bet.payout_tx || "",
            tonscanUrl: bet.payout_tx ? `${TONSCAN_BASE}/tx/${bet.payout_tx}` : "",
          });
        }
        nextMap.set(bet.id, bet.status);
      });
      prevStatusesRef.current = nextMap;
      setCount(data.length);
      setBets(data);
      setSelectedBet((current) => {
        if (!data.length) return null;
        if (preferredBetId) {
          const preferred = data.find((bet) => Number(bet.id) === Number(preferredBetId));
          if (preferred) return preferred;
        }
        if (current) {
          const found = data.find((bet) => Number(bet.id) === Number(current.id));
          if (found) return found;
        }
        if (initialBetId) {
          const fromQuery = data.find((bet) => Number(bet.id) === initialBetId);
          if (fromQuery) return fromQuery;
        }
        return data[0];
      });
    } catch (error) {
      setBets([]);
      setSelectedBet(null);
      setAppError(error.message || "Failed to load bets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshBets(initialBetId || null);
  }, [tab]);

  useEffect(() => {
    if (!selectedBet) {
      return;
    }

    if (initialAction === "join" && Number(selectedBet.id) === Number(initialBetId)) {
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
  }, [selectedBet]);

  useEffect(() => {
    if (!selectedBet || selectedBet.status !== BET_STATUS.oracle) {
      return undefined;
    }

    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/bet/${selectedBet.id}`);
        const data = await res.json();
        if (!res.ok) {
          return;
        }

        setSelectedBet(data);
        setBets((current) => current.map((bet) => (Number(bet.id) === Number(data.id) ? data : bet)));

        if (data.status === BET_STATUS.done) {
          setSuccessState((current) => current || {
            amount: Number(data.amount_ton) * 2,
            txHash: data.payout_txhash || "",
            tonscanUrl: data.payout_txhash ? `${TONSCAN_BASE}/tx/${data.payout_txhash}` : "",
          });
        }
      } catch {
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [selectedBet?.id, selectedBet?.status]);

  const setCreateField = (field, value) => setCreateForm((current) => ({ ...current, [field]: value }));

  const handleTab = (nextTab) => {
    tg?.HapticFeedback?.selectionChanged();
    setTab(nextTab);
  };

  const handleCreateBet = () => {
    tg?.HapticFeedback?.impactOccurred("medium");
    setAppError("");
    setCreateOpen(true);
  };

  const handleSubmitCreateBet = async () => {
    if (!userId) {
      setAppError("Open the Mini App inside Telegram to create bets.");
      return;
    }
    setCreateBusy(true);
    setAppError("");
    try {
      const res = await fetch(`${API}/api/bets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creator_id: userId, description: createForm.description, amount_ton: Number(createForm.amount_ton) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create bet");
      tg?.HapticFeedback?.notificationOccurred("success");
      setCreateOpen(false);
      setActionIntroOpen(false);
      setTab(BET_STATUS.pending);
      await refreshBets(data.bet?.id);
    } catch (error) {
      setAppError(error.message);
    } finally {
      setCreateBusy(false);
    }
  };

  const handleShareSelected = async () => {
    if (!selectedBet) return;
    const inviteUrl = `https://t.me/ton_consensus_bot?start=join_${selectedBet.id}`;
    const shareUrl =
      `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}` +
      `&text=${encodeURIComponent(`👊 I challenge you to a bet!\n\n"${selectedBet.description}"\n💰 ${selectedBet.amount_ton} TON each\n\nAccept the challenge 👇`)}`;
    tg?.HapticFeedback?.impactOccurred("light");

    if (tg?.openTelegramLink) {
      tg.openTelegramLink(shareUrl);
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteUrl);
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
      const res = await fetch(`${API}/api/bets/${selectedBet.id}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opponent_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to join bet");
      tg?.HapticFeedback?.notificationOccurred("success");
      setJoinFocused(false);
      setDepositMode(true);
      setActionIntroOpen(false);
      await refreshBets(data.bet?.id);
    } catch (error) {
      setAppError(error.message);
    } finally {
      setActionBusy("");
    }
  };

  const handleConfirmDeposit = async () => {
    if (!selectedBet || !userId) return;
    setActionBusy("deposit");
    setAppError("");
    try {
      const res = await fetch(`${API}/api/bets/${selectedBet.id}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to confirm deposit");
      tg?.HapticFeedback?.notificationOccurred("success");
      setDepositMode(false);
      await refreshBets(data.bet?.id);
    } catch (error) {
      setAppError(error.message);
    } finally {
      setActionBusy("");
    }
  };

  const handleSubmitOutcome = async (outcome) => {
    if (!selectedBet || !userId) return;
    setActionBusy(outcome);
    setAppError("");
    try {
      const res = await fetch(`${API}/api/bets/${selectedBet.id}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_id: userId, outcome }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit outcome");
      tg?.HapticFeedback?.notificationOccurred("success");
      if (data.stage === "settled" && data.txHash) {
        setSuccessState({
          amount: Number(selectedBet.amount_ton) * 2,
          txHash: data.txHash,
          tonscanUrl: `${TONSCAN_BASE}/tx/${data.txHash}`,
        });
      }
      await refreshBets(data.bet?.id || selectedBet.id);
    } catch (error) {
      setAppError(error.message);
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

  const isCreator = selectedBet && Number(userId) === Number(selectedBet.creator_id);
  const isOpponent = selectedBet && Number(userId) === Number(selectedBet.opponent_id);
  const isParticipant = Boolean(isCreator || isOpponent);
  const selectedStatus = selectedBet ? tabLabels[selectedBet.status] || selectedBet.status : "IDLE";
  const selectedPot = selectedBet ? Number(selectedBet.amount_ton) * 2 : 0;
  const oracleMode = selectedBet?.status === BET_STATUS.oracle;
  const disputeMode = Boolean(
    selectedBet &&
    selectedBet.status === BET_STATUS.oracle &&
    selectedBet.creator_outcome &&
    selectedBet.opponent_outcome,
  );
  const canJoinSelected = Boolean(selectedBet && userId && selectedBet.status === BET_STATUS.pending && !selectedBet.opponent_id && Number(selectedBet.creator_id) !== Number(userId));
  const needsDeposit = Boolean(selectedBet && isParticipant && selectedBet.status === BET_STATUS.pending && ((isCreator && !selectedBet.creator_deposit) || (isOpponent && !selectedBet.opponent_deposit)));
  const hasSubmittedOutcome = Boolean(selectedBet && ((isCreator && selectedBet.creator_outcome) || (isOpponent && selectedBet.opponent_outcome)));
  const canResolve = Boolean(selectedBet && isParticipant && (selectedBet.status === BET_STATUS.active || selectedBet.status === BET_STATUS.confirming) && !hasSubmittedOutcome);
  const showJoinBanner = Boolean(joinFocused && selectedBet && Number(selectedBet.id) === Number(initialBetId));
  const showDepositGuide = Boolean(selectedBet && needsDeposit && (depositMode || initialAction === "join"));
  const mySubmittedOutcome = isCreator ? selectedBet?.creator_outcome : isOpponent ? selectedBet?.opponent_outcome : null;
  const roleLabel = isCreator ? "creator" : isOpponent ? "opponent" : "observer";
  const outcomeTitle = isCreator ? "Submit your creator claim" : isOpponent ? "Submit your opponent claim" : "Outcome flow";
  const outcomeBody = isCreator
    ? "You opened this market. Lock in your version of the result once, then wait for the counterparty or oracle response."
    : isOpponent
      ? "You joined this market. Submit your side of the result once, then the app will compare both claims."
      : "Only active participants can submit the final result.";
  const oracleVotesCount = Number(selectedBet?.oracle_votes_count || 0);
  const oracleVotesNeeded = Number(selectedBet?.oracle_votes_needed || 2);

  return (
    <div className="app-shell relative min-h-screen overflow-hidden bg-black text-white">
      <Background />
      <Particles />
      <div className="pointer-events-none fixed inset-0 z-[999] opacity-[0.04]" style={{ filter: "url(#noise)" }} />
      <SuccessExplosion
        amount={successState?.amount || 0}
        visible={Boolean(successState)}
        txHash={successState?.txHash}
        tonscanUrl={successState?.tonscanUrl}
        onDone={() => setSuccessState(null)}
      />
      <AnimatePresence>{createOpen ? <CreateBetModal value={createForm} onChange={setCreateField} onClose={() => setCreateOpen(false)} onSubmit={handleSubmitCreateBet} busy={createBusy} error={appError} /> : null}</AnimatePresence>
      <AnimatePresence>{actionIntroOpen ? <ActionIntroOverlay action={initialAction} bet={selectedBet} onContinue={handleActionIntroContinue} /> : null}</AnimatePresence>
      <AnimatePresence mode="wait">
        {screen === "welcome" ? (
          <WelcomeScreen onEnter={() => setScreen("main")} />
        ) : (
          <motion.div key="main" className="relative z-10 min-h-screen pb-28" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
            <header className={`sticky top-0 z-40 border-b border-white/6 transition-all duration-300 ${scrolled ? "bg-black/90 backdrop-blur-[20px]" : "bg-black/60"}`}>
              <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="orb-button flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.02] font-mono text-[11px] text-white">TON</div>
                  <div className="min-w-0">
                    <div className="display-title text-[18px] font-semibold text-white">TON Consensus</div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">{String(count).padStart(3, "0")} live markets</div>
                  </div>
                </div>
                <TonConnectButton className="tc-button" />
              </div>
              <div className="overflow-hidden border-t border-white/6"><div className="ticker whitespace-nowrap py-2 font-mono text-[10px] uppercase tracking-[0.28em] text-white/42"><span>{marquee}</span></div></div>
            </header>
            <main className="mx-auto max-w-6xl px-4 pt-4 md:pt-6">
              <section className="mb-8 grid gap-px border border-white/10 bg-white/5 lg:grid-cols-[1.15fr,0.85fr]">
                <div className="panel-surface border-r border-white/6 p-4 md:p-6">
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">Premium telegram flow</div>
                  <div className="mt-4 grid gap-px border border-white/10 bg-white/5 md:grid-cols-[1.15fr,0.85fr]">
                    <div className="bg-black p-5 md:p-6"><div className="flex items-center justify-center border border-white/10 py-10"><HeroSphere /></div></div>
                    <div className="grid gap-px bg-white/5">
                      <div className="bg-black p-5"><div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/30">selected</div><div className="display-title mt-3 text-[30px] font-semibold leading-none text-white">{selectedBet ? "#" : ""}<CountUp value={selectedBet?.id || 0} /></div><div className="mt-4 font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">{selectedBet ? selectedStatus : "IDLE"}</div></div>
                      <div className="bg-black p-5"><div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/30">wallet</div><div className="display-title mt-3 text-[24px] font-semibold text-white">{wallet?.account?.address ? "Connected" : "Not linked"}</div><div className="mt-4 font-mono text-[10px] uppercase tracking-[0.24em] text-[#0098EA]">TON CONNECT</div></div>
                      <div className="grid gap-px bg-white/5 sm:grid-cols-2 md:grid-cols-1">
                        <div className="bg-black p-5"><div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/30">stake</div><div className="display-title mt-3 text-[30px] font-semibold text-white">{selectedBet ? <CountUp value={selectedBet.amount_ton} suffix=" TON" decimals={1} /> : "--"}</div></div>
                        <div className="bg-black p-5"><div className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/30">pot</div><div className="display-title mt-3 text-[30px] font-semibold text-[#0098EA] [text-shadow:0_0_14px_rgba(0,152,234,0.24)]"><CountUp value={selectedPot} suffix=" TON" decimals={2} /></div></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="panel-surface p-4 md:p-6">
                  <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/30">selected summary</div>
                  <AnimatePresence mode="wait"><motion.div key={selectedBet ? selectedBet.id : "empty-summary"} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }} className="mt-4">{selectedBet ? <div className="border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_44%)] p-5"><div className="display-title text-[32px] font-semibold leading-[0.98] text-white">{selectedBet.description}</div><div className="mt-6 grid gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/38"><div>Creator: {selectedBet.creator_id}</div><div>Opponent: {selectedBet.opponent_id || "not joined yet"}</div><div>Status: {selectedStatus}</div></div></div> : <div className="border border-white/10 p-5 font-mono text-[11px] uppercase tracking-[0.22em] text-white/35">Select a market to inspect it here.</div>}</motion.div></AnimatePresence>
                </div>
              </section>
              {appError ? <section className="mb-8"><div className="border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">{appError}</div></section> : null}
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
              {showDepositGuide ? (
                <section className="mb-8">
                  <div className="panel-surface border border-white/10 p-4 md:p-5">
                    <div className="grid gap-5 lg:grid-cols-[1.1fr,0.9fr]">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-[#8fd9ff]">deposit instructions</div>
                        <div className="display-title mt-3 text-[28px] font-semibold text-white">Send {selectedBet?.amount_ton} TON to activate your side.</div>
                        <div className="mt-3 max-w-2xl text-sm leading-7 text-white/58">
                          Both participants deposit the same amount to the platform wallet. As soon as both deposits are confirmed, the bet becomes active and each side can later submit the result directly here.
                        </div>
                        <div className="mt-5 flex flex-wrap gap-3">
                          <button type="button" onClick={handleCopyPlatformWallet} disabled={!platformWallet} className="rounded-full border border-white bg-white px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-black disabled:opacity-40">
                            Copy Wallet
                          </button>
                          <button type="button" onClick={handleConfirmDeposit} disabled={actionBusy === "deposit"} className="rounded-full border border-white/12 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white disabled:opacity-40">
                            {actionBusy === "deposit" ? "Confirming..." : "I Sent Deposit"}
                          </button>
                        </div>
                      </div>
                      <div className="border border-white/10 bg-black p-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">platform wallet</div>
                        <div className="mt-4 break-all font-mono text-[12px] leading-6 text-[#0098EA] [text-shadow:0_0_14px_rgba(0,152,234,0.22)]">
                          {platformWallet || "Loading wallet..."}
                        </div>
                        <div className="mt-5 grid gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/42">
                          <div>1. Copy the wallet address</div>
                          <div>2. Send exactly {selectedBet?.amount_ton} TON</div>
                          <div>3. Return here and tap I Sent Deposit</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}
              <section className="mb-8">
                <SectionHeader title="Actions" aside="inside the app" />
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={handleCreateBet} className="rounded-full border border-white bg-white px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-black">Create Bet</button>
                  <button type="button" onClick={handleShareSelected} disabled={!selectedBet} className="rounded-full border border-white/12 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white disabled:opacity-30">Share Bet</button>
                  {canJoinSelected ? <button type="button" onClick={handleJoinSelected} disabled={actionBusy === "join"} className="rounded-full border border-white/12 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white disabled:opacity-40">{actionBusy === "join" ? "Joining..." : showJoinBanner ? "Accept Challenge" : "Join Selected"}</button> : null}
                  {needsDeposit ? <button type="button" onClick={handleConfirmDeposit} disabled={actionBusy === "deposit"} className="rounded-full border border-white/12 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white disabled:opacity-40">{actionBusy === "deposit" ? "Confirming..." : "I Sent Deposit"}</button> : null}
                </div>
                {oracleMode ? (
                  <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[#8fd9ff]">
                    Oracle mode is active. The Mini App will reflect the result here as soon as the dispute is resolved.
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
                            Your claim is locked: {mySubmittedOutcome}. The app is waiting for the other side to answer.
                          </div>
                        ) : (
                          <div className="mt-5 flex flex-wrap gap-3">
                            <button type="button" onClick={() => handleSubmitOutcome(OUTCOME.win)} disabled={Boolean(actionBusy)} className="rounded-full border border-white bg-white px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-black disabled:opacity-40">
                              {isCreator ? "Creator won" : "I won"}
                            </button>
                            <button type="button" onClick={() => handleSubmitOutcome(OUTCOME.lose)} disabled={Boolean(actionBusy)} className="rounded-full border border-white/12 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white disabled:opacity-40">
                              {isCreator ? "Creator lost" : "I lost"}
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="border border-white/10 bg-black p-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">how resolution works</div>
                        <div className="mt-4 grid gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/42">
                          <div>1. You submit your final claim once</div>
                          <div>2. The counterparty submits theirs</div>
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
                      {tabs.map((item) => <motion.button key={item} whileTap={{ scale: 0.95, boxShadow: "0 0 20px rgba(0,152,234,0.45)" }} onClick={() => handleTab(item)} className={`relative px-4 py-4 font-mono text-[11px] uppercase tracking-[0.3em] ${tab === item ? "text-white" : "text-white/28"}`}>{tabLabels[item]}{tab === item ? <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-4 right-4 h-[2px] bg-[#0098EA]" /> : null}</motion.button>)}
                    </div>
                    <div>
                      <AnimatePresence mode="wait"><motion.div key={tab} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.22 }}>{loading ? <div className="py-20 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-white/35">Loading...</div> : bets.length === 0 ? <div className="py-20 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-white/35">No data<div className="mt-4"><button type="button" onClick={handleCreateBet} className="rounded-full border border-white/12 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/72">Create First Bet</button></div></div> : bets.map((bet, index) => { const isSelected = selectedBet?.id === bet.id; return <motion.div key={bet.id} animate={{ opacity: selectedBet ? (isSelected ? 1 : 0.52) : 1, scale: selectedBet ? (isSelected ? 1 : 0.985) : 1 }} transition={{ duration: 0.22, ease: "easeOut" }}><BetCard bet={bet} index={index} selected={isSelected} onSelect={setSelectedBet} onOpen={() => setSelectedBet(bet)} /></motion.div>; })}</motion.div></AnimatePresence>
                    </div>
                  </div>
                </div>
                <div>
                  <SectionHeader title="Oracle" aside="selected market" />
                  <motion.div className={`panel-surface grid gap-px border ${oracleMode ? "border-[#0098EA]/35" : "border-white/10"}`} animate={{ boxShadow: oracleMode ? "inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 90px rgba(0,152,234,0.16)" : "inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 80px rgba(0,0,0,0.38)" }} transition={{ duration: 0.35, ease: "easeOut" }}>
                    <div className="p-5 md:p-6">
                      <AnimatePresence mode="wait"><motion.div key={selectedBet ? selectedBet.id : "empty-oracle"} initial={{ opacity: 0, y: 14, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -14, filter: "blur(8px)" }} transition={{ duration: 0.28 }}>{selectedBet ? <div className={`border p-5 ${oracleMode ? "border-[#0098EA]/24 bg-[radial-gradient(circle_at_top,rgba(0,152,234,0.12),transparent_38%)]" : "border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_38%)]"}`}><div className="flex flex-wrap items-start justify-between gap-5"><div className="min-w-0 flex-1"><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">market focus</div><div className="display-title mt-3 text-[31px] font-semibold leading-[1.02] text-white md:text-[36px]">{selectedBet.description}</div></div><div className="flex h-24 w-24 items-center justify-center rounded-full border border-white/10 bg-[radial-gradient(circle_at_30%_30%,rgba(0,152,234,0.14),rgba(255,255,255,0.02)_50%,transparent_72%)]"><div className="text-center"><div className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/34">state</div><motion.div className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[#0098EA]" animate={oracleMode ? { opacity: [1, 0.5, 1], scale: [1, 1.04, 1] } : { opacity: 1, scale: 1 }} transition={{ duration: 1.8, repeat: oracleMode ? Infinity : 0, ease: "easeInOut" }}>{selectedStatus}</motion.div></div></div></div><div className="mt-6 grid gap-px border border-white/10 bg-white/5 sm:grid-cols-3"><div className="bg-black p-4"><div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">bet</div><div className="display-title mt-2 text-[28px] font-semibold text-white">#<CountUp value={selectedBet.id} /></div></div><div className="bg-black p-4"><div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">stake</div><div className="mt-2 font-mono text-lg uppercase tracking-[0.18em] text-[#0098EA] [text-shadow:0_0_12px_rgba(0,152,234,0.45)]"><CountUp value={selectedBet.amount_ton} suffix=" TON" decimals={1} /></div></div><div className="bg-black p-4"><div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">pot</div><div className="mt-2 font-mono text-lg uppercase tracking-[0.18em] text-white"><CountUp value={selectedPot} suffix=" TON" decimals={2} /></div></div></div>{disputeMode ? <div className="mt-5 border border-[#0098EA]/22 bg-[#0098EA]/8 p-4"><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#8fd9ff]">dispute wizard</div><div className="display-title mt-3 text-[24px] font-semibold text-white">Both sides claimed different results.</div><div className="mt-4 grid gap-px border border-[#0098EA]/20 bg-[#0098EA]/8 sm:grid-cols-3"><div className="bg-black/60 p-3"><div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/34">step 1</div><div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/58">conflict detected</div></div><div className="bg-black/60 p-3"><div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/34">step 2</div><div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/58">oracle scans sources</div></div><div className="bg-black/60 p-3"><div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/34">step 3</div><div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/58">winner gets paid</div></div></div><div className="mt-4 grid gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/48"><div>Creator submitted: {selectedBet.creator_outcome}</div><div>Opponent submitted: {selectedBet.opponent_outcome}</div><div>The AI oracle is deciding the winner automatically now.</div><div>You do not need to go back to chat. Stay here and watch the status update.</div></div>{oracleMode ? <div className="mt-4 border border-[#0098EA]/20 bg-black/40 p-4"><div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[#8fd9ff]"><span>vote progress</span><span>{oracleVotesCount}/{oracleVotesNeeded}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8"><motion.div className="h-full bg-[#0098EA]" initial={{ width: 0 }} animate={{ width: `${Math.min((oracleVotesCount / oracleVotesNeeded) * 100, 100)}%` }} transition={{ duration: 0.4, ease: "easeOut" }} /></div></div> : null}</div> : null}{oracleMode ? <motion.div className="mt-5 flex items-center justify-between rounded-full border border-[#0098EA]/22 bg-[#0098EA]/8 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.24em] text-[#8fd9ff]" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}><span>oracle mode active</span><span>ai is resolving the dispute</span></motion.div> : null}</div> : <div className="border border-white/10 p-5 font-mono text-[11px] uppercase tracking-[0.22em] text-white/35">Select a market to continue.</div>}</motion.div></AnimatePresence>
                    </div>
                    <div className="bg-black px-5 py-5"><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/30">in-app flow</div><div className="mt-4 grid gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-white/45"><div>Create bets here.</div><div>Share invite links here.</div><div>Join, deposit and submit outcomes here.</div></div></div>
                  </motion.div>
                </div>
              </section>
            </main>
            <motion.button whileTap={{ scale: 0.95, boxShadow: "0 0 20px rgba(255,255,255,0.18)" }} onClick={handleCreateBet} className="orb-button fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-white/14 bg-white text-3xl text-black">+</motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
