# TON Consensus Startup, Product, Architecture, and Security Audit

Audit basis: the connected `WorkHackathons/ton_consensus_bot` repository, including the current source tree, frontend, configuration, documentation, dependency lockfile, branches, and metadata for all 85 commits.

## Executive verdict

**Mainnet/public-funds launch: NO-GO.**

**Controlled testnet demo: CONDITIONAL GO**, only after deposit replay and payment idempotency are fixed.

TON Consensus is a credible hackathon prototype with a coherent Telegram-native experience, but it is not yet a trust-minimized protocol. Funds are pooled in a centrally controlled hot wallet, market state is stored off-chain, and multiple settlement paths can reuse deposits or issue duplicate transfers.

Repository review found one branch, `main`; 85 commits between March 19 and March 25, 2026; no releases; no open pull requests; and no visible CI workflow. The history consists mainly of generic upload/update commits, including repeated directory deletion and re-upload.

## P0 launch blockers

| Finding | Impact | Required fix |
| --- | --- | --- |
| Deposit transactions are reusable | One TON transaction can fund multiple bets with the same sender, amount, and time window | Require a unique bet/participant payment reference and store every consumed transaction hash under a unique constraint |
| Payouts and refunds are not idempotent | Concurrent API, bot, timer, vote, or retry paths can pay twice | Introduce an atomic settlement ledger and a `processing -> broadcast -> confirmed/failed` transfer state machine |
| `refundBoth` can partially succeed | The first user may be refunded, the second transfer may fail, and a retry can pay the first user again | Model each refund as an independent transfer intent and retry only unconfirmed transfers |
| Users can resolve before the deadline | Participants can submit outcomes immediately after activation | Reject outcome submission and oracle execution until the authoritative resolution timestamp |
| Crypto oracle uses current spot price | A deadline-based market can be resolved using the request-time price rather than the price at the deadline | Use a historical, timestamped price source and encode exact comparison semantics |
| AI output is not schema-safe | Any high-confidence `winner_side` other than exact `creator` is treated as an opponent win | Validate a strict result schema with an enum and fail closed |
| No per-bet custody accounting | The pooled wallet can become undercollateralized without detection | Maintain immutable deposit, liability, fee, payout, and refund ledger entries and continuously reconcile reserves |
| Human-vote settlement can race | Simultaneous deciding votes can both initiate payout | Acquire an atomic settlement lock before tallying or transferring |

## Startup audit

### Positioning

The strongest initial product is not a broad prediction market. It is:

> Telegram-native escrow and factual dispute resolution for two-party challenges.

That positioning is understandable, demonstrable, and naturally distributed through Telegram invites. Expanding early into public markets, subjective disputes, group pools, tokens, or governance would add regulatory and security risk before the core settlement loop is dependable.

### What is strong

- Clear create, invite, deposit, resolve, and payout loop.
- Telegram identity and sharing are integrated into the product.
- TON is used for real testnet transfers rather than cosmetic branding.
- AI failure has a human-arbitration fallback.
- The Mini App has substantially more product polish than a typical backend-only hackathon demo.
- Fees, arbiter rewards, and referrals form an initial monetization hypothesis.

### Business risks

1. **Custodial liability:** users send assets to a platform-controlled wallet.
2. **Gambling and prediction-market exposure:** eligibility, geography, consumer disclosures, sanctions screening, and dispute terms are absent.
3. **Trust-claim mismatch:** the documentation says “trust-minimized” and “no trust needed,” but operators control custody, database state, oracle configuration, and transfers.
4. **Oracle liability:** an AI-generated factual error directly affects money.
5. **Unvalidated unit economics:** the 10% fee has not been tested against user willingness to pay, while RPC, AI, support, fraud, and failed-transfer costs are not tracked.
6. **No operational ownership:** there is no incident policy, treasury reconciliation process, support procedure, or recovery runbook.

### Recommended rollout

#### Phase 0: testnet reliability

