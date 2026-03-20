/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { PendingAgenticDeployment, StoredAgenticWallet, TonNetwork } from '../registry/config.js';
import type { WalletRegistryService } from './WalletRegistryService.js';
import type { AgenticSetupSessionManager } from './AgenticSetupSessionManager.js';
import type { AgenticSetupSession } from './AgenticSetupSessionManager.js';
export interface AgenticRootWalletSetupStatus {
    setupId: string;
    pendingDeployment: PendingAgenticDeployment;
    session: AgenticSetupSession | null;
    status: AgenticSetupSession['status'] | 'pending_without_callback';
    dashboardUrl?: string;
}
export declare class AgenticOnboardingService {
    private readonly registry;
    private readonly sessionManager;
    constructor(registry: WalletRegistryService, sessionManager: AgenticSetupSessionManager);
    startRootWalletSetup(input: {
        network?: string;
        name?: string;
        source?: string;
        collectionAddress?: string;
        tonDeposit?: string;
    }): Promise<{
        setupId: string;
        network: TonNetwork;
        operatorPublicKey: string;
        dashboardUrl: string;
        callbackUrl: string;
        pendingDeployment: PendingAgenticDeployment;
    }>;
    listRootWalletSetups(): Promise<AgenticRootWalletSetupStatus[]>;
    getRootWalletSetup(setupId: string): Promise<AgenticRootWalletSetupStatus | null>;
    private composeStatus;
    completeRootWalletSetup(input: {
        setupId: string;
        walletAddress?: string;
        ownerAddress?: string;
    }): Promise<{
        wallet: StoredAgenticWallet;
        resolvedWalletAddress: string;
        usedCallbackPayload: boolean;
    }>;
    cancelRootWalletSetup(setupId: string): Promise<void>;
}
//# sourceMappingURL=AgenticOnboardingService.d.ts.map