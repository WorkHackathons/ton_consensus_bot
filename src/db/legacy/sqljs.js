import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { BET_STATUS, ORACLE_TIMEOUT_24H } from "../../states.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DB_PATH = path.resolve(__dirname, "../../../data/consensus.db");

/**
 * The only sql.js implementation. The public adapter wraps this store in
 * Promises so no application consumer can reach sql.js directly.
 */
export async function createSqlJsLegacyStore({ databasePath = process.env.DATABASE_PATH || DEFAULT_DB_PATH } = {}) {
  const dataDir = path.dirname(databasePath);
  const SQL = await initSqlJs({
    locateFile: (file) => path.resolve(__dirname, "../../../node_modules/sql.js/dist", file),
  });
  fs.mkdirSync(dataDir, { recursive: true });
  const db = fs.existsSync(databasePath)
    ? new SQL.Database(new Uint8Array(fs.readFileSync(databasePath)))
    : new SQL.Database();
  db.run("PRAGMA foreign_keys = ON;");

  const now = () => Math.floor(Date.now() / 1000);

function saveDB() {
  fs.writeFileSync(databasePath, db.export());
}

function run(sql, params = []) {
  db.run(sql, params);
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);

  try {
    stmt.bind(params);
    if (!stmt.step()) {
      return null;
    }
    return stmt.getAsObject();
  } finally {
    stmt.free();
  }
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];

  try {
    stmt.bind(params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
  } finally {
    stmt.free();
  }

  return rows;
}

function write(sql, params = []) {
  run(sql, params);
  saveDB();
}

