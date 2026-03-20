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
export declare const getBalanceByAddressSchema: z.ZodObject<{
    address: z.ZodString;
}, "strip", z.ZodTypeAny, {
    address: string;
}, {
    address: string;
}>;
export declare const getJettonsByAddressSchema: z.ZodObject<{
    address: z.ZodString;
    limit: z.ZodOptional<z.ZodNumber>;
    offset: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    address: string;
    limit?: number | undefined;
    offset?: number | undefined;
}, {
    address: string;
    limit?: number | undefined;
    offset?: number | undefined;
}>;
export declare const getNftsByAddressSchema: z.ZodObject<{
    address: z.ZodString;
    limit: z.ZodOptional<z.ZodNumber>;
    offset: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    address: string;
    limit?: number | undefined;
    offset?: number | undefined;
}, {
    address: string;
    limit?: number | undefined;
    offset?: number | undefined;
}>;
export declare const getJettonInfoSchema: z.ZodObject<{
    address: z.ZodString;
}, "strip", z.ZodTypeAny, {
    address: string;
}, {
    address: string;
}>;
export declare const getJettonWalletAddressSchema: z.ZodObject<{
    jettonAddress: z.ZodString;
    ownerAddress: z.ZodString;
}, "strip", z.ZodTypeAny, {
    ownerAddress: string;
    jettonAddress: string;
}, {
    ownerAddress: string;
    jettonAddress: string;
}>;
export declare function createMcpAddressTools(service: McpWalletService): {
    get_balance_by_address: {
        description: string;
        inputSchema: z.ZodObject<{
            address: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            address: string;
        }, {
            address: string;
        }>;
        handler: (args: z.infer<typeof getBalanceByAddressSchema>) => Promise<ToolResponse>;
    };
    get_jettons_by_address: {
        description: string;
        inputSchema: z.ZodObject<{
            address: z.ZodString;
            limit: z.ZodOptional<z.ZodNumber>;
            offset: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            address: string;
            limit?: number | undefined;
            offset?: number | undefined;
        }, {
            address: string;
            limit?: number | undefined;
            offset?: number | undefined;
        }>;
        handler: (args: z.infer<typeof getJettonsByAddressSchema>) => Promise<ToolResponse>;
    };
    get_nfts_by_address: {
        description: string;
        inputSchema: z.ZodObject<{
            address: z.ZodString;
            limit: z.ZodOptional<z.ZodNumber>;
            offset: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            address: string;
            limit?: number | undefined;
            offset?: number | undefined;
        }, {
            address: string;
            limit?: number | undefined;
            offset?: number | undefined;
        }>;
        handler: (args: z.infer<typeof getNftsByAddressSchema>) => Promise<ToolResponse>;
    };
    get_jetton_info: {
        description: string;
        inputSchema: z.ZodObject<{
            address: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            address: string;
        }, {
            address: string;
        }>;
        handler: (args: z.infer<typeof getJettonInfoSchema>) => Promise<ToolResponse>;
    };
};
//# sourceMappingURL=address-tools.d.ts.map