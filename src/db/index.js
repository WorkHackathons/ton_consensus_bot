import { assertDatabaseContract, DATABASE_BACKENDS } from "./contracts.js";
import { createLegacyDatabase } from "./legacy/adapter.js";

let database = null;
let initializationPromise = null;

export async function initializeDatabase({ backend = process.env.DATABASE_BACKEND || DATABASE_BACKENDS.legacy, databasePath } = {}) {
  if (backend !== DATABASE_BACKENDS.legacy) throw new Error(`Unsupported database backend: ${backend}`);
  if (database) return database;
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    const candidate = await createLegacyDatabase({ databasePath });
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
  if (initializationPromise) await initializationPromise;
  if (database) await database.close();
  database = null;
}
