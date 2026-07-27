import { createSqlJsLegacyStore } from "./sqljs.js";

const call = (fn) => async (...args) => fn(...args);

export async function createLegacyDatabase(options = {}) {
  const raw = await createSqlJsLegacyStore(options);
  return {
    async initialize() { raw.initialize(); },
    async close() { raw.close(); },
    users: {
      upsert: call(raw.upsertUser), getByTelegramId: call(raw.getUser), saveTonAddress: call(raw.saveTonAddress), getTonAddress: call(raw.getTonAddress),
      becomeArbiter: call(raw.becomeArbiter), setPremiumArbiter: call(raw.setPremiumArbiter), isPremiumArbiter: call(raw.isPremiumArbiter),
      getArbiters: call(raw.getArbiters), getRandomArbiters: call(raw.getRandomArbiters), getBootstrapArbiters: call(raw.getBootstrapArbiters), getPremiumArbiters: call(raw.getPremiumArbiters),
    },
    referrals: { get: call(raw.getReferrer), set: call(raw.setReferrer), incrementEarnings: call(raw.incrementReferralEarnings), count: call(raw.getReferralCount) },
    bets: {
      create: call(raw.createBet), getById: call(raw.getBet), getByUser: call(raw.getBetsByUser), getLatestByUser: call(raw.getLatestUserBet), hideForUser: call(raw.hideBetForUser),
      getPending: call(raw.getPendingBets), getByStatus: call(raw.getBetsByStatus), getExpired: call(raw.getExpiredBets), getExpiredActive: call(raw.getExpiredActiveBets), getExpiredPending: call(raw.getExpiredPendingBets),
      join: call(raw.joinBet), activate: call(raw.activateBet), refund: call(raw.refundBet), finalize: call(raw.finalizeBet), startOracle: call(raw.startOracle),
      claimSettlement: call(raw.claimSettlement), finalizeClaimedSettlement: call(raw.finalizeClaimedSettlement),
      markSettlementFailed: call(raw.markSettlementFailed), markSettlementUncertain: call(raw.markSettlementUncertain),
    },
    deposits: { confirm: call(raw.confirmDeposit), areBothConfirmed: call(raw.areBothDeposited), confirmAndMaybeActivate: call(raw.confirmAndMaybeActivate) },
    outcomes: { submit: call(raw.submitOutcome), resolve: call(raw.resolveOutcomes) },
    oracle: { assign: call(raw.assignArbiters), getAssignments: call(raw.getAssignedArbiters), isAssigned: call(raw.isAssignedArbiter), submitVote: call(raw.submitVote), getVotes: call(raw.getVotes), tallyVotes: call(raw.tallyVotes) },
    reporting: { arbiterCount: call(raw.getArbiterCount), completedBetsCount: call(raw.getCompletedBetsCount), arbiterAccuracy: call(raw.getArbiterAccuracy), recordCounts: call(raw.getRecordCounts) },
    test: { removeBets: call(raw.removeBets), removeUsers: call(raw.removeUsers) },
  };
}
