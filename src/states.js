export const BET_STATUS = Object.freeze({
  pending: "pending",
  active: "active",
  confirming: "confirming",
  oracle: "oracle",
  done: "done",
  refunded: "refunded",
});

export const OUTCOME = Object.freeze({
  win: "win",
  lose: "lose",
});

export const TIMEOUT_48H = 48 * 60 * 60;
export const ORACLE_TIMEOUT_24H = 24 * 60 * 60;
export const ARBITER_COUNT = 3;
export const PLATFORM_FEE = 0.10;
export const ARBITER_FEE = 0.05;
export const REFERRAL_FEE = 0.02;
export const WINNER_GETS = 0.85;
export const AI_WINNER_GETS = 0.90;
