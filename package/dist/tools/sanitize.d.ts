/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { ConfigNetwork, PendingAgenticDeployment, PendingAgenticKeyRotation, StoredAgenticWallet, StoredStandardWallet, StoredWallet } from '../registry/config.js';
import type { AgenticRootWalletSetupStatus } from '../services/AgenticOnboardingService.js';
export type PublicStandardWallet = Omit<StoredStandardWallet, 'mnemonic' | 'private_key'> & {
    has_mnemonic: boolean;
    has_private_key: boolean;
};
export type PublicAgenticWallet = Omit<StoredAgenticWallet, 'operator_private_key'> & {
    has_operator_private_key: boolean;
};
export type PublicStoredWallet = PublicStandardWallet | PublicAgenticWallet;
export interface PublicNetworkConfig {
    has_toncenter_api_key: boolean;
    agentic_collection_address?: string;
}
export type PublicPendingAgenticDeployment = Omit<PendingAgenticDeployment, 'operator_private_key'> & {
    has_operator_private_key: boolean;
};
export type PublicPendingAgenticKeyRotation = Omit<PendingAgenticKeyRotation, 'operator_private_key'> & {
    has_operator_private_key: boolean;
};
export interface PublicAgenticRootWalletSetupStatus extends Omit<AgenticRootWalletSetupStatus, 'pendingDeployment'> {
    pendingDeployment: PublicPendingAgenticDeployment;
}
export declare function sanitizeStoredWallet(wallet: StoredWallet | null): PublicStoredWallet | null;
export declare function sanitizeStoredWallets(wallets: StoredWallet[]): PublicStoredWallet[];
export declare const sanitizeWallet: typeof sanitizeStoredWallet;
export declare const sanitizeWallets: typeof sanitizeStoredWallets;
export declare function sanitizeNetworkConfig(config: ConfigNetwork): PublicNetworkConfig;
export declare function sanitizePendingAgenticDeployment(deployment: PendingAgenticDeployment): PublicPendingAgenticDeployment;
export declare function sanitizePendingAgenticDeployments(deployments: PendingAgenticDeployment[]): PublicPendingAgenticDeployment[];
export declare function sanitizePendingAgenticKeyRotation(rotation: PendingAgenticKeyRotation): PublicPendingAgenticKeyRotation;
export declare function sanitizePendingAgenticKeyRotations(rotations: PendingAgenticKeyRotation[]): PublicPendingAgenticKeyRotation[];
export declare function sanitizeAgenticRootWalletSetupStatus(setup: AgenticRootWalletSetupStatus | null): PublicAgenticRootWalletSetupStatus | null;
export declare function sanitizeAgenticRootWalletSetupStatuses(setups: AgenticRootWalletSetupStatus[]): PublicAgenticRootWalletSetupStatus[];
export declare const sanitizeRootWalletSetup: typeof sanitizeAgenticRootWalletSetupStatus;
export declare const sanitizeRootWalletSetups: typeof sanitizeAgenticRootWalletSetupStatuses;
//# sourceMappingURL=sanitize.d.ts.map