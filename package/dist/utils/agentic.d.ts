/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { ApiClient } from '@ton/walletkit';
import type { TonNetwork } from '../registry/config.js';
export interface AgenticImportCandidate {
    address: string;
    balanceNano: string;
    balanceTon: string;
    ownerAddress: string;
    operatorPublicKey?: string;
    originOperatorPublicKey?: string;
    collectionAddress: string;
    deployedByUser?: boolean;
    name?: string;
}
type AgenticWalletValidationErrorCode = 'inactive_contract' | 'wrong_contract_type' | 'uninitialized_agentic_wallet' | 'unsupported_agentic_wallet_layout';
export declare class AgenticWalletValidationError extends Error {
    readonly code: AgenticWalletValidationErrorCode;
    constructor(code: AgenticWalletValidationErrorCode, message: string);
}
export declare function generateOperatorKeyPair(): Promise<{
    privateKey: string;
    publicKey: string;
}>;
export declare function resolveOperatorCredentials(privateKey: string, expectedPublicKey?: string, deps?: {
    createSigner?: (seed: Uint8Array) => Promise<{
        publicKey: string;
    }>;
}): Promise<{
    privateKey: string;
    publicKey: string;
}>;
export declare function buildAgenticCreateDeepLink(input: {
    operatorPublicKey: string;
    callbackUrl: string;
    agentName?: string;
    source?: string;
    tonDeposit?: string;
}): string;
export declare function buildAgenticDashboardLink(address: string): string;
export declare function buildAgenticChangeKeyDeepLink(address: string, nextOperatorPublicKey: string): string;
export declare function listAgenticWalletsByOwner(input: {
    client: ApiClient;
    ownerAddress: string;
    collectionAddress: string;
    network: TonNetwork;
}): Promise<AgenticImportCandidate[]>;
export declare function validateAgenticWalletAddress(input: {
    client: ApiClient;
    address: string;
    collectionAddress?: string;
    ownerAddress?: string;
    network: TonNetwork;
}): Promise<AgenticImportCandidate>;
export {};
//# sourceMappingURL=agentic.d.ts.map