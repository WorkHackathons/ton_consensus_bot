/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { Address, Cell } from '@ton/core';
import type { ApiClient, WalletAdapter, WalletSigner, Network, PreparedSignData, ProofMessage, TransactionRequest, UserFriendlyAddress, Hex, Base64String, Feature, WalletId } from '@ton/walletkit';
export declare const defaultAgenticWorkchain = 0;
export interface AgenticWalletAdapterConfig {
    signer: WalletSigner;
    publicKey: Hex;
    tonClient: ApiClient;
    network: Network;
    workchain?: number;
    walletAddress?: Address;
    walletNftIndex?: bigint;
    collectionAddress?: Address;
}
export declare class AgenticWalletAdapter implements WalletAdapter {
    private signer;
    private config;
    readonly client: ApiClient;
    readonly publicKey: Hex;
    readonly version = "agentic";
    readonly address: Address;
    private readonly walletInit?;
    private walletNftIndexCache?;
    static create(signer: WalletSigner, options: {
        client: ApiClient;
        network: Network;
        workchain?: number;
        walletAddress?: string | Address;
        walletNftIndex?: bigint;
        collectionAddress?: string | Address;
    }): Promise<AgenticWalletAdapter>;
    constructor(config: AgenticWalletAdapterConfig);
    getPublicKey(): Hex;
    getClient(): ApiClient;
    sign(bytes: Iterable<number>): Promise<Hex>;
    getNetwork(): Network;
    getAddress(options?: {
        testnet?: boolean;
    }): UserFriendlyAddress;
    getWalletId(): WalletId;
    getStateInit(): Promise<Base64String>;
    getSignedSendTransaction(input: TransactionRequest, options: {
        fakeSignature: boolean;
    }): Promise<Base64String>;
    getSeqno(): Promise<number>;
    getWalletNftIndex(): Promise<bigint>;
    private extractOutActions;
    createSignedBody(seqno: number, walletNftIndex: bigint, outActions: Cell | null, options: {
        validUntil: number | undefined;
        fakeSignature: boolean;
    }): Promise<Cell>;
    getSignedSignData(input: PreparedSignData): Promise<Hex>;
    getSignedTonProof(input: ProofMessage): Promise<Hex>;
    getSupportedFeatures(): Feature[] | undefined;
}
//# sourceMappingURL=AgenticWalletAdapter.d.ts.map