- Fix every P0 blocker.
- Add deterministic end-to-end settlement tests.
- Reconcile wallet balance against outstanding liabilities.
- Disable subjective and historically ambiguous markets.
- Add explicit “centralized testnet beta” disclosures.

#### Phase 1: closed mainnet pilot

- Obtain jurisdiction-specific legal advice before accepting public wagers.
- Hard-cap each stake and total platform liabilities.
- Allowlist users and market categories.
- Require manual review for exceptional withdrawals and disputed automated verdicts.
- Perform daily treasury reconciliation.
- Add a kill switch that blocks new deposits while preserving refunds.

#### Phase 2: protocolization

- Move escrow, authorization, and settlement constraints into audited contracts.
- Separate operator, fee, and custody keys.
- Make oracle evidence and decision provenance auditable.
- Add appeals and arbiter reputation or slashing rules before opening arbitration broadly.

### Metrics that matter

- Deposit match failure and replay-attempt rate.
- Liability-to-wallet-reserve ratio.
- Settlement time by resolution path.
- Payout and refund failure rate.
- AI decision reversal or appeal rate.
- Percentage of markets rejected for ambiguous terms.
- Repeat creator rate and invite acceptance rate.
- Support incidents per 100 settled markets.

## Product audit

### Core flow defects

- The bot says a funded bet is live for 48 hours, while the application retains the creator-selected deadline; `TIMEOUT_48H` is not the governing market timer.
- Outcome submission is accepted before the deadline.
- A claim has no structured observation source, timezone, timestamp, asset, comparator, or tie behavior.
- “No submission” can send a market to AI even when silence may need to count as forfeiture or trigger a grace period.
- Winners without an address are marked `done` even though the payout liability remains open.
- Public market endpoints expose participant Telegram IDs, and individual bet responses include arbiter vote rows, contradicting the anonymous-arbiter promise.
- Terms-of-use and privacy URLs resolve to the application rather than actual policies.
- README claims about what is live are stronger than the implemented safety guarantees.

### Required product changes

- Replace free-form-only markets with typed templates:
  - asset price at a timestamp;
  - sports match winner;
  - release occurred by a timestamp;
  - binary official announcement.
- Store a canonical resolution rule with timezone, allowed sources, comparator, tie/refund behavior, and appeal window.
- Show both participants the exact rule before deposit.
- Separate lifecycle states:
  `draft -> open -> funding -> funded -> awaiting_resolution -> disputed -> settling -> paid/refunded`.
- Add a withdrawal/refund dashboard for unresolved liabilities.
- Remove public Telegram IDs and arbiter identities from client responses.
- Replace “no trust needed” with an accurate centralized-beta disclosure until custody moves on-chain.

## Architecture audit

### Current architecture

- One Node process hosts Telegraf polling, Express, scheduled jobs, and self-tests.
- `sql.js` loads the SQLite database into memory and exports the full database file after writes.
- Telegram handlers, API handlers, timers, AI, and payment code can independently mutate the same bet.
- A single wallet performs deposits, payouts, fees, referrals, arbiter rewards, and refunds.
- AI evidence search discards most structured source metadata before model evaluation.
- The frontend polls several endpoints every 5–10 seconds.
- Frontend dependencies are locked, but the backend has no committed lockfile.

This architecture cannot safely scale horizontally. Multiple instances would duplicate Telegram polling, timers, oracle work, and transfers while maintaining separate or conflicting database files.

### Recommended target

```text
Telegram bot / Mini App
        |
Authenticated API
        |
Transactional database
        |
Durable job queue
   |-- deposit indexer
   |-- oracle worker
   |-- settlement worker
   `-- notification worker
        |
Transfer-intent ledger
        |
