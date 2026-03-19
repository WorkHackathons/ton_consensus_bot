import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { BET_STATUS, ORACLE_TIMEOUT_24H, TIMEOUT_48H } from "./states.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../data");
const DB_PATH = path.resolve(DATA_DIR, "consensus.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

const SQL = await initSqlJs({
  locateFile: (file) => path.resolve(__dirname, "../node_modules/sql.js/dist", file),
});

const db = fs.existsSync(DB_PATH)
  ? new SQL.Database(new Uint8Array(fs.readFileSync(DB_PATH)))
  : new SQL.Database();

db.run("PRAGMA foreign_keys = ON;");

const now = () => Math.floor(Date.now() / 1000);

function saveDB() {
  fs.writeFileSync(DB_PATH, db.export());
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

export function initDB() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      ton_address TEXT,
      bets_count INTEGER NOT NULL DEFAULT 0,
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

    CREATE INDEX IF NOT EXISTS idx_bets_creator_id ON bets(creator_id);
    CREATE INDEX IF NOT EXISTS idx_bets_opponent_id ON bets(opponent_id);
    CREATE INDEX IF NOT EXISTS idx_bets_status_deadline ON bets(status, deadline);
    CREATE INDEX IF NOT EXISTS idx_oracle_votes_bet_id ON oracle_votes(bet_id);
  `);
  saveDB();
}

export function upsertUser(telegramId, username) {
  write(`
    INSERT INTO users (telegram_id, username, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username
  `, [telegramId, username ?? null, now()]);
}

export function getUser(telegramId) {
  return get("SELECT * FROM users WHERE telegram_id = ?", [telegramId]);
}

export function saveTonAddress(telegramId, address) {
  write("UPDATE users SET ton_address = ? WHERE telegram_id = ?", [address, telegramId]);
}

export function getTonAddress(telegramId) {
  const row = get("SELECT ton_address FROM users WHERE telegram_id = ?", [telegramId]);
  return row?.ton_address ?? null;
}

export function getRandomArbiters(excludeIds, count) {
  const exclude = Array.isArray(excludeIds) ? excludeIds.filter(Boolean) : [];
  const placeholders = exclude.map(() => "?").join(", ");
  const filter = exclude.length
    ? `WHERE bets_count >= 1 AND telegram_id NOT IN (${placeholders})`
    : "WHERE bets_count >= 1";

  return all(`
    SELECT telegram_id, username, ton_address, bets_count
    FROM users
    ${filter}
    ORDER BY RANDOM()
    LIMIT ?
  `, [...exclude, count]);
}

export function createBet(creatorId, description, amountTon) {
  run(`
    INSERT INTO bets (creator_id, description, amount_ton, status, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, [creatorId, description, amountTon, BET_STATUS.pending, now()]);

  const row = get("SELECT last_insert_rowid() AS id");
  saveDB();
  return Number(row?.id ?? 0);
}

export function getBet(betId) {
  return get("SELECT * FROM bets WHERE id = ?", [betId]);
}

export function getBetsByUser(telegramId) {
  return all(`
    SELECT *
    FROM bets
    WHERE creator_id = ? OR opponent_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `, [telegramId, telegramId]);
}

export function getPendingBets() {
  return all(`
    SELECT *
    FROM bets
    WHERE status = ?
    ORDER BY created_at DESC
  `, [BET_STATUS.pending]);
}

export function getExpiredBets() {
  return all(`
    SELECT *
    FROM bets
    WHERE deadline IS NOT NULL
      AND deadline < ?
      AND status NOT IN (?, ?)
    ORDER BY deadline ASC
  `, [now(), BET_STATUS.done, BET_STATUS.refunded]);
}

export function joinBet(betId, opponentId) {
  write(`
    UPDATE bets
    SET opponent_id = ?
    WHERE id = ?
      AND status = ?
      AND opponent_id IS NULL
  `, [opponentId, betId, BET_STATUS.pending]);
}

export function confirmDeposit(betId, role) {
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

export function areBothDeposited(betId) {
  const row = get(`
    SELECT creator_deposit, opponent_deposit
    FROM bets
    WHERE id = ?
  `, [betId]);

  return Boolean(row?.creator_deposit && row?.opponent_deposit);
}

export function activateBet(betId) {
  write(`
    UPDATE bets
    SET status = ?,
        deadline = ?
    WHERE id = ?
  `, [BET_STATUS.active, now() + TIMEOUT_48H, betId]);
}

export function submitOutcome(betId, userId, outcome) {
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

export function resolveOutcomes(betId) {
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

export function startOracle(betId) {
  write(`
    UPDATE bets
    SET status = ?,
        deadline = ?
    WHERE id = ?
  `, [BET_STATUS.oracle, now() + ORACLE_TIMEOUT_24H, betId]);
}

export function finalizeBet(betId, winnerId, txhash) {
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
          deadline = NULL
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

export function refundBet(betId) {
  write(`
    UPDATE bets
    SET status = ?,
        deadline = NULL
    WHERE id = ?
  `, [BET_STATUS.refunded, betId]);
}

export function submitVote(betId, arbiterId, vote) {
  write(`
    INSERT OR IGNORE INTO oracle_votes (bet_id, arbiter_id, vote, voted_at)
    VALUES (?, ?, ?, ?)
  `, [betId, arbiterId, vote, now()]);
}

export function getVotes(betId) {
  return all(`
    SELECT *
    FROM oracle_votes
    WHERE bet_id = ?
    ORDER BY voted_at ASC
  `, [betId]);
}

export function tallyVotes(betId) {
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

const compatDb = {
  prepare(sql) {
    return {
      all: (...params) => all(sql, params),
      get: (...params) => get(sql, params),
      run: (...params) => {
        write(sql, params);
        return { changes: 1 };
      },
    };
  },
};

export default compatDb;
