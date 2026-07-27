export function createRuntimeState() {
  const startedAt = Date.now();
  const state = { httpStarted: false, databaseInitialized: false, telegramInitialized: false, shuttingDown: false, startupErrors: [] };
  return {
    markHttpStarted() { state.httpStarted = true; },
    markDatabaseInitialized() { state.databaseInitialized = true; },
    markTelegramInitialized(value = true) { state.telegramInitialized = value; },
    markShuttingDown() { state.shuttingDown = true; },
    recordStartupError(error) { state.startupErrors.push(error instanceof Error ? error.name : "startup_error"); },
    snapshot() { return { ...state, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }; },
    isReady() { return state.httpStarted && state.databaseInitialized && state.telegramInitialized && !state.shuttingDown; },
  };
}
