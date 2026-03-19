/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
/**
 * TON MCP Server - Model Context Protocol server for TON blockchain wallet operations
 *
 * This module provides:
 * - Factory function for creating single-wallet MCP servers
 * - McpWalletService for wallet operations
 * - Serverless handler for serverless deployments
 */
export { createTonWalletMCP, createShutdownHandler } from './factory.js';
export { createServerlessHandler, handler } from './serverless.js';
export type { ServerlessRequest, ServerlessResponse } from './serverless.js';
export type { IContactResolver, Contact, TonMcpConfig, NetworkConfig } from './types/index.js';
export { McpWalletService } from './services/McpWalletService.js';
export { WalletRegistryService } from './services/WalletRegistryService.js';
export { AgenticSetupSessionManager } from './services/AgenticSetupSessionManager.js';
export { AgenticOnboardingService } from './services/AgenticOnboardingService.js';
export type { StartAgenticKeyRotationResult, CompleteAgenticKeyRotationResult, } from './services/WalletRegistryService.js';
export type { McpWalletServiceConfig, JettonInfoResult, JettonMetadataResult, AddressBalanceResult, TransferResult, DeployAgenticSubwalletResult, SwapQuoteResult, TransactionInfo, } from './services/McpWalletService.js';
export type { TonNetwork, StandardWalletVersion, ConfigNetwork, StoredStandardWallet, StoredAgenticWallet, StoredWallet, PendingAgenticDeployment, PendingAgenticKeyRotation, TonConfig, } from './registry/config.js';
export type { AgenticDeployCallbackPayload, AgenticSetupSession, AgenticSetupStatus, } from './services/AgenticSetupSessionManager.js';
export { AgenticWalletAdapter } from './contracts/agentic_wallet/AgenticWalletAdapter.js';
//# sourceMappingURL=index.d.ts.map