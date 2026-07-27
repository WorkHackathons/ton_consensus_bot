/**
 * Async database contract shared by legacy and future PostgreSQL adapters.
 * Amounts crossing this boundary remain legacy TON numbers until PostgreSQL
 * migration converts them to nanoTON; callers must never access sql.js here.
 */
export const DATABASE_BACKENDS = Object.freeze({ legacy: "legacy", postgres: "postgres" });

/**
 * Stable asynchronous repository surface. PostgreSQL B1 must implement this
 * shape without changing application callers or exposing a driver object.
 */
export const DATABASE_CONTRACT_OPERATIONS = Object.freeze({
  users: ["upsert", "getByTelegramId", "saveTonAddress", "getTonAddress", "becomeArbiter", "setPremiumArbiter", "isPremiumArbiter", "getArbiters", "getRandomArbiters", "getBootstrapArbiters", "getPremiumArbiters"],
  referrals: ["get", "set", "incrementEarnings", "count"],
  bets: ["create", "getById", "getByUser", "getLatestByUser", "hideForUser", "getPending", "getByStatus", "getExpired", "getExpiredActive", "getExpiredPending", "join", "activate", "refund", "finalize", "startOracle", "claimSettlement", "finalizeClaimedSettlement", "markSettlementFailed", "markSettlementUncertain"],
  deposits: ["confirm", "areBothConfirmed", "confirmAndMaybeActivate"],
  outcomes: ["submit", "resolve"],
  oracle: ["assign", "getAssignments", "isAssigned", "submitVote", "getVotes", "tallyVotes"],
  settlements: ["recordTransferReceipt", "getTransferReceipts"],
  reporting: ["arbiterCount", "completedBetsCount", "arbiterAccuracy", "recordCounts"],
  test: ["removeBets", "removeUsers"],
});

export function assertDatabaseContract(database) {
  for (const [repository, operations] of Object.entries(DATABASE_CONTRACT_OPERATIONS)) {
    if (!database?.[repository]) throw new Error(`Database repository unavailable: ${repository}`);
    for (const operation of operations) {
      if (typeof database[repository][operation] !== "function") {
        throw new Error(`Database operation unavailable: ${repository}.${operation}`);
      }
    }
  }
  return database;
}
