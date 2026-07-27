import { assertDatabaseContract, DATABASE_BACKENDS } from "./contracts.js";
import { createLegacyDatabase } from "./legacy/adapter.js";

let database = null;
let initializationPromise = null;
let closePromise = null;

export async function initializeDatabase({ backend = DATABASE_BACKENDS.legacy, legacyPath, databasePath } = {}) {
  if (backend !== DATABASE_BACKENDS.legacy) throw new Error(`Unsupported database backend: ${backend}`);
  if (closePromise) await closePromise;
  if (database) return database;
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    const candidate = await createLegacyDatabase({ databasePath: legacyPath ?? databasePath });
    try {
      await candidate.initialize();
      database = assertDatabaseContract(candidate);
      return database;
    } catch (error) {
      await candidate.close().catch(() => {});
      throw error;
    } finally {
      initializationPromise = null;
    }
  })();
  return initializationPromise;
}

export function getDatabase() {
  if (!database) throw new Error("Database has not been initialized");
  return database;
}

export async function closeDatabase() {
  if (closePromise) return closePromise;

  closePromise = (async () => {
    if (initializationPromise) {
      await initializationPromise;
    }
    const activeDatabase = database;
    database = null;
    if (activeDatabase) await activeDatabase.close();
  })().finally(() => {
    closePromise = null;
  });

  return closePromise;
}
