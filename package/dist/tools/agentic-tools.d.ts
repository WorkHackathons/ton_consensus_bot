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
export declare const deployAgenticSubwalletSchema: z.ZodObject<{
    operatorPublicKey: z.ZodString;
    metadata: z.ZodObject<{
        name: z.ZodString;
    }, "strip", z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.objectOutputType<{
        name: z.ZodString;
    }, z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "strip">, z.objectInputType<{
        name: z.ZodString;
    }, z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "strip">>;
    amountTon: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    operatorPublicKey: string;
    metadata: {
        name: string;
    } & {
        [k: string]: string | number | boolean;
    };
    amountTon?: string | undefined;
}, {
    operatorPublicKey: string;
    metadata: {
        name: string;
    } & {
        [k: string]: string | number | boolean;
    };
    amountTon?: string | undefined;
}>;
export declare function createMcpAgenticTools(service: McpWalletService): {
    deploy_agentic_subwallet: {
        description: string;
        inputSchema: z.ZodObject<{
            operatorPublicKey: z.ZodString;
            metadata: z.ZodObject<{
                name: z.ZodString;
            }, "strip", z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.objectOutputType<{
                name: z.ZodString;
            }, z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "strip">, z.objectInputType<{
                name: z.ZodString;
            }, z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "strip">>;
            amountTon: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            operatorPublicKey: string;
            metadata: {
                name: string;
            } & {
                [k: string]: string | number | boolean;
            };
            amountTon?: string | undefined;
        }, {
            operatorPublicKey: string;
            metadata: {
                name: string;
            } & {
                [k: string]: string | number | boolean;
            };
            amountTon?: string | undefined;
        }>;
        handler: (args: z.infer<typeof deployAgenticSubwalletSchema>) => Promise<ToolResponse>;
    };
};
//# sourceMappingURL=agentic-tools.d.ts.map