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
export declare const getTransactionStatusSchema: z.ZodObject<{
    normalizedHash: z.ZodString;
}, "strip", z.ZodTypeAny, {
    normalizedHash: string;
}, {
    normalizedHash: string;
}>;
export declare function createMcpTransactionTools(service: McpWalletService): {
    get_transaction_status: {
        description: string;
        inputSchema: z.ZodObject<{
            normalizedHash: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            normalizedHash: string;
        }, {
            normalizedHash: string;
        }>;
        handler: (args: z.infer<typeof getTransactionStatusSchema>) => Promise<ToolResponse>;
    };
};
//# sourceMappingURL=transaction-tools.d.ts.map