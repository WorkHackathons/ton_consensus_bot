# TON Consensus P0 and Critical Fix Plan

This plan converts every P0 and Critical audit finding into an actionable engineering task. It intentionally does not implement any fix.

All tasks below block public mainnet funds. The order reflects technical dependencies and the risk of losing or misallocating funds.

## 1. Establish a transactional market and financial ledger

**Problem**

The current `sql.js` database stores mutable bet flags but has no immutable financial ledger, durable transfer intents, or reliable cross-process transactions. This prevents safe idempotency, reconciliation, and horizontal scaling.

**Affected files**

- `src/db.js`
- `src/states.js`
- `src/api.js`
- `src/bot.js`
- `src/oracle.js`
- `src/ton.js`
- deployment/runtime configuration
- new database migration and repository modules

**Expected safe behavior**

- Every deposit, liability, fee, payout, arbiter reward, referral reward, and refund is represented by an immutable or append-only ledger entry.
- Market lifecycle transitions use compare-and-set semantics in a transactional database.
- Outstanding liabilities can be calculated exactly at any time.
- Multiple application instances cannot create conflicting state.

**Implementation approach**

1. Move financial state to PostgreSQL or another durable transactional database.
2. Define explicit market states:
   `draft`, `open`, `funding`, `funded`, `awaiting_resolution`, `disputed`, `settling`, `paid`, `refunding`, `refunded`, and `manual_review`.
3. Add `deposits`, `ledger_entries`, `settlements`, and `transfer_intents` tables.
4. Add foreign keys, state-transition constraints, unique idempotency keys, and monetary values stored as integer nanotons.
5. Introduce repository/service boundaries so API, bot, timers, and workers use the same transactional commands.
6. Add wallet reserve reconciliation against open liabilities.

**Tests required**

- Migration tests from representative existing data.
- State-transition table tests covering every valid and invalid transition.
- Transaction rollback tests.
- Concurrent mutation tests from multiple processes.
- Ledger invariant tests: assets, liabilities, fees, payouts, and refunds balance.
- Backup and restore test.

**Completion criteria**

- No financial workflow relies only on mutable boolean deposit flags or a payout hash stored on `bets`.
- A reconciliation query proves total reserves are at least total outstanding liabilities.
- Concurrent lifecycle commands produce one valid result.
- Database backup and recovery are documented and exercised.

**Blocks mainnet:** Yes.

## 2. Bind each deposit to one bet and one participant

**Problem**

`verifyDeposit` can reuse the same transaction for multiple bets because it matches sender, approximate amount, and time without a unique bet reference or consumed-transaction record.

**Affected files**

- `src/ton.js`
- `src/api.js`
- `src/db.js`
- `miniapp-react/src/App.jsx`
- new deposit indexer and migration files

**Expected safe behavior**

- A deposit is accepted only when its destination, sender, exact amount, network, confirmation status, and unique payment reference match the expected participant funding instruction.
- One on-chain transaction can satisfy at most one deposit obligation.
- Replaying a transaction returns the original result for the same obligation and fails for every other obligation.

**Implementation approach**

1. Create a unique deposit obligation for `(bet_id, participant_id)`.
2. Generate a non-guessable or collision-resistant payment reference and include it in the TON transfer payload/comment.
3. Index inbound transactions and preserve hash, logical time, sender, destination, value, payload, timestamp, and confirmations.
4. Insert a matched deposit with a database-level unique constraint on transaction identity.
5. Remove the broad amount/time scan from the request path.
6. Require the configured number of confirmations before moving the market to `funded`.
7. Refuse shared participant wallet ambiguity unless the payment reference uniquely resolves it.

**Tests required**

- Replay the same hash against the same obligation.
- Replay the same hash against a different bet.
- Two users sending the same amount at nearly the same time.
- Same wallet funding both participants with different references.
- Wrong sender, destination, amount, payload, network, and timestamp.
- Chain reorganization or temporary indexing delay.
- Concurrent confirmation requests.

**Completion criteria**

- Database uniqueness prevents cross-bet and cross-participant reuse.
- Deposit verification is deterministic from indexed transaction data.
- The application has no fallback that confirms a deposit from amount and time alone.
- Reconciliation can trace each funded participant to one unique chain transaction.

**Blocks mainnet:** Yes.

## 3. Implement durable transfer intents and idempotent signing

**Problem**

Winner, platform, referral, arbiter, and refund transfers are sent directly from request handlers. A retry or concurrent entry point can broadcast duplicate transfers.

**Affected files**

- `src/ton.js`
- `src/api.js`
- `src/bot.js`
- `src/oracle.js`
- `src/db.js`
- new settlement worker and transfer-intent modules

**Expected safe behavior**

- Each required transfer has one stable idempotency key.
- Repeated commands return the existing transfer state and never create another transfer.
- Broadcast and confirmation are durable, observable steps.
- Unknown broadcast outcomes enter reconciliation, not blind retry.

**Implementation approach**

1. Generate transfer intents from the financial ledger in a database transaction.
2. Use keys such as `bet:{id}:winner`, `bet:{id}:platform`, `bet:{id}:referral:{user}`, `bet:{id}:arbiter:{user}`, and `bet:{id}:refund:{user}`.
3. Add states `created`, `signing`, `broadcast`, `confirmed`, `failed_retryable`, `failed_terminal`, and `manual_review`.
4. Move signing and broadcasting into one restricted worker.
5. Persist the wallet sequence number, message hash, transaction hash, attempt count, and error details.
6. On ambiguous RPC failure, reconcile wallet sequence and chain history before any retry.
7. Mark a market paid only after all mandatory transfer intents meet their required terminal state.

**Tests required**

- Duplicate API requests and bot callbacks.
- Worker crash before broadcast, during broadcast, and after broadcast but before persistence.
- RPC timeout after a successful send.
- Process restart with `signing` or `broadcast` intents.
- Multiple workers competing for the same intent.
- Fee/reward failure after winner success.

**Completion criteria**

- A repeated settlement command cannot create a second winner transfer.
- Every on-chain outgoing transaction maps to one ledger transfer intent.
- Ambiguous sends are reconciled automatically or moved to manual review.
- Chaos tests demonstrate exactly-once economic effect.

**Blocks mainnet:** Yes.

## 4. Make settlement and arbiter voting atomic

**Problem**

API outcomes, Telegram callbacks, scheduled jobs, AI resolution, and multiple deciding arbiter votes can concurrently observe an unsettled bet and initiate payout.

**Affected files**

- `src/api.js`
- `src/bot.js`
- `src/oracle.js`
- `src/engine.js`
- `src/db.js`
- new settlement service/worker files

**Expected safe behavior**

- Exactly one resolution is accepted.
- Exactly one settlement record and set of transfer intents are created.
- Late or duplicate outcomes/votes are recorded or rejected without financial side effects.

**Implementation approach**

1. Centralize all resolution paths behind one `requestSettlement` command.
2. Lock the market row or use an atomic update from an allowed state to `settling`.
3. Store the winning side, resolution method, evidence/version, and deciding votes in the same transaction.
4. Enqueue settlement through an outbox committed with the state change.
5. Make timers request work through the same command rather than calling payment code.
6. Enforce assignment, uniqueness, quorum, and a fixed arbiter-set size at the database layer.

**Tests required**

- Two deciding votes arriving simultaneously.
- Outcome API and deadline worker racing.
- Telegram callback and Mini App request racing.
- AI result and human fallback racing.
- Duplicate queue delivery.
- Late vote after settlement begins.

**Completion criteria**

- Concurrency tests produce one resolution and one settlement.
- No handler outside the settlement service can call a transfer function.
- Audit records identify which command won the settlement race.

**Blocks mainnet:** Yes.

## 5. Make refunds independent, resumable, and liability-safe

**Problem**

`refundBoth` sends two transfers sequentially. If the first succeeds and the second fails, retrying the operation can duplicate the first refund. Oracle refund failure may still mark the market refunded.

**Affected files**

- `src/ton.js`
- `src/oracle.js`
- `src/bot.js`
- `src/db.js`
- settlement worker and ledger modules introduced above

**Expected safe behavior**

- Each participant refund is an independent idempotent liability.
- A market remains `refunding` until all required refunds are confirmed.
- A failed refund is visible and retryable without repeating successful transfers.

**Implementation approach**

1. Replace `refundBoth` and `refundSingle` orchestration with per-participant transfer intents.
2. Create all refund liabilities in one transaction before sending.
3. Confirm each transfer independently.
4. Transition to `refunded` only when every required refund is confirmed or formally waived through a controlled manual process.
5. Expose pending refund status to the affected participant and operators.

**Tests required**

- First refund succeeds and second fails.
- Second refund succeeds after restart.
- Both transfers time out after broadcast.
- Participant has no valid address.
- Duplicate refund job delivery.
- Insufficient wallet balance.

**Completion criteria**

- Successful refunds are never resent by retrying another participant’s failure.
- `refunded` means all mandatory refunds are confirmed.
- Outstanding refunds remain visible in liability reconciliation.

**Blocks mainnet:** Yes.

## 6. Enforce authoritative market deadlines

**Problem**

Participants can submit outcomes immediately after activation, and application copy conflicts over whether the market uses a creator-selected deadline or a 48-hour period.

**Affected files**

- `src/api.js`
- `src/bot.js`
- `src/db.js`
- `src/states.js`
- `miniapp-react/src/App.jsx`
- product documentation

**Expected safe behavior**

- A market has one authoritative resolution timestamp and timezone.
- Outcome submission and oracle resolution are rejected before that timestamp.
- Grace periods, non-response behavior, and expiry behavior are explicit and deterministic.
- UI and bot copy display the same rule.

**Implementation approach**

1. Define `funding_deadline`, `observation_time`, `outcome_window_end`, and optional `appeal_window_end`.
2. Validate timestamps server-side.
3. Gate every outcome/oracle/timeout entry point using database time.
4. Define what happens when one or both participants do not submit.
5. Remove or implement `TIMEOUT_48H`; do not retain contradictory behavior.

**Tests required**

- Outcome one second before, at, and after observation time.
- Clock skew between client and server.
- Both, one, or neither participant responds.
- Deadline worker retries and duplicate delivery.
- Daylight-saving and timezone display cases.

**Completion criteria**

- No execution path resolves a market before its canonical observation time.
- All clients show consistent timestamps and rules.
- Deadline behavior is documented and covered by boundary tests.

**Blocks mainnet:** Yes.

## 7. Replace live-price shortcuts with historical, reproducible oracle data

**Problem**

Crypto disputes use the current CoinGecko spot price, not a price at the market’s observation timestamp. This can reverse the intended outcome.

**Affected files**

- `src/engine.js`
- `src/assistant.js`
- market schema in `src/db.js`
- new oracle provider adapters and evidence storage

**Expected safe behavior**

- Price markets resolve from timestamped data matching the canonical observation rule.
- The same market and evidence snapshot reproduce the same result.
- Missing or disputed data fails closed to manual review or refund.

**Implementation approach**

1. Restrict automated price markets to structured asset, quote currency, comparator, threshold, observation timestamp, averaging window, and provider policy.
2. Use a historical price/candle API or an on-chain oracle suitable for the interval.
3. Persist raw signed/provider responses, retrieval time, data timestamp, and normalization result.
4. Apply deterministic comparison code outside the language model.
5. Require provider agreement or a documented fallback for high-value markets.

**Tests required**

- Price crossing the threshold shortly before and after the deadline.
- Exact equality and rounding behavior.
- Stale, missing, conflicting, or malformed provider data.
- Historical timestamp outside provider coverage.
- Replaying stored evidence produces the same verdict.

**Completion criteria**

- No financial decision uses request-time spot price for a historical market.
- Resolution is reproducible from stored evidence.
- Unsupported markets cannot reach automatic payout.

**Blocks mainnet:** Yes.

## 8. Validate AI verdicts and evidence strictly

**Problem**

AI output is parsed as generic JSON. `winner_side` is not a strict enum, confidence is self-reported, and search content lacks reliable structured provenance.

**Affected files**

- `src/engine.js`
- `src/judge.js`
- `src/hunter.js`
- `src/oracle.js`
- new verdict/evidence schema modules

**Expected safe behavior**

- Invalid, incomplete, unsupported, or contradictory AI output cannot trigger payment.
- Automatic settlement requires structured, timestamped, allowlisted evidence and deterministic policy checks.
- Untrusted web content cannot redefine system instructions.

**Implementation approach**

1. Validate model output using a strict schema:
   `winner_side` must be `creator`, `opponent`, or `unknown`; confidence is bounded; required evidence fields are enforced.
2. Treat any parse/schema failure as `unknown`.
3. Preserve source URL, publisher, publication time, retrieval time, relevant excerpt hash, and provider response.
4. Separate evidence retrieval from decision prompts and label all retrieved content as untrusted data.
5. Use deterministic resolvers for structured market types.
6. Require source allowlists, source independence, temporal relevance, and minimum evidence counts before auto-settlement.
7. Store the model, prompt version, tool calls, evidence bundle, policy result, and verdict.
8. Add manual review/appeal thresholds based on stake and market type.

**Tests required**

- Invalid enum, missing field, NaN/out-of-range confidence, and extra malicious fields.
- Prompt injection embedded in retrieved content.
- Fabricated or duplicate sources.
- Sources published outside the allowed time window.
- Model disagreement with deterministic resolver.
- Model/provider outage and malformed JSON.

**Completion criteria**

- Fuzzed or malicious model output cannot reach settlement.
- Every automatic verdict has a reproducible evidence bundle and policy decision.
- Unsupported or uncertain cases fail closed.

**Blocks mainnet:** Yes.

## 9. Replace or tightly isolate pooled hot-wallet custody

**Problem**

One mnemonic-controlled wallet receives deposits and sends all payouts, refunds, fees, and rewards. There is no on-chain per-bet escrow or enforced reserve separation.

**Affected files**

- `src/ton.js`
- environment and deployment configuration
- settlement worker
- future TON smart contracts
- operational security and treasury documentation

**Expected safe behavior**

- A web/API compromise cannot directly drain all user funds.
- Funds are constrained to authorized bet settlement or refund rules.
- Operator and fee funds are separated from customer liabilities.
- Keys can be rotated and incidents contained.

**Implementation approach**

Preferred:

1. Design per-bet or pooled smart-contract escrow with explicit participant, amount, deadline, resolver, payout, and refund constraints.
2. Obtain independent smart-contract review and staged testnet validation.
3. Use multisig or bounded authorization for exceptional administration.

Interim closed pilot only:

1. Put signing in an isolated service with no public ingress.
2. Use a dedicated custody wallet separate from fees and operations.
3. Apply stake/liability caps, withdrawal allowlists, multisig approval thresholds, and rate limits.
4. Reconcile balances continuously and halt new deposits on invariant failure.
5. Document secure key generation, backup, rotation, revocation, and incident response.

**Tests required**

- Unauthorized signing requests.
- Compromised API attempting arbitrary destination/amount.
- Key rotation and recovery exercise.
- Reserve shortfall kill switch.
- Contract authorization, replay, timeout, refund, and upgrade/admin-path tests.
- Independent contract security review before public deployment.

**Completion criteria**

- Public mainnet funds are protected by audited escrow constraints, or an explicitly approved limited pilot architecture with independent security/legal review.
- Signing credentials are absent from the general-purpose web process.
- Treasury and customer liabilities are separated and continuously reconciled.

**Blocks mainnet:** Yes.

## Required delivery order

1. Transactional market and financial ledger.
2. Unique deposit binding.
3. Durable transfer intents and idempotent signing.
4. Atomic settlement and voting.
5. Resumable refunds.
6. Authoritative deadlines.
7. Historical/reproducible oracle data.
8. Strict AI verdict and evidence validation.
9. Audited escrow or tightly isolated interim custody.

Mainnet remains blocked until every task is complete and the minimum acceptance criteria in `AUDIT.md` are independently verified.
