/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { z } from 'zod';
import type { ToolResponse } from './types.js';
export declare const getKnownJettonsSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
export declare const KNOWN_JETTONS: readonly [{
    readonly symbol: "USD₮";
    readonly name: "Tether USD";
    readonly address: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
    readonly decimals: 6;
}, {
    readonly symbol: "NOT";
    readonly name: "Notcoin";
    readonly address: "EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT";
    readonly decimals: 9;
}, {
    readonly symbol: "DOGS";
    readonly name: "Dogs";
    readonly address: "EQCvxJy4eG8hyHBFsZ7eePxrRsUQSFE_jpptRAYBmcG_DOGS";
    readonly decimals: 9;
}, {
    readonly symbol: "DUST";
    readonly name: "DeDust";
    readonly address: "EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE";
    readonly decimals: 9;
}, {
    readonly symbol: "GRAM";
    readonly name: "Gram";
    readonly address: "EQC47093oX5Xhb0xuk2lCr2RhS8rj-vul61u4W2UH5ORmG_O";
    readonly decimals: 9;
}];
export declare function createMcpKnownJettonsTools(): {
    get_known_jettons: {
        description: string;
        inputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
        handler: () => Promise<ToolResponse>;
    };
};
//# sourceMappingURL=known-jettons-tools.d.ts.map