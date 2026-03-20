/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { z } from 'zod';
import type { McpWalletService } from '../services/McpWalletService.js';
import type { ToolResponse } from './types.js';
export declare const getWalletSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
export declare const getBalanceSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
export declare const getJettonBalanceSchema: z.ZodObject<{
    jettonAddress: z.ZodString;
}, "strip", z.ZodTypeAny, {
    jettonAddress: string;
}, {
    jettonAddress: string;
}>;
export declare const getJettonsSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
export declare const getTransactionsSchema: z.ZodObject<{
    limit: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit?: number | undefined;
}, {
    limit?: number | undefined;
}>;
export declare function createMcpBalanceTools(service: McpWalletService): {
    get_wallet: {
        description: string;
        inputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
        handler: () => Promise<ToolResponse>;
    };
    get_balance: {
        description: string;
        inputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
        handler: () => Promise<ToolResponse>;
    };
    get_jetton_balance: {
        description: string;
        inputSchema: z.ZodObject<{
            jettonAddress: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            jettonAddress: string;
        }, {
            jettonAddress: string;
        }>;
        handler: (args: z.infer<typeof getJettonBalanceSchema>) => Promise<ToolResponse>;
    };
    get_jettons: {
        description: string;
        inputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
        handler: () => Promise<ToolResponse>;
    };
    get_transactions: {
        description: string;
        inputSchema: z.ZodObject<{
            limit: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            limit?: number | undefined;
        }, {
            limit?: number | undefined;
        }>;
        handler: (args: z.infer<typeof getTransactionsSchema>) => Promise<ToolResponse>;
    };
};
//# sourceMappingURL=balance-tools.d.ts.map