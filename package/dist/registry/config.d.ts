/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
export type TonNetwork = 'mainnet' | 'testnet';
export type StandardWalletVersion = 'v5r1' | 'v4r2';
export type StoredWalletType = 'standard' | 'agentic';
export interface ConfigNetwork {
    toncenter_api_key?: string;
    agentic_collection_address?: string;
}
export interface StoredWalletBase {
    id: string;
    name: string;
    type: StoredWalletType;
    network: TonNetwork;
    address: string;
    removed?: boolean;
    removed_at?: string;
    created_at: string;
    updated_at: string;
}
export interface StoredStandardWallet extends StoredWalletBase {
    type: 'standard';
    wallet_version: StandardWalletVersion;
    mnemonic?: string;
    private_key?: string;
}
export interface StoredAgenticWallet extends StoredWalletBase {
    type: 'agentic';
    owner_address: string;
    operator_private_key?: string;
    operator_public_key?: string;
    source?: string;
    collection_address?: string;
    origin_operator_public_key?: string;
    deployed_by_user?: boolean;
}
export type StoredWallet = StoredStandardWallet | StoredAgenticWallet;
export interface PendingAgenticDeployment {
    id: string;
    network: TonNetwork;
    operator_private_key: string;
    operator_public_key: string;
    name?: string;
    source?: string;
    collection_address?: string;
    created_at: string;
    updated_at: string;
}
export interface PendingAgenticKeyRotation {
    id: string;
    wallet_id: string;
    network: TonNetwork;
    wallet_address: string;
    owner_address: string;
    collection_address?: string;
    operator_private_key: string;
    operator_public_key: string;
    created_at: string;
    updated_at: string;
}
export type AgenticSetupStatus = 'pending' | 'callback_received' | 'completed' | 'cancelled' | 'expired';
export interface StoredAgenticSetupSession {
    setup_id: string;
    callback_url: string;
    status: AgenticSetupStatus;
    created_at: string;
    expires_at: string;
    payload?: {
        event: 'agent_wallet_deployed';
        network?: {
            chainId?: string | number;
            collectionAddress?: string;
        };
        wallet?: {
            address?: string;
            ownerAddress?: string;
            originOperatorPublicKey?: string;
            operatorPublicKey?: string;
            deployedByUser?: boolean;
            name?: string;
            source?: string;
        };
    };
}
export interface TonConfig {
    version: 2;
    active_wallet_id: string | null;
    networks: {
        mainnet?: ConfigNetwork;
        testnet?: ConfigNetwork;
    };
    wallets: StoredWallet[];
    pending_agentic_deployments?: PendingAgenticDeployment[];
    pending_agentic_key_rotations?: PendingAgenticKeyRotation[];
    agentic_setup_sessions?: StoredAgenticSetupSession[];
}
export declare class ConfigError extends Error {
}
export declare const DEFAULT_AGENTIC_COLLECTION_ADDRESS = "EQByQ19qvWxW7VibSbGEgZiYMqilHY5y1a_eeSL2VaXhfy07";
export declare function getConfigPath(): string;
export declare function getConfigDir(): string;
export declare function configExists(): boolean;
export declare function createEmptyConfig(): TonConfig;
export declare function ensureConfigPermissions(): void;
export declare function loadConfig(): TonConfig | null;
export declare function loadConfigWithMigration(): Promise<TonConfig | null>;
export declare function saveConfig(config: TonConfig): void;
export declare function deleteConfig(): boolean;
export declare function listWallets(config: TonConfig): StoredWallet[];
export declare function getActiveWallet(config: TonConfig): StoredWallet | null;
export declare function findWallet(config: TonConfig, selector: string): StoredWallet | null;
export declare function findWalletByAddress(config: TonConfig, network: TonNetwork, address: string): StoredWallet | null;
export declare function upsertWallet(config: TonConfig, wallet: StoredWallet, options?: {
    setActive?: boolean;
}): TonConfig;
export declare function removeWallet(config: TonConfig, selector: string): {
    config: TonConfig;
    removed: StoredWallet | null;
};
export declare function setActiveWallet(config: TonConfig, selector: string): {
    config: TonConfig;
    wallet: StoredWallet | null;
};
export declare function listPendingAgenticDeployments(config: TonConfig): PendingAgenticDeployment[];
export declare function listPendingAgenticKeyRotations(config: TonConfig): PendingAgenticKeyRotation[];
export declare function listAgenticSetupSessions(config: TonConfig): StoredAgenticSetupSession[];
export declare function findPendingAgenticDeployment(config: TonConfig, input: {
    id?: string;
    network?: TonNetwork;
    operatorPublicKey?: string;
}): PendingAgenticDeployment | null;
export declare function upsertPendingAgenticDeployment(config: TonConfig, deployment: PendingAgenticDeployment): TonConfig;
export declare function findPendingAgenticKeyRotation(config: TonConfig, input: {
    id?: string;
    walletId?: string;
}): PendingAgenticKeyRotation | null;
export declare function upsertPendingAgenticKeyRotation(config: TonConfig, rotation: PendingAgenticKeyRotation): TonConfig;
export declare function removePendingAgenticDeployment(config: TonConfig, input: {
    id?: string;
    network?: TonNetwork;
    operatorPublicKey?: string;
}): TonConfig;
export declare function removePendingAgenticKeyRotation(config: TonConfig, input: {
    id?: string;
    walletId?: string;
}): TonConfig;
export declare function findAgenticSetupSession(config: TonConfig, setupId: string): StoredAgenticSetupSession | null;
export declare function upsertAgenticSetupSession(config: TonConfig, session: StoredAgenticSetupSession): TonConfig;
export declare function removeAgenticSetupSession(config: TonConfig, setupId: string): TonConfig;
export declare function updateNetworkConfig(config: TonConfig, network: TonNetwork, patch: Partial<ConfigNetwork>): TonConfig;
export declare function normalizeNetwork(value: string | undefined | null, fallback?: TonNetwork): TonNetwork;
export declare function normalizeWalletVersion(value: string | undefined | null, fallback?: StandardWalletVersion): StandardWalletVersion;
export declare function getToncenterApiKey(config: TonConfig | null, network: TonNetwork): string | undefined;
export declare function getAgenticCollectionAddress(config: TonConfig | null, network: TonNetwork): string | undefined;
export declare function createWalletId(prefix: string): string;
export declare function createStandardWalletRecord(input: {
    name: string;
    network: TonNetwork;
    walletVersion: StandardWalletVersion;
    address: string;
    mnemonic?: string;
    privateKey?: string;
    idPrefix?: string;
}): StoredStandardWallet;
export declare function createAgenticWalletRecord(input: {
    name: string;
    network: TonNetwork;
    address: string;
    ownerAddress: string;
    operatorPrivateKey?: string;
    operatorPublicKey?: string;
    source?: string;
    collectionAddress?: string;
    originOperatorPublicKey?: string;
    deployedByUser?: boolean;
    idPrefix?: string;
}): StoredAgenticWallet;
export declare function createPendingAgenticDeployment(input: {
    network: TonNetwork;
    operatorPrivateKey: string;
    operatorPublicKey: string;
    name?: string;
    source?: string;
    collectionAddress?: string;
    idPrefix?: string;
}): PendingAgenticDeployment;
export declare function createPendingAgenticKeyRotation(input: {
    walletId: string;
    network: TonNetwork;
    walletAddress: string;
    ownerAddress: string;
    collectionAddress?: string;
    operatorPrivateKey: string;
    operatorPublicKey: string;
    idPrefix?: string;
}): PendingAgenticKeyRotation;
//# sourceMappingURL=config.d.ts.map