function ensureColumn(table, column, definition) {
  const exists = all(`PRAGMA table_info(${table})`).some((row) => row.name === column);
  if (!exists) {
    run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function initDB() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      ton_address TEXT,
      bets_count INTEGER NOT NULL DEFAULT 0,
      arbiter_since INTEGER DEFAULT NULL,
      is_premium_arbiter INTEGER NOT NULL DEFAULT 0,
      referred_by INTEGER DEFAULT NULL,
      referral_earnings REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      opponent_id INTEGER,
      description TEXT NOT NULL,
      amount_ton REAL NOT NULL,
      status TEXT NOT NULL,
      creator_outcome TEXT,
      opponent_outcome TEXT,
      winner_id INTEGER,
      creator_deposit INTEGER NOT NULL DEFAULT 0,
      opponent_deposit INTEGER NOT NULL DEFAULT 0,
      payout_txhash TEXT,
      created_at INTEGER NOT NULL,
      deadline INTEGER,
      hidden_by_creator INTEGER NOT NULL DEFAULT 0,
      hidden_by_opponent INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (creator_id) REFERENCES users(telegram_id),
      FOREIGN KEY (opponent_id) REFERENCES users(telegram_id)
    );

    CREATE TABLE IF NOT EXISTS oracle_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bet_id INTEGER NOT NULL,
      arbiter_id INTEGER NOT NULL,
      vote INTEGER NOT NULL,
      voted_at INTEGER NOT NULL,
      UNIQUE(bet_id, arbiter_id),
      FOREIGN KEY (bet_id) REFERENCES bets(id) ON DELETE CASCADE,
      FOREIGN KEY (arbiter_id) REFERENCES users(telegram_id)
    );

    CREATE TABLE IF NOT EXISTS oracle_assignments (
      bet_id INTEGER NOT NULL,
      arbiter_id INTEGER NOT NULL,
      assigned_at INTEGER NOT NULL,
      PRIMARY KEY (bet_id, arbiter_id),
      FOREIGN KEY (bet_id) REFERENCES bets(id) ON DELETE CASCADE,
      FOREIGN KEY (arbiter_id) REFERENCES users(telegram_id)
    );

    CREATE INDEX IF NOT EXISTS idx_bets_creator_id ON bets(creator_id);
    CREATE INDEX IF NOT EXISTS idx_bets_opponent_id ON bets(opponent_id);
    CREATE INDEX IF NOT EXISTS idx_bets_status_deadline ON bets(status, deadline);
    CREATE INDEX IF NOT EXISTS idx_oracle_votes_bet_id ON oracle_votes(bet_id);
    CREATE INDEX IF NOT EXISTS idx_oracle_assignments_bet_id ON oracle_assignments(bet_id);
  `);
  ensureColumn("users", "arbiter_since", "INTEGER DEFAULT NULL");
  ensureColumn("users", "is_premium_arbiter", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "referred_by", "INTEGER DEFAULT NULL");
  ensureColumn("users", "referral_earnings", "REAL NOT NULL DEFAULT 0");
  ensureColumn("bets", "oracle_deadline", "INTEGER DEFAULT NULL");
  ensureColumn("bets", "hidden_by_creator", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("bets", "hidden_by_opponent", "INTEGER NOT NULL DEFAULT 0");
  saveDB();
}

function upsertUser(telegramId, username) {
  write(`
    INSERT INTO users (telegram_id, username, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username
  `, [telegramId, username ?? null, now()]);
}

function getUser(telegramId) {
  return get("SELECT * FROM users WHERE telegram_id = ?", [telegramId]);
}

function saveTonAddress(telegramId, address) {
  write("UPDATE users SET ton_address = ? WHERE telegram_id = ?", [address, telegramId]);
}

function getTonAddress(telegramId) {
  const row = get("SELECT ton_address FROM users WHERE telegram_id = ?", [telegramId]);
  return row?.ton_address ?? null;
}

function getRandomArbiters(excludeIds, count) {
  const exclude = Array.isArray(excludeIds) ? excludeIds.filter(Boolean) : [];
  const placeholders = exclude.map(() => "?").join(", ");
  const filter = exclude.length
    ? `WHERE telegram_id NOT IN (${placeholders})`
    : "";

  return all(`
    SELECT telegram_id, username, ton_address, bets_count, arbiter_since
    FROM users
    ${filter}
    ORDER BY RANDOM()
    LIMIT ?
  `, [...exclude, count]);
}

function getArbiterCount() {
  return Number(get("SELECT COUNT(*) AS count FROM users WHERE arbiter_since IS NOT NULL")?.count ?? 0);
}

function getBootstrapArbiters(excludeIds, count) {
  const exclude = Array.isArray(excludeIds) ? excludeIds.filter(Boolean) : [];
  const placeholders = exclude.map(() => "?").join(", ");
  const whereClause = placeholders ? `WHERE telegram_id NOT IN (${placeholders})` : "";

  return all(`
    SELECT telegram_id, username, ton_address
    FROM users
    ${whereClause}
    ORDER BY created_at ASC
    LIMIT ?
  `, [...exclude, count]);
}

function getArbiters(excludeIds, count) {
  const exclude = Array.isArray(excludeIds) ? excludeIds.filter(Boolean) : [];
  const placeholders = exclude.map(() => "?").join(", ");
  const whereClause = placeholders
    ? `WHERE arbiter_since IS NOT NULL AND telegram_id NOT IN (${placeholders})`
    : "WHERE arbiter_since IS NOT NULL";

  const arbiters = all(`
    SELECT telegram_id, username, ton_address
    FROM users
    ${whereClause}
    ORDER BY RANDOM()
    LIMIT ?
  `, [...exclude, count]);

  if (arbiters.length < 2) {
    return getBootstrapArbiters(excludeIds, count);
  }

  return arbiters;
}

function becomeArbiter(telegramId) {
  write("UPDATE users SET arbiter_since = ? WHERE telegram_id = ?", [now(), telegramId]);
}

function setPremiumArbiter(telegramId, value = 1) {
  write("UPDATE users SET is_premium_arbiter = ? WHERE telegram_id = ?", [value ? 1 : 0, telegramId]);
}

function isPremiumArbiter(telegramId) {
  return Boolean(get("SELECT is_premium_arbiter FROM users WHERE telegram_id = ?", [telegramId])?.is_premium_arbiter);
}

function getPremiumArbiters(excludeIds = []) {
  const exclude = Array.isArray(excludeIds) ? excludeIds.filter(Boolean) : [];
  const placeholders = exclude.map(() => "?").join(", ");
  const whereClause = placeholders
    ? `WHERE is_premium_arbiter = 1 AND telegram_id NOT IN (${placeholders})`
    : "WHERE is_premium_arbiter = 1";

  return all(`
    SELECT telegram_id, username, ton_address
    FROM users
    ${whereClause}
    ORDER BY created_at ASC
  `, exclude);
}

function getReferrer(telegramId) {
  return get("SELECT referred_by FROM users WHERE telegram_id = ?", [telegramId])?.referred_by ?? null;
}

function setReferrer(telegramId, referrerId) {
  const user = getUser(telegramId);
  if (!user || user.referred_by || Number(referrerId) === Number(telegramId)) {
    return false;
  }

  write("UPDATE users SET referred_by = ? WHERE telegram_id = ?", [referrerId, telegramId]);
  return true;
}

function incrementReferralEarnings(telegramId, amountTon) {
  write(
    "UPDATE users SET referral_earnings = COALESCE(referral_earnings, 0) + ? WHERE telegram_id = ?",
    [amountTon, telegramId],
  );
}

function getArbiterAccuracy(telegramId) {
  const votes = all(`
    SELECT ov.vote, b.winner_id
    FROM oracle_votes ov
    JOIN bets b ON b.id = ov.bet_id
    WHERE ov.arbiter_id = ?
      AND b.status = ?
      AND b.winner_id IS NOT NULL
  `, [telegramId, BET_STATUS.done]);

  const total = votes.length;
  const correct = votes.filter((row) => Number(row.vote) === Number(row.winner_id)).length;

  return {
    total,
    correct,
    accuracy: total ? Math.round((correct / total) * 100) : null,
  };
}

function createBet(creatorId, description, amountTon, deadlineTs) {
  run(`
    INSERT INTO bets (creator_id, description, amount_ton, status, created_at, deadline)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [creatorId, description, amountTon, BET_STATUS.pending, now(), deadlineTs ?? null]);

  const row = get("SELECT last_insert_rowid() AS id");
  saveDB();
  return Number(row?.id ?? 0);
}

