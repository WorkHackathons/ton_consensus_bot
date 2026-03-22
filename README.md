# TON Consensus

<div align="center">

### Telegram-native dispute resolution on TON. Two users make a claim, AI verifies the truth, TON settles the payout.

[![TON](https://img.shields.io/badge/TON-Testnet-0098EA?style=for-the-badge)](https://ton.org/)
[![Telegram](https://img.shields.io/badge/Telegram-Mini%20App-26A5E4?style=for-the-badge)](https://core.telegram.org/bots/webapps)
[![AI Oracle](https://img.shields.io/badge/AI-Oracle-111111?style=for-the-badge)](https://openai.com/)
[![Status](https://img.shields.io/badge/Status-Hackathon%20MVP-0A7B34?style=for-the-badge)](https://github.com/WorkHackathons/ton_consensus_bot)

[Bot](https://t.me/ton_consensus_bot) | [Channel](https://t.me/consensuston) | [Landing](https://ton-consensus.vercel.app/) | [Landing Mirror](https://tonconsensus.netlify.app/) | [GitHub](https://github.com/WorkHackathons/ton_consensus_bot)

</div>

---

> TON Consensus turns informal Telegram bets into a structured, trust-minimized flow.

Two people stake TON on a claim. They submit their outcomes inside a Telegram Mini App. If both sides disagree, an AI Oracle searches for evidence, calculates confidence, and resolves the dispute automatically when the result is clear. If confidence is too low, the market falls back to anonymous community arbiters.

This is not just a chatbot and not just a wallet UI. It is a full Telegram-native product that combines social distribution, AI agents, TON settlement, community arbitration, and on-chain payout transparency.

## Why It Matters

<table>
<tr>
<td valign="top" width="50%">

Most Telegram bets still rely on:

- trust
- screenshots
- a human admin
- arguments in chat

</td>
<td valign="top" width="50%">

TON Consensus replaces that with:

- structured bet creation
- wallet-connected TON deposits
- outcome submission inside the app
- AI-driven evidence analysis
- anonymous arbiter fallback
- on-chain settlement and payout visibility

</td>
</tr>
</table>

The result is a product where disputes can be resolved with less trust, less friction, and much stronger transparency.

## Product Flow

1. User A opens the bot and launches the Mini App.
2. User A creates a market with a claim, stake, and deadline.
3. User A shares the invite with User B inside Telegram.
4. User B opens the invite and joins the same market.
5. Both users connect TON wallets and fund their side.
6. After the deadline, both submit their outcome.
7. If outcomes match, the bet settles immediately.
8. If outcomes conflict, the AI Oracle starts automatically.
9. If confidence is high, the winner is paid automatically on TON.
10. If confidence is low, anonymous community arbiters vote.

## AI Oracle

The AI Oracle is the core of TON Consensus.

It is not a single text completion. It is a tool-driven resolution system that:
- reads the disputed claim
- understands the event and deadline
- searches the web for evidence
- queries crypto pricing when relevant
- evaluates source quality
- returns a structured verdict with confidence

The intended flow is:

```text
Conflict detected -> search_web() -> evidence analysis -> confidence score -> if confidence >= 85% -> auto payout -> else -> community vote
```

### What the AI actually does

1. Receives the disputed market.
2. Analyzes the claim type.
3. Builds search queries for relevant sources.
4. Calls Tavily web search when external evidence is needed.
5. Calls crypto pricing tools for price-based markets.
6. Compares evidence against the market deadline.
7. Produces:
   - winner side
   - confidence score
   - reasoning
   - supporting sources
8. If confidence is strong enough, resolves and triggers payout.
9. If not, escalates to anonymous human arbiters.

### Best-fit dispute categories

AI works best on:
- crypto price claims
- sports outcomes
- release / launch events
- factual news outcomes
- verifiable objective statements

Human arbiters are best for:
- ambiguous claims
- subjective disputes
- low-evidence outcomes
- unclear wording or unverifiable conditions

## Architecture

Text diagram:

```text
Telegram Bot -> Telegram Mini App -> API -> SQLite
Mini App -> TON Connect -> user wallet
API -> AI Oracle Engine
AI Oracle Engine -> Tavily + OpenAI + CoinGecko
API -> TON wallet layer -> on-chain payout / refund
Low confidence -> anonymous arbiters in Telegram
Final result -> Telegram notifications + Tonscan transaction link
```

## TON Integration

TON is part of the actual product logic, not just branding.

It is used for:
- TON Connect wallet linking
- deposit funding
- deposit verification
- payout execution
- automatic refunds
- platform fee routing
- arbiter rewards
- referral rewards
- transaction visibility through Tonscan

## Telegram-Native UX

TON Consensus is built to feel native inside Telegram:
- `/start` onboarding with video
- Mini App entry directly from the bot
- deep-link invite flow
- create / join / deposit / resolve inside the app
- Telegram notifications for dispute and payout events
- arbiter vote flow inside Telegram chat

## Demo Flow

Recommended two-account demo:

1. Open [@ton_consensus_bot](https://t.me/ton_consensus_bot).
2. Launch the Mini App.
3. Connect a TON wallet.
4. Create a factual market such as:
   `Will BTC trade above $80,000 by tomorrow 18:00 UTC?`
5. Share the invite to the second account.
6. Join from the second account and connect another wallet.
7. Verify deposits from both sides.
8. Submit conflicting outcomes.
9. Show AI Oracle mode.
10. Show:
    - automatic AI resolution when confidence is high
    - or anonymous arbiter fallback when confidence is low
11. Show payout with a Tonscan transaction link.

## What Is Live Today

Live now:
- Telegram bot onboarding
- Telegram Mini App
- create / join / share market flow
- TON wallet connection
- deposit verification
- deadline selection
- outcome submission
- AI-first dispute resolution
- anonymous arbiter fallback
- premium arbiters
- referral links
- payout success screen with tx hash
- self-test and runtime monitoring

## Roadmap

### v1 - Hackathon MVP (March 2026) [done]
- [x] P2P dispute creation with custom deadlines
- [x] TON Connect wallet integration
- [x] On-chain deposit verification
- [x] AI Auto-Arbiter with OpenAI + Tavily
- [x] Anonymous community oracle with 3 arbiters
- [x] Automatic TON payouts
- [x] Referral system with automatic rewards
- [x] Premium arbiter program for core operators
- [x] Telegram Mini App with end-to-end dispute flow
- [x] Self-test and runtime health monitoring

### v2 - Mainnet Launch (April-May 2026)
- [ ] Full TON mainnet deployment
- [ ] Arbiter reputation scoring and leaderboard
- [ ] Public open-bet marketplace with stronger privacy controls
- [ ] Group disputes with pooled outcomes
- [ ] TON DNS-based collateral experiments
- [ ] Soulbound winner trophies
- [ ] Mobile performance optimization
- [ ] Multi-language support (EN / RU / KZ)

### v3 - Monetization (Q3 2026)
- [ ] Premium arbiter tier with advanced analytics and priority access
- [ ] Jetton support (NOT, SCALE, STON, USDT)
- [ ] Auto-generated Telegram share cards for viral distribution
- [ ] Public prediction markets with multi-user participation
- [ ] Advanced `/mystats` with win rate, earnings history, and dispute history
- [ ] Arbiter accountability system with warnings and cooldowns

Potential monetization paths:
- premium arbiter subscriptions
- platform fees
- advanced dispute tooling for power users

### v4 - Protocol Layer (Q4 2026)
- [ ] On-chain smart contracts in Tact
- [ ] DAO-style governance for fee distribution
- [ ] TON Consensus SDK for third-party integrations
- [ ] Reputation token for arbiters and power users
- [ ] Cross-platform interfaces beyond Telegram
- [ ] B2B dispute resolution tooling

### Long-term Vision

TON Consensus is not just a betting bot.

It is a trust infrastructure layer for Telegram where any two parties can commit to an outcome, let AI verify the truth, and let TON enforce the result.

The endgame is simple:

informal agreements made in Telegram should be able to become machine-enforced consensus with transparent settlement.

## Economics

| Resolution Path | Winner | Arbiters | Platform |
| --- | --- | --- | --- |
| Human-arbiter resolution | 85% of pot | 5% of pot | 10% of pot |
| AI auto-resolution | 90% of pot | - | 10% of pot |

Referral model:
- Referrer earns 2% of the platform fee

## Tech Stack

| Layer | Technology |
| --- | --- |
| Distribution | Telegram Bot + Telegram Mini App |
| Frontend | React + Vite + Framer Motion |
| Backend | Node.js + Express + Telegraf v4 |
| Database | SQLite |
| AI | OpenAI function calling |
| Search | Tavily |
| Price Data | CoinGecko |
| TON | TON Connect + `@ton/mcp` + direct wallet fallback |

## Quick Start

```bash
npm install
cp .env.example .env

# Terminal 1
npx @ton/mcp@0.1.15-alpha.0 --http 3000

# Terminal 2
npm run dev
```

## Environment

See [`.env.example`](.env.example) for the full template.

Core variables:
- `TELEGRAM_TOKEN`
- `MNEMONIC`
- `NETWORK`
- `TON_WALLET_MODE`
- `WALLET_VERSION`
- `OPENAI_API_KEY`
- `TAVILY_API_KEY`
- `MINIAPP_URL`
- `PLATFORM_FEE_WALLET`

## Links

| Surface | URL |
| --- | --- |
| Bot | https://t.me/ton_consensus_bot |
| Channel | https://t.me/consensuston |
| Landing | https://ton-consensus.vercel.app/ |
| Landing Mirror | https://tonconsensus.netlify.app/ |
| GitHub | https://github.com/WorkHackathons/ton_consensus_bot |

## Team

Built for TON AI Agent Hackathon 2026.

- @luzzw22
- @znkkka1
- @Alibek62
