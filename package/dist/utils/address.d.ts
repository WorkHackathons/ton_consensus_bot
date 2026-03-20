/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { Address } from '@ton/core';
export type McpAddressNetwork = 'mainnet' | 'testnet';
export declare function formatWalletAddress(address: string | Address, network: McpAddressNetwork): string;
export declare function formatWalletAddressSafe(address: string | null | undefined, network: McpAddressNetwork): string | undefined;
export declare function formatAssetAddress(address: string | Address, network: McpAddressNetwork): string;
export declare function formatAssetAddressSafe(address: string | null | undefined, network: McpAddressNetwork): string | undefined;
export declare function normalizeAddressForComparison(address: string): string | null;
//# sourceMappingURL=address.d.ts.map