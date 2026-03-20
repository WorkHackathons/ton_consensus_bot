/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
export interface ToolResponse {
    [key: string]: unknown;
    content: Array<{
        type: 'text';
        text: string;
    }>;
    isError?: boolean;
}
/**
 * Converts a human-readable amount to raw units.
 */
export declare function toRawAmount(amount: string, decimals: number): string;
export declare const TON_DECIMALS = 9;
//# sourceMappingURL=types.d.ts.map