function getBet(betId) {
  return get("SELECT * FROM bets WHERE id = ?", [betId]);
}

function getBetsByUser(telegramId) {
  return all(`
    SELECT *
    FROM bets
    WHERE (
        creator_id = ? AND COALESCE(hidden_by_creator, 0) = 0
      ) OR (
        opponent_id = ? AND COALESCE(hidden_by_opponent, 0) = 0
      )
    ORDER BY created_at DESC
    LIMIT 10
  `, [telegramId, telegramId]);
}

function getLatestUserBet(telegramId) {
  return get(`
    SELECT *
    FROM bets
    WHERE creator_id = ? OR opponent_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `, [telegramId, telegramId]);
}

function getCompletedBetsCount() {
  return Number(get("SELECT COUNT(*) AS count FROM bets WHERE status = ?", [BET_STATUS.done])?.count ?? 0);
}

function hideBetForUser(betId, telegramId) {
  const bet = getBet(betId);
  if (!bet) {
    return { ok: false, error: "Bet not found" };
  }

  const status = String(bet.status || "");
  if (status !== BET_STATUS.done && status !== BET_STATUS.refunded) {
    return { ok: false, error: "Only completed or refunded bets can be removed" };
  }

  if (Number(bet.creator_id) === Number(telegramId)) {
    write("UPDATE bets SET hidden_by_creator = 1 WHERE id = ?", [betId]);
    return { ok: true };
  }

  if (Number(bet.opponent_id) === Number(telegramId)) {
    write("UPDATE bets SET hidden_by_opponent = 1 WHERE id = ?", [betId]);
    return { ok: true };
  }

  return { ok: false, error: "You are not a participant in this bet" };
}

function getPendingBets() {
  return all(`
    SELECT *
    FROM bets
    WHERE status = ?
    ORDER BY created_at DESC
  `, [BET_STATUS.pending]);
}

function getBetsByStatus(status, limit = 20) {
  return all(
    "SELECT * FROM bets WHERE status = ? ORDER BY created_at DESC LIMIT ?",
    [status, limit],
  );
}

function getExpiredActiveBets(at = now()) {
  return all(`
    SELECT *
    FROM bets
    WHERE status IN (?, ?)
      AND deadline IS NOT NULL
      AND deadline < ?
  `, [BET_STATUS.active, BET_STATUS.confirming, at]);
}

function getExpiredPendingBets(at = now()) {
  return all(`
    SELECT *
    FROM bets
    WHERE status = ?
      AND deadline IS NOT NULL
      AND deadline < ?
  `, [BET_STATUS.pending, at]);
}

function getExpiredBets() {
  return all(`
    SELECT *
    FROM bets
    WHERE (
        (status = ? AND oracle_deadline IS NOT NULL AND oracle_deadline < ?)
        OR
        (status != ? AND deadline IS NOT NULL AND deadline < ?)
      )
      AND status NOT IN (?, ?)
    ORDER BY COALESCE(oracle_deadline, deadline) ASC
  `, [BET_STATUS.oracle, now(), BET_STATUS.oracle, now(), BET_STATUS.done, BET_STATUS.refunded]);
}

function joinBet(betId, opponentId) {
  write(`
    UPDATE bets
    SET opponent_id = ?
    WHERE id = ?
      AND status = ?
      AND opponent_id IS NULL
  `, [opponentId, betId, BET_STATUS.pending]);
}

function confirmDeposit(betId, role) {
  if (role !== "creator" && role !== "opponent") {
    throw new Error("Invalid deposit role");
  }

  const column = role === "creator" ? "creator_deposit" : "opponent_deposit";
  write(`
    UPDATE bets
    SET ${column} = 1
    WHERE id = ?
  `, [betId]);
}

function areBothDeposited(betId) {
  const row = get(`
    SELECT creator_deposit, opponent_deposit
    FROM bets
    WHERE id = ?
  `, [betId]);

  return Boolean(row?.creator_deposit && row?.opponent_deposit);
}

function activateBet(betId) {
  write(`
    UPDATE bets
    SET status = ?
    WHERE id = ?
  `, [BET_STATUS.active, betId]);
}

function submitOutcome(betId, userId, outcome) {
  const bet = getBet(betId);
  if (!bet) {
    return;
  }

  if (Number(userId) === Number(bet.creator_id)) {
    if (bet.creator_outcome) {
      return;
    }

    write(`
      UPDATE bets
      SET creator_outcome = ?,
          status = ?
      WHERE id = ?
        AND creator_outcome IS NULL
    `, [outcome, BET_STATUS.confirming, betId]);
    return;
  }

  if (Number(userId) === Number(bet.opponent_id)) {
    if (bet.opponent_outcome) {
      return;
    }

    write(`
      UPDATE bets
      SET opponent_outcome = ?,
          status = ?
      WHERE id = ?
        AND opponent_outcome IS NULL
    `, [outcome, BET_STATUS.confirming, betId]);
  }
}

function resolveOutcomes(betId) {
  const bet = getBet(betId);
  if (!bet || !bet.creator_outcome || !bet.opponent_outcome) {
    return null;
  }

  if (bet.creator_outcome === "win" && bet.opponent_outcome === "lose") {
    return bet.creator_id;
  }

  if (bet.creator_outcome === "lose" && bet.opponent_outcome === "win") {
    return bet.opponent_id;
  }

  return "dispute";
}

function startOracle(betId) {
  write(`
    UPDATE bets
    SET status = ?,
        oracle_deadline = ?
    WHERE id = ?
  `, [BET_STATUS.oracle, now() + ORACLE_TIMEOUT_24H, betId]);
}

function finalizeBet(betId, winnerId, txhash) {
  const bet = getBet(betId);
  if (!bet) {
    return;
  }

  const alreadyDone = bet.status === BET_STATUS.done;

  db.run("BEGIN");
  try {
    run(`
      UPDATE bets
        SET status = ?,
            winner_id = ?,
            payout_txhash = ?,
            deadline = NULL,
            oracle_deadline = NULL
        WHERE id = ?
    `, [BET_STATUS.done, winnerId ?? null, txhash ?? null, betId]);

    if (!alreadyDone && bet.creator_id && bet.opponent_id) {
      run(`
        UPDATE users
        SET bets_count = bets_count + 1
        WHERE telegram_id IN (?, ?)
      `, [bet.creator_id, bet.opponent_id]);
    }

    db.run("COMMIT");
    saveDB();
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}

function refundBet(betId) {
  write(`
    UPDATE bets
    SET status = ?,
        deadline = NULL,
        oracle_deadline = NULL
    WHERE id = ?
  `, [BET_STATUS.refunded, betId]);
}

function assignArbiters(betId, arbiterIds) {
  const ids = Array.isArray(arbiterIds) ? [...new Set(arbiterIds.filter(Boolean).map(Number))] : [];
  db.run("BEGIN");
  try {
    run("DELETE FROM oracle_assignments WHERE bet_id = ?", [betId]);
    for (const arbiterId of ids) {
      run(
        "INSERT OR IGNORE INTO oracle_assignments (bet_id, arbiter_id, assigned_at) VALUES (?, ?, ?)",
        [betId, arbiterId, now()],
      );
    }
    db.run("COMMIT");
    saveDB();
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}

function getAssignedArbiters(betId) {
  return all(
    "SELECT arbiter_id FROM oracle_assignments WHERE bet_id = ? ORDER BY assigned_at ASC",
    [betId],
  ).map((row) => Number(row.arbiter_id));
}

function isAssignedArbiter(betId, arbiterId) {
  const row = get(
    "SELECT 1 AS ok FROM oracle_assignments WHERE bet_id = ? AND arbiter_id = ?",
    [betId, arbiterId],
  );
  return Boolean(row?.ok);
}

function submitVote(betId, arbiterId, vote) {
  if (get("SELECT 1 AS ok FROM oracle_votes WHERE bet_id = ? AND arbiter_id = ?", [betId, arbiterId])) {
    return false;
  }
  write(`
    INSERT OR IGNORE INTO oracle_votes (bet_id, arbiter_id, vote, voted_at)
    VALUES (?, ?, ?, ?)
  `, [betId, arbiterId, vote, now()]);
  return true;
}

function getVotes(betId) {
  return all(`
    SELECT *
    FROM oracle_votes
    WHERE bet_id = ?
    ORDER BY voted_at ASC
  `, [betId]);
}

function tallyVotes(betId) {
  const votes = getVotes(betId);
  const counts = new Map();

  for (const row of votes) {
    counts.set(row.vote, (counts.get(row.vote) ?? 0) + 1);
  }

  for (const [vote, count] of counts.entries()) {
    if (count >= 2) {
      return vote;
    }
  }

  return null;
}

function getReferralCount(telegramId) {
  return Number(get("SELECT COUNT(*) AS count FROM users WHERE referred_by = ?", [telegramId])?.count ?? 0);
}

function getRecordCounts() {
  return {
    users: Number(get("SELECT COUNT(*) AS count FROM users")?.count ?? 0),
    bets: Number(get("SELECT COUNT(*) AS count FROM bets")?.count ?? 0),
  };
}

function removeBets(betIds = []) {
  for (const betId of betIds) {
    write("DELETE FROM bets WHERE id = ?", [betId]);
  }
}

function removeUsers(userIds = []) {
  for (const userId of userIds) {
    write("DELETE FROM users WHERE telegram_id = ?", [userId]);
  }
}

function close() {
  db.close();
}

  return {
    initialize: initDB,
    close,
    upsertUser, getUser, saveTonAddress, getTonAddress,
    getRandomArbiters, getArbiterCount, getBootstrapArbiters, getArbiters,
    becomeArbiter, setPremiumArbiter, isPremiumArbiter, getPremiumArbiters,
    getReferrer, setReferrer, incrementReferralEarnings, getReferralCount, getArbiterAccuracy,
    createBet, getBet, getBetsByUser, getLatestUserBet, getCompletedBetsCount,
    hideBetForUser, getPendingBets, getBetsByStatus, getExpiredBets,
    getExpiredActiveBets, getExpiredPendingBets, joinBet, confirmDeposit,
    areBothDeposited, activateBet, submitOutcome, resolveOutcomes, startOracle,
    finalizeBet, refundBet, assignArbiters, getAssignedArbiters, isAssignedArbiter,
    submitVote, getVotes, tallyVotes, getRecordCounts, removeBets, removeUsers,
  };
}
