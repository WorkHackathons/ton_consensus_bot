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
export declare const getSwapQuoteSchema: z.ZodObject<{
    fromToken: z.ZodString;
    toToken: z.ZodString;
    amount: z.ZodString;
    slippageBps: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    fromToken: string;
    toToken: string;
    amount: string;
    slippageBps?: number | undefined;
}, {
    fromToken: string;
    toToken: string;
    amount: string;
    slippageBps?: number | undefined;
}>;
export declare function createMcpSwapTools(service: McpWalletService): {
    get_swap_quote: {
        description: string;
        inputSchema: z.ZodObject<{
            fromToken: z.ZodString;
            toToken: z.ZodString;
            amount: z.ZodString;
            slippageBps: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            fromToken: string;
            toToken: string;
            amount: string;
            slippageBps?: number | undefined;
        }, {
            fromToken: string;
            toToken: string;
            amount: string;
            slippageBps?: number | undefined;
        }>;
        handler: (args: z.infer<typeof getSwapQuoteSchema>) => Promise<ToolResponse>;
    };
};
//# sourceMappingURL=swap-tools.d.ts.map