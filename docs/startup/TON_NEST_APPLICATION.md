# TON Nest Application — Truthful Copy-Paste Draft

This draft intentionally describes TON Consensus as a working centralized testnet MVP. It does not claim users, revenue, partnerships, grants, or production readiness.

## Project name

TON Consensus

## One-line description

TON Consensus is a Telegram-native two-party challenge and dispute-resolution MVP where users define a factual claim, fund both sides with testnet TON, and resolve the result through an AI evidence workflow with human-arbiter fallback.

## Short project summary

TON Consensus turns informal Telegram challenges into a structured flow: create a factual claim, invite an opponent, connect TON wallets, fund both sides, submit outcomes, and resolve disagreement through an AI oracle or assigned community arbiters.

The current product is a working centralized testnet MVP. The Telegram bot, Mini App, off-chain database, AI workflow, and platform-controlled testnet wallet operate together. It is not ready for public mainnet funds. Custody and settlement are currently centralized, and the team has identified security and architecture work that must be completed before any public mainnet launch.

## What problem are you solving?

Two people can make a bet or outcome-based agreement in Telegram, but settlement usually depends on screenshots, trust, or a human group administrator. There is rarely a shared, structured definition of the claim, a transparent funding flow, or a repeatable process for resolving disagreement.

TON Consensus explores a Telegram-native workflow for turning a factual two-party challenge into a defined market with visible funding, evidence-based resolution, and TON settlement.

## What is your solution?

The product combines:

- a Telegram bot for onboarding, invitations, notifications, and arbiter voting;
- a Telegram Mini App for creating and joining challenges, connecting a TON wallet, and following market status;
- testnet TON deposit verification and centralized payout/refund execution;
- an AI evidence workflow for factual disputes;
- assigned human arbiters when automated evidence is insufficient.

The intended long-term direction is auditable escrow and settlement with stronger on-chain constraints. The current MVP uses an off-chain database and a platform-controlled testnet wallet.

## What works today?

The current repository implements:

- Telegram bot onboarding and deep-link invitations;
- a React/Vite Telegram Mini App;
- TON Connect wallet linking;
- creation and joining of two-party factual challenges;
- custom market deadlines;
- testnet deposit lookup and confirmation;
- participant outcome submission;
- AI-first dispute processing using web search and crypto-price tools;
- human-arbiter fallback and vote collection;
- testnet payout and refund flows from a platform wallet;
- Telegram settlement notifications and transaction links;
- referral and arbiter statistics;
- smoke tests for core Mini App rendering and interaction;
- runtime self-test and developer-notification code.

These features demonstrate an end-to-end centralized testnet MVP. They do not prove production safety or public mainnet readiness.

## What are the current limitations?

- Funds are pooled in a platform-controlled testnet hot wallet rather than an audited escrow contract.
- Market and financial state are stored off-chain in a `sql.js`/SQLite-style database.
- Deposit matching is not yet uniquely bound to one bet and one participant, so transaction replay must be fixed.
- Payout and refund operations need durable idempotency and reconciliation.
- Deadline enforcement and historical price resolution need correction.
- AI verdicts and evidence require stricter deterministic validation.
- The current public data model exposes identifiers that should be redacted.
- There is no production-grade queue, transactional settlement worker, CI security pipeline, formal incident process, or mainnet treasury control system.
- Legal and regulatory requirements for public wagering or prediction-market activity have not been completed.
- The project has not claimed validated traction, revenue, partnerships, grants, or production users.

## Is the product live?

The codebase represents a working testnet MVP and includes links for a Telegram bot and web surfaces. We do not describe it as a public mainnet product. It should be treated as a hackathon/testnet prototype until the documented P0 security and custody issues are resolved.

## Is it ready for mainnet?

No.

The project should not accept public mainnet funds today. Before mainnet, it needs unique deposit binding, an immutable financial ledger, idempotent transfer processing, atomic settlement, correct deadline and historical-data handling, strict oracle validation, privacy controls, treasury reconciliation, legal review, and audited escrow or an independently reviewed limited-custody architecture.

## How does the project use TON?

Today, TON is used for:

- TON Connect wallet linking;
- testnet stake deposits;
- on-chain transaction lookup for deposit confirmation;
- centralized testnet payouts and refunds;
- platform-fee, referral, and arbiter-reward experiments;
- transaction visibility through a block explorer.

Planned TON work includes audited escrow contracts that constrain deposits, settlement, and refunds; separation of custody and operator authority; and more auditable oracle-to-settlement integration.

## Why build this inside Telegram?

The interaction starts where informal challenges already happen. Telegram provides identity, sharing, deep links, notifications, and a Mini App surface without requiring users to install a separate application. TON provides a native settlement rail that can remain inside the same user journey.

## What is technically differentiated?

The MVP connects the full Telegram flow rather than presenting a standalone oracle demo:

1. create a challenge in the Mini App;
2. invite a specific opponent through Telegram;
3. connect wallets and fund both sides;
4. collect participant outcomes;
5. search for external evidence when outcomes conflict;
6. escalate uncertain disputes to assigned arbiters;
7. execute and display a testnet settlement.

The differentiation is the combined Telegram distribution, TON settlement experiment, AI evidence workflow, and human fallback. The current implementation is centralized and should be evaluated as an MVP, not as a finished decentralized protocol.

## Current architecture

- Node.js, Express, and Telegraf backend.
- React and Vite Telegram Mini App.
- `sql.js`/SQLite-style off-chain persistence.
- OpenAI-assisted decision workflow.
- Tavily search and CoinGecko price lookup.
- TON Connect and TON SDK integration.
- Platform-controlled testnet wallet for transfers.

## Planned architecture

The next architecture should include:

- a durable transactional database;
- an immutable financial ledger;
- unique on-chain deposit references;
- a durable job queue and isolated settlement worker;
- idempotent transfer intents and wallet reconciliation;
- structured, timestamped oracle evidence;
- redacted public read models;
- audited TON escrow contracts or a tightly controlled limited pilot before broader mainnet use.

## Project stage

Working centralized testnet MVP / hackathon prototype.

The project has an end-to-end implementation, but its next milestone is not public growth. The next milestone is making deposits, liabilities, resolution, and settlement safe and auditable.

## Traction

We are not claiming verified production users, revenue, transaction volume, partnerships, grants, or institutional adoption in this application.

The repository and testnet MVP demonstrate product execution. User validation and traction measurement still need to be performed through a controlled pilot after the P0 safety work.

## Business model

The current hypothesis is a platform fee on successfully settled challenges, with a portion available for arbiter incentives and referral experiments.

This is not validated revenue. Pricing, legal feasibility, abuse costs, oracle costs, support costs, and willingness to pay still require testing. The project should not expand monetization until custody and settlement are safe.

## Target users

Initial target users are small Telegram communities and pairs of users making objective, verifiable challenges. Early market types should be restricted to structured factual outcomes such as:

- an asset price at a defined timestamp;
- a sports result from an approved official source;
- whether a release or public event occurred by a defined time;
- another binary statement with an explicit authoritative source.

Subjective claims and open public prediction markets should not be part of the first mainnet pilot.

## Roadmap

### Immediate

- Fix deposit transaction replay.
- Build a durable financial ledger.
- Add idempotent payout and refund processing.
- Make market settlement atomic.
- Correct deadline enforcement and historical price resolution.
- Validate AI verdicts and evidence strictly.
- Redact participant and arbiter identifiers.

### Next

- Introduce a durable database, queue, settlement worker, reconciliation, monitoring, and CI security checks.
- Run a controlled testnet pilot with measurable reliability metrics.
- Define legal, privacy, treasury, key-management, incident, and refund policies.

### Before public mainnet funds

- Complete independent security review.
- Introduce audited TON escrow or an independently reviewed, tightly capped custody pilot.
- Apply stake and total-liability caps.
- Establish appeals/manual-review rules and operational ownership.

### Longer term

- Auditable on-chain escrow and settlement constraints.
- Structured market templates and oracle adapters.
- Arbiter reputation and accountability.
- SDK or B2B dispute-resolution integrations, only after the core system is safe.

## What support do you need from TON Nest?

We would value:

- technical mentorship on TON escrow-contract architecture;
- review of deposit-reference, settlement, and refund design;
- guidance on wallet custody, multisig, key isolation, and treasury controls;
- introductions to experienced TON smart-contract security reviewers;
- product mentorship for narrowing the first safe market category;
- legal/regulatory orientation for a Telegram-native challenge product;
- support designing a controlled testnet pilot and defining credible success metrics;
- ecosystem feedback on how to integrate oracle evidence with TON settlement transparently.

We are not asking TON Nest to validate the current MVP as mainnet-safe. We are asking for support turning a working centralized testnet prototype into a safer, auditable system.

## Why TON Nest?

The project’s hardest next problems are TON-specific: escrow design, transaction identity, wallet security, settlement authorization, and operational readiness. TON Nest can provide technical and ecosystem feedback before the team makes irreversible mainnet architecture decisions.

The program would also help the team test whether the narrow Telegram-native dispute-resolution use case has real demand before expanding into broader prediction-market features.

## What would success in the program look like?

Success would mean:

- all P0 financial safety issues are closed;
- every deposit and outgoing transfer is uniquely traceable;
- reserves reconcile with liabilities;
- oracle decisions are timestamped, reproducible, and fail closed;
- a reviewed escrow architecture is ready or implemented on testnet;
- a controlled pilot produces honest reliability and user-behavior metrics;
- the team has a documented go/no-go checklist for any mainnet pilot.

## Team

The repository lists the following project contributors:

- `@luzzw22`
- `@znkkka1`
- `@Alibek62`

This draft does not assign roles, employment history, or credentials that are not documented.

## Public links

- Repository: `https://github.com/WorkHackathons/ton_consensus_bot`
- Telegram bot: `https://t.me/ton_consensus_bot`
- Telegram channel: `https://t.me/consensuston`
- Landing page listed in the repository: `https://tonconsensus.netlify.app/`

These links show the project surfaces; they should not be interpreted as evidence of public mainnet readiness or verified traction.
