/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
/**
 * Factory function for creating configured MCP server instances
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WalletAdapter } from '@ton/walletkit';
import type { IContactResolver } from './types/contacts.js';
import type { NetworkConfig } from './services/McpWalletService.js';
import { McpWalletService } from './services/McpWalletService.js';
import { AgenticSetupSessionManager } from './services/AgenticSetupSessionManager.js';
export interface TonMcpFactoryConfig {
    /**
     * Optional fixed wallet for backward-compatible single-wallet mode.
     * If omitted, the server runs in config-backed registry mode.
     */
    wallet?: WalletAdapter;
    /**
     * Optional wallet version.
     * If omitted, the server uses the wallet version of the wallet.
     */
    walletVersion?: 'agentic' | 'v4r2' | 'v5r1';
    /**
     * Optional contact resolver for name-to-address resolution.
     */
    contacts?: IContactResolver;
    /**
     * Network-specific configuration (API keys).
     */
    networks?: {
        mainnet?: NetworkConfig;
        testnet?: NetworkConfig;
    };
    /**
     * Optional shared session manager for agentic onboarding callback handling.
     */
    agenticSessionManager?: AgenticSetupSessionManager;
}
export declare function createTonWalletMCP(config: TonMcpFactoryConfig): Promise<McpServer>;
export declare function createShutdownHandler(walletService: McpWalletService): () => Promise<void>;
//# sourceMappingURL=factory.d.ts.map