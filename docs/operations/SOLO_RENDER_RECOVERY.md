# SOLO RENDER RECOVERY

This guide deploys the recovery branch only. It does not restore the live bot until you complete the checks below. Keep the service on TON **testnet** and do not test deposits, payouts, refunds, oracle settlement, or settlement jobs.

## Part 1 — Before changing Render

In Render, open the current service and save screenshots or notes for: service status, deployment branch, Build Command, Start Command, health-check path, service URL, environment-variable **names** (not values), recent Events, and recent Logs. Do not copy secret values into chat.

If `data/consensus.db` is accessible on an attached disk or through your existing backup process, make a timestamped copy before changing anything. If it is not accessible, record that fact; do not claim a backup exists, delete the file, or recreate it.

## Part 2 — Exact Render settings

```text
Branch:
agent/recovery-db-v1

Build Command:
npm ci

Start Command:
npm start

Health Check Path:
/health
```

Required environment-variable names:

```text
NETWORK
TELEGRAM_MODE
WEBHOOK_BASE_URL
TELEGRAM_WEBHOOK_PATH
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_TOKEN
MINIAPP_URL
```

Required non-secret values:

```text
NETWORK=testnet
TELEGRAM_MODE=webhook
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
```

Set `WEBHOOK_BASE_URL` to your real service URL without a trailing slash:

```text
WEBHOOK_BASE_URL=https://<actual-render-service>.onrender.com
```

Generate `TELEGRAM_WEBHOOK_SECRET` locally, for example with a password manager's random-password generator (at least 32 random characters). Paste it directly into Render and never share it in chat.

Leave these variables **unset**:

```text
ENABLE_SETTLEMENT_JOBS
MAINNET_ACKNOWLEDGEMENT
ALLOW_MAINNET_ACKNOWLEDGEMENT
API_PORT
```

Render supplies `PORT`; do not add it manually.

## Part 3 — Deploy procedure

1. In Render, open the Web Service.
2. Open **Settings** (or the deployment/configuration page if labels differ slightly).
3. Change the deployment branch to `agent/recovery-db-v1`.
4. Set Build Command to `npm ci`.
5. Set Start Command to `npm start`.
6. Set the health-check path to `/health`.
7. Open **Environment** and add or verify the variable names and safe values above. Keep secret values private.
8. Save the settings.
9. Choose **Manual Deploy** → **Deploy latest commit** for the recovery branch.
10. Open **Logs** and wait. Do not click deploy repeatedly while a deployment is running.

## Part 4 — Expected logs

Safe expected messages include:

- `HTTP listening on 0.0.0.0:<port>`
- `webhook initialized`
- `settlement jobs disabled`

The database initializes before HTTP readiness. `/ready` becomes ready only after HTTP, database, and Telegram initialization complete.

Failure patterns:

### `401 Unauthorized`

The Telegram token may be invalid or revoked. Do not send it to anyone. Verify the existing token privately in Render.

### `409 Conflict`

Another polling process may still be running, or a stale Telegram webhook/polling configuration conflicts. Check that only this Render service is active and inspect the existing Telegram webhook privately before retrying.

### `No open ports detected`

The start command may be wrong, the process may have crashed, or the service may not be binding Render's `PORT`. Confirm the settings in Part 2 and inspect the final sanitized log lines.

### Mainnet safety error

`NETWORK` is incorrectly set to `mainnet`. Change it to `testnet`; do not add an acknowledgement variable.

### Database initialization error

Do not delete or recreate the database. Save sanitized logs and roll back if needed.

### Crash loop

Copy only the final log lines after removing secrets, wallet addresses, Telegram personal data, and raw initData.

### Webhook registration error

Check that `WEBHOOK_BASE_URL` is the actual HTTPS Render URL, the path is `/telegram/webhook`, and the webhook secret exists in Render. Do not share values.

## Part 5 — Browser verification

Open these URLs in a browser:

```text
https://<actual-render-service>.onrender.com/health
https://<actual-render-service>.onrender.com/ready
```

`/health` should return `status`, `uptimeSeconds`, `network`, `telegramMode`, `version`, `commit`, and `timestamp`. `/ready` should return safe boolean fields and `ready: true`. Do not paste unexpected full JSON into chat.

## Part 6 — Telegram verification

Use a test account and perform only this non-financial check:

1. Send `/start`.
2. Confirm the welcome response arrives.
3. Press **Open App**.
4. Confirm the Mini App loads.
5. Open **My Bets**.
6. Navigate back.
7. Optionally use the restricted self-test only if you are already configured as the developer; it is not required for recovery.

Do not deposit TON, confirm a deposit, start an oracle, trigger a payout/refund, or enable settlement jobs.

The repository does not include a built `miniapp-react/dist`; the production Mini App is expected to load from the configured `MINIAPP_URL`. If it does not load, report that as a Mini App URL/configuration issue rather than changing payment settings.

## Part 7 — Controlled restart

After the first checks pass, open the service in Render and choose **Manual Deploy** → **Clear build cache & deploy** only if a rebuild is necessary, or use the service's **Restart** control if shown. Wait for completion, then repeat:

- `/health`
- `/ready`
- Telegram `/start`
- Mini App opening
- log checks for `401`, `409`, or repeated startup

## Part 8 — Rollback

If `/health` fails, Telegram fails after private configuration checks, or a crash loop occurs:

1. Open the Render service's **Events** or **Deploys** page.
2. Select the last known-good deployment.
3. Use **Rollback** (or **Redeploy**, depending on Render's current label).
4. Confirm its health check completes.
5. Keep `ENABLE_SETTLEMENT_JOBS` unset.

Do not delete the recovery branch, alter the legacy database, or switch to PostgreSQL during rollback.
