# Runtime recovery runbook

The process is one Render web service. It binds `0.0.0.0` and uses `PORT`, falling back to `API_PORT`, then `3001` only for local development.

## Required recovery settings

Set `NETWORK=testnet`, `TELEGRAM_MODE=webhook`, `MINIAPP_URL`, `WEBHOOK_BASE_URL`, `TELEGRAM_WEBHOOK_PATH=/telegram/webhook`, `TELEGRAM_WEBHOOK_SECRET`, and `TELEGRAM_TOKEN`. Do not put values in this document or in source control. Leave `ENABLE_SETTLEMENT_JOBS` unset during recovery verification.

`WEBHOOK_BASE_URL` must be the service's HTTPS base URL. Telegram receives `WEBHOOK_BASE_URL` plus `TELEGRAM_WEBHOOK_PATH`; the token is never part of that URL.

## Recovery verification

1. Create a backup of `data/consensus.db` if it is accessible. Do not delete or recreate it.
2. Deploy only the recovery commit. Confirm the service starts and Render marks `/health` healthy.
3. Open `/health`; it returns only runtime metadata. Open `/ready`; it becomes ready once database and Telegram initialization complete.
4. Send `/start` from a test account and open the Mini App. Confirm logs contain no `401`, `409`, or crash-loop messages.
5. Restart the service once, observe the same checks, and keep `NETWORK=testnet`.
6. Do not enable settlement jobs or attempt a payment, refund, deposit, or oracle settlement as part of this recovery check.

## Rollback

Roll back the Render deploy to the previous release. Keep the legacy database and its backup in place. Do not switch to a database migration or mainnet configuration while investigating a runtime incident.