Restricted signer or escrow contract
```

Required architectural properties:

- PostgreSQL or another transactional durable store.
- Compare-and-set lifecycle transitions.
- Unique constraints for deposit hashes and transfer idempotency keys.
- Outbox pattern for durable jobs and notifications.
- One scheduler or queue-based delayed jobs.
- Separate redacted read models for public/client responses.
- Wallet reconciliation and invariant checks.
- Backups, migrations, rollback procedures, and observability.
- No signing key in the general-purpose web process.

## Security audit

### Critical and high findings

1. **Deposit replay and cross-bet reuse — Critical**
   `verifyDeposit` matches sender, approximate amount, and time only. It does not bind the transaction to a bet or record that its hash was consumed.

2. **Duplicate financial operations — Critical**
   Transfers occur before a bet is atomically finalized. API handlers, bot callbacks, vote handlers, and minute timers can overlap.

3. **Partial multi-transfer failure — Critical**
   Payouts distribute winner, platform, referral, and arbiter transfers sequentially. A later failure makes retry behavior ambiguous. `refundBoth` has the same failure mode.

4. **Oracle temporal correctness — Critical**
   The crypto fast path uses live CoinGecko data and ignores the market deadline. Users can also trigger resolution before that deadline.

5. **Unsafe AI verdict validation — Critical**
   Model output is parsed as generic JSON, confidence is trusted, and `winner_side` is not constrained to a strict enum before funds are transferred.

6. **Pooled hot-wallet custody — Critical**
   One mnemonic-controlled wallet is the custody and payment layer, without enforced per-market reserves or contract escrow.

7. **Human-vote settlement race — Critical**
   Multiple deciding votes or settlement entry points can concurrently observe an unsettled market and initiate transfers.

8. **Telegram authentication replay — High**
   Telegram HMAC is checked, but `auth_date` freshness is not enforced. Captured valid init data can be replayed indefinitely. Hash comparison should use a constant-time operation.

9. **Privacy and anonymity failure — High**
   Public bet responses contain Telegram identifiers, and vote responses expose arbiter IDs.

10. **Prompt-injection and source-provenance weakness — High**
    Search content is fed to the model as instructions-adjacent text. Tavily URLs and timestamps are not preserved as structured evidence, while the model may produce source strings.

11. **No rate limiting or abuse controls — High**
    A valid Telegram session can repeatedly create markets, query external pricing, or trigger expensive oracle work.

12. **State marked complete despite unpaid liability — High**
    `pending_address` is stored in a `done` bet, and an oracle refund failure can still transition the market to `refunded`.

13. **Non-durable database design — High**
    Whole-file synchronous exports and typical ephemeral hosting storage create corruption and loss risks.

### Supply-chain and repository controls

- Backend versions use broad caret ranges and have no root lockfile.
- No GitHub Actions workflow was found for tests, linting, dependency review, or secret scanning.
- The frontend lockfile is version 3 with 103 package entries.
- Static current-tree searches found no obvious committed token, private-key, or API-key literal.
- The environment template contained placeholders rather than populated credentials.
- Historical secret safety cannot be guaranteed by a current-tree search; a history-aware secret scanner is required before mainnet.
- Commit history quality is weak: 20 “Add files via upload” commits, seven “Delete src directory” commits, and repeated re-uploads make regression review and provenance difficult.

## Minimum acceptance criteria

Do not accept real public funds until all of the following are true:

- Every deposit is uniquely bound to one bet and one participant.
- Every financial transfer has a durable idempotency key.
- Wallet reserves equal or exceed recorded liabilities.
- Outcomes cannot be submitted before the resolution time.
- Oracle data is timestamped and reproducible.
- AI output and evidence pass strict deterministic validation.
- Failed or pending transfers remain explicit liabilities.
- Telegram authentication expires after a short configured interval.
- Public APIs redact Telegram and arbiter identities.
- Rate limits and stake caps are enforced.
- Backend dependencies are locked and CI runs tests, dependency scanning, and secret scanning.
- Treasury, incident, refund, key-rotation, privacy, and legal policies exist.
- Mainnet custody is handled by an audited escrow design or a tightly controlled, independently reviewed interim system.
