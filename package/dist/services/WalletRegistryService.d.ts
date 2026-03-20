/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { IContactResolver } from '../types/contacts.js';
import type { NetworkConfig as RuntimeNetworkConfig } from './McpWalletService.js';
import type { ConfigNetwork, PendingAgenticDeployment, PendingAgenticKeyRotation, StoredAgenticWallet, StoredWallet, TonConfig, TonNetwork } from '../registry/config.js';
import type { WalletServiceContext } from '../runtime/wallet-runtime.js';
import type { AgenticImportCandidate } from '../utils/agentic.js';
export interface StartAgenticKeyRotationResult {
    wallet: StoredAgenticWallet;
    pendingRotation: PendingAgenticKeyRotation;
    dashboardUrl: string;
    updatedExisting: boolean;
}
export interface CompleteAgenticKeyRotationResult {
    wallet: StoredAgenticWallet;
    pendingRotation: PendingAgenticKeyRotation;
    dashboardUrl: string;
}
export declare class WalletRegistryService {
    private readonly contacts?;
    private readonly networkOverrides?;
    constructor(contacts?: IContactResolver | undefined, networkOverrides?: {
        mainnet?: RuntimeNetworkConfig;
        testnet?: RuntimeNetworkConfig;
    } | undefined);
    private resolveToncenterApiKey;
    private assertWalletSupportsSigning;
    loadConfig(): Promise<TonConfig>;
    listWallets(): Promise<StoredWallet[]>;
    getCurrentWallet(): Promise<StoredWallet | null>;
    requireCurrentWallet(): Promise<StoredWallet>;
    getNetworkConfig(network: TonNetwork): Promise<ConfigNetwork>;
    setNetworkConfig(network: TonNetwork, patch: Partial<ConfigNetwork>): Promise<ConfigNetwork>;
    setActiveWallet(selector: string): Promise<StoredWallet>;
    removeWallet(selector: string): Promise<{
        removedWalletId: string;
        activeWalletId: string | null;
    }>;
    createWalletService(walletSelector?: string, options?: {
        requiresSigning?: boolean;
    }): Promise<WalletServiceContext & {
        wallet: StoredWallet;
    }>;
    validateAgenticWallet(input: {
        address: string;
        network?: string;
        collectionAddress?: string;
        ownerAddress?: string;
    }): Promise<AgenticImportCandidate>;
    listAgenticWalletsByOwner(input: {
        ownerAddress: string;
        network?: string;
    }): Promise<AgenticImportCandidate[]>;
    importAgenticWallet(input: {
        address: string;
        network?: string;
        name?: string;
    }): Promise<{
        wallet: StoredAgenticWallet;
        recoveredPendingKeyDraft: boolean;
        updatedExisting: boolean;
        dashboardUrl: string;
    }>;
    startAgenticKeyRotation(input: {
        walletSelector?: string;
        operatorPrivateKey?: string;
    }): Promise<StartAgenticKeyRotationResult>;
    listPendingAgenticKeyRotations(): Promise<PendingAgenticKeyRotation[]>;
    getPendingAgenticKeyRotation(rotationId: string): Promise<PendingAgenticKeyRotation | null>;
    completeAgenticKeyRotation(rotationId: string): Promise<CompleteAgenticKeyRotationResult>;
    cancelAgenticKeyRotation(rotationId: string): Promise<void>;
    listPendingAgenticSetups(): Promise<PendingAgenticDeployment[]>;
    getPendingAgenticSetup(setupId: string): Promise<PendingAgenticDeployment | null>;
    createPendingAgenticSetup(input: {
        network: TonNetwork;
        operatorPrivateKey: string;
        operatorPublicKey: string;
        name?: string;
        source?: string;
        collectionAddress?: string;
    }): Promise<PendingAgenticDeployment>;
    removePendingAgenticSetup(input: {
        id?: string;
        network?: TonNetwork;
        operatorPublicKey?: string;
    }): Promise<void>;
    completePendingAgenticSetup(input: {
        setupId: string;
        validatedWallet: AgenticImportCandidate;
        name?: string;
        source?: string;
    }): Promise<StoredAgenticWallet>;
}
//# sourceMappingURL=WalletRegistryService.d.ts.map