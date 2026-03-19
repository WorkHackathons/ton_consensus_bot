/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
export interface ParsedPrivateKeyInput {
    normalizedHex: string;
    seed: Buffer;
    wasCombinedKeypair: boolean;
}
export declare function parsePrivateKeyInput(privateKey: string): ParsedPrivateKeyInput;
//# sourceMappingURL=private-key.d.ts.map