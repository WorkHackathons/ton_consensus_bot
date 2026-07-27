# Render deployment

Use a Render **Web Service** with build command `npm ci`, start command `npm start`, and health check path `/health`. The included `render.yaml` is a Blueprint starting point and contains no secret values.

Required variable names: `NETWORK`, `TELEGRAM_MODE`, `TELEGRAM_TOKEN`, `MINIAPP_URL`, `WEBHOOK_BASE_URL`, `TELEGRAM_WEBHOOK_PATH`, and `TELEGRAM_WEBHOOK_SECRET`. Use `NETWORK=testnet`, `TELEGRAM_MODE=webhook`, and a path such as `/telegram/webhook`. Render injects `PORT`; do not set `API_PORT` in production.

The present sql.js backend persists `data/consensus.db` as a whole file. Render's ephemeral filesystem is not durable: attach a persistent disk only as a temporary recovery measure and back up the legacy file before redeploying. PostgreSQL cutover is a separate stage.

Expected safe logs are `HTTP listening`, `webhook initialized`, and the settlement-jobs-disabled warning. A `401` means the token must be checked in Render; `409` means another polling instance or an old webhook must be removed. Neither error is retried forever.
