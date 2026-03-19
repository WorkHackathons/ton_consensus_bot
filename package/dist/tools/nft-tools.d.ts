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
export declare const getNftsSchema: z.ZodObject<{
    limit: z.ZodOptional<z.ZodNumber>;
    offset: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit?: number | undefined;
    offset?: number | undefined;
}, {
    limit?: number | undefined;
    offset?: number | undefined;
}>;
export declare const getNftSchema: z.ZodObject<{
    nftAddress: z.ZodString;
}, "strip", z.ZodTypeAny, {
    nftAddress: string;
}, {
    nftAddress: string;
}>;
export declare const sendNftSchema: z.ZodObject<{
    nftAddress: z.ZodString;
    toAddress: z.ZodString;
    comment: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    toAddress: string;
    nftAddress: string;
    comment?: string | undefined;
}, {
    toAddress: string;
    nftAddress: string;
    comment?: string | undefined;
}>;
export declare function createMcpNftTools(service: McpWalletService): {
    get_nfts: {
        description: string;
        inputSchema: z.ZodObject<{
            limit: z.ZodOptional<z.ZodNumber>;
            offset: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            limit?: number | undefined;
            offset?: number | undefined;
        }, {
            limit?: number | undefined;
            offset?: number | undefined;
        }>;
        handler: (args: z.infer<typeof getNftsSchema>) => Promise<ToolResponse>;
    };
    get_nft: {
        description: string;
        inputSchema: z.ZodObject<{
            nftAddress: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            nftAddress: string;
        }, {
            nftAddress: string;
        }>;
        handler: (args: z.infer<typeof getNftSchema>) => Promise<ToolResponse>;
    };
    send_nft: {
        description: string;
        inputSchema: z.ZodObject<{
            nftAddress: z.ZodString;
            toAddress: z.ZodString;
            comment: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            toAddress: string;
            nftAddress: string;
            comment?: string | undefined;
        }, {
            toAddress: string;
            nftAddress: string;
            comment?: string | undefined;
        }>;
        handler: (args: z.infer<typeof sendNftSchema>) => Promise<ToolResponse>;
    };
};
//# sourceMappingURL=nft-tools.d.ts.map