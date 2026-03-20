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
export declare const sendTonSchema: z.ZodObject<{
    toAddress: z.ZodString;
    amount: z.ZodString;
    comment: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    toAddress: string;
    amount: string;
    comment?: string | undefined;
}, {
    toAddress: string;
    amount: string;
    comment?: string | undefined;
}>;
export declare const sendJettonSchema: z.ZodObject<{
    toAddress: z.ZodString;
    jettonAddress: z.ZodString;
    amount: z.ZodString;
    comment: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    jettonAddress: string;
    toAddress: string;
    amount: string;
    comment?: string | undefined;
}, {
    jettonAddress: string;
    toAddress: string;
    amount: string;
    comment?: string | undefined;
}>;
export declare const sendRawTransactionSchema: z.ZodObject<{
    messages: z.ZodArray<z.ZodObject<{
        address: z.ZodString;
        amount: z.ZodString;
        stateInit: z.ZodOptional<z.ZodString>;
        payload: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        amount: string;
        payload?: string | undefined;
        stateInit?: string | undefined;
    }, {
        address: string;
        amount: string;
        payload?: string | undefined;
        stateInit?: string | undefined;
    }>, "many">;
    validUntil: z.ZodOptional<z.ZodNumber>;
    fromAddress: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    messages: {
        address: string;
        amount: string;
        payload?: string | undefined;
        stateInit?: string | undefined;
    }[];
    validUntil?: number | undefined;
    fromAddress?: string | undefined;
}, {
    messages: {
        address: string;
        amount: string;
        payload?: string | undefined;
        stateInit?: string | undefined;
    }[];
    validUntil?: number | undefined;
    fromAddress?: string | undefined;
}>;
export declare function createMcpTransferTools(service: McpWalletService): {
    send_ton: {
        description: string;
        inputSchema: z.ZodObject<{
            toAddress: z.ZodString;
            amount: z.ZodString;
            comment: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            toAddress: string;
            amount: string;
            comment?: string | undefined;
        }, {
            toAddress: string;
            amount: string;
            comment?: string | undefined;
        }>;
        handler: (args: z.infer<typeof sendTonSchema>) => Promise<ToolResponse>;
    };
    send_jetton: {
        description: string;
        inputSchema: z.ZodObject<{
            toAddress: z.ZodString;
            jettonAddress: z.ZodString;
            amount: z.ZodString;
            comment: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            jettonAddress: string;
            toAddress: string;
            amount: string;
            comment?: string | undefined;
        }, {
            jettonAddress: string;
            toAddress: string;
            amount: string;
            comment?: string | undefined;
        }>;
        handler: (args: z.infer<typeof sendJettonSchema>) => Promise<ToolResponse>;
    };
    send_raw_transaction: {
        description: string;
        inputSchema: z.ZodObject<{
            messages: z.ZodArray<z.ZodObject<{
                address: z.ZodString;
                amount: z.ZodString;
                stateInit: z.ZodOptional<z.ZodString>;
                payload: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                address: string;
                amount: string;
                payload?: string | undefined;
                stateInit?: string | undefined;
            }, {
                address: string;
                amount: string;
                payload?: string | undefined;
                stateInit?: string | undefined;
            }>, "many">;
            validUntil: z.ZodOptional<z.ZodNumber>;
            fromAddress: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            messages: {
                address: string;
                amount: string;
                payload?: string | undefined;
                stateInit?: string | undefined;
            }[];
            validUntil?: number | undefined;
            fromAddress?: string | undefined;
        }, {
            messages: {
                address: string;
                amount: string;
                payload?: string | undefined;
                stateInit?: string | undefined;
            }[];
            validUntil?: number | undefined;
            fromAddress?: string | undefined;
        }>;
        handler: (args: z.infer<typeof sendRawTransactionSchema>) => Promise<ToolResponse>;
    };
};
//# sourceMappingURL=transfer-tools.d.ts.map