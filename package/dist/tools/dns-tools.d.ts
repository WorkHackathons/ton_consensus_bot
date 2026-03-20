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
export declare const resolveDnsSchema: z.ZodObject<{
    domain: z.ZodString;
}, "strip", z.ZodTypeAny, {
    domain: string;
}, {
    domain: string;
}>;
export declare const backResolveDnsSchema: z.ZodObject<{
    address: z.ZodString;
}, "strip", z.ZodTypeAny, {
    address: string;
}, {
    address: string;
}>;
export declare function createMcpDnsTools(service: McpWalletService): {
    resolve_dns: {
        description: string;
        inputSchema: z.ZodObject<{
            domain: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            domain: string;
        }, {
            domain: string;
        }>;
        handler: (args: z.infer<typeof resolveDnsSchema>) => Promise<ToolResponse>;
    };
    back_resolve_dns: {
        description: string;
        inputSchema: z.ZodObject<{
            address: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            address: string;
        }, {
            address: string;
        }>;
        handler: (args: z.infer<typeof backResolveDnsSchema>) => Promise<ToolResponse>;
    };
};
//# sourceMappingURL=dns-tools.d.ts.map