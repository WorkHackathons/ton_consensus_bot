/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { TonWalletKit as TonWalletKitType, WalletAdapter, WalletSigner } from '@ton/walletkit';
import type { IContactResolver } from '../types/contacts.js';
import { McpWalletService } from '../services/McpWalletService.js';
import type { StandardWalletVersion, StoredWallet, TonNetwork } from '../registry/config.js';
export interface WalletServiceContext {
    service: McpWalletService;
    close: () => Promise<void>;
}
export declare function createStandardAdapter(input: {
    network: TonNetwork;
    walletVersion: StandardWalletVersion;
    signer: WalletSigner;
    kit: TonWalletKitType;
}): Promise<WalletAdapter>;
export declare function createMcpWalletServiceFromStoredWallet(input: {
    wallet: StoredWallet;
    contacts?: IContactResolver;
    toncenterApiKey?: string;
    requiresSigning?: boolean;
}): Promise<WalletServiceContext>;
export declare function deriveStandardWalletAddress(input: {
    mnemonic?: string;
    privateKey?: string;
    network: TonNetwork;
    walletVersion: StandardWalletVersion;
    toncenterApiKey?: string;
}): Promise<string>;
//# sourceMappingURL=wallet-runtime.d.ts.map