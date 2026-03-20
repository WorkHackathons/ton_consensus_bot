/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { z } from 'zod';
import type { AgenticOnboardingService } from '../services/AgenticOnboardingService.js';
import type { ToolResponse } from './types.js';
declare const startAgenticRootWalletSetupSchema: z.ZodObject<{
    network: z.ZodOptional<z.ZodEnum<["mainnet", "testnet"]>>;
    name: z.ZodOptional<z.ZodString>;
    source: z.ZodOptional<z.ZodString>;
    collectionAddress: z.ZodOptional<z.ZodString>;
    tonDeposit: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    network?: "mainnet" | "testnet" | undefined;
    source?: string | undefined;
    name?: string | undefined;
    collectionAddress?: string | undefined;
    tonDeposit?: string | undefined;
}, {
    network?: "mainnet" | "testnet" | undefined;
    source?: string | undefined;
    name?: string | undefined;
    collectionAddress?: string | undefined;
    tonDeposit?: string | undefined;
}>;
declare const setupIdSchema: z.ZodObject<{
    setupId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    setupId: string;
}, {
    setupId: string;
}>;
declare const completeAgenticRootWalletSetupSchema: z.ZodObject<{
    setupId: z.ZodString;
    walletAddress: z.ZodOptional<z.ZodString>;
    ownerAddress: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    setupId: string;
    ownerAddress?: string | undefined;
    walletAddress?: string | undefined;
}, {
    setupId: string;
    ownerAddress?: string | undefined;
    walletAddress?: string | undefined;
}>;
export declare function createMcpAgenticOnboardingTools(onboarding: AgenticOnboardingService): {
    start_agentic_root_wallet_setup: {
        description: string;
        inputSchema: z.ZodObject<{
            network: z.ZodOptional<z.ZodEnum<["mainnet", "testnet"]>>;
            name: z.ZodOptional<z.ZodString>;
            source: z.ZodOptional<z.ZodString>;
            collectionAddress: z.ZodOptional<z.ZodString>;
            tonDeposit: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            network?: "mainnet" | "testnet" | undefined;
            source?: string | undefined;
            name?: string | undefined;
            collectionAddress?: string | undefined;
            tonDeposit?: string | undefined;
        }, {
            network?: "mainnet" | "testnet" | undefined;
            source?: string | undefined;
            name?: string | undefined;
            collectionAddress?: string | undefined;
            tonDeposit?: string | undefined;
        }>;
        handler: (args: z.infer<typeof startAgenticRootWalletSetupSchema>) => Promise<ToolResponse>;
    };
    list_pending_agentic_root_wallet_setups: {
        description: string;
        inputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
        handler: () => Promise<ToolResponse>;
    };
    get_agentic_root_wallet_setup: {
        description: string;
        inputSchema: z.ZodObject<{
            setupId: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            setupId: string;
        }, {
            setupId: string;
        }>;
        handler: (args: z.infer<typeof setupIdSchema>) => Promise<ToolResponse>;
    };
    complete_agentic_root_wallet_setup: {
        description: string;
        inputSchema: z.ZodObject<{
            setupId: z.ZodString;
            walletAddress: z.ZodOptional<z.ZodString>;
            ownerAddress: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            setupId: string;
            ownerAddress?: string | undefined;
            walletAddress?: string | undefined;
        }, {
            setupId: string;
            ownerAddress?: string | undefined;
            walletAddress?: string | undefined;
        }>;
        handler: (args: z.infer<typeof completeAgenticRootWalletSetupSchema>) => Promise<ToolResponse>;
    };
    cancel_agentic_root_wallet_setup: {
        description: string;
        inputSchema: z.ZodObject<{
            setupId: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            setupId: string;
        }, {
            setupId: string;
        }>;
        handler: (args: z.infer<typeof setupIdSchema>) => Promise<ToolResponse>;
    };
};
export {};
//# sourceMappingURL=agentic-onboarding-tools.d.ts.map