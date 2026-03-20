/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgenticSetupStatus, StoredAgenticSetupSession } from '../registry/config.js';
export interface AgenticDeployCallbackPayload {
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
}
export type { AgenticSetupStatus } from '../registry/config.js';
export interface AgenticSetupSession {
    setupId: string;
    callbackUrl: string;
    status: AgenticSetupStatus;
    createdAt: string;
    expiresAt: string;
    payload?: AgenticDeployCallbackPayload;
}
export interface AgenticSetupSessionStore {
    listSessions(): StoredAgenticSetupSession[];
    upsertSession(session: StoredAgenticSetupSession): void;
    removeSession(setupId: string): void;
}
export declare class ConfigBackedAgenticSetupSessionStore implements AgenticSetupSessionStore {
    listSessions(): StoredAgenticSetupSession[];
    upsertSession(session: StoredAgenticSetupSession): void;
    removeSession(setupId: string): void;
}
export interface AgenticSetupSessionManagerOptions {
    host?: string;
    ttlMs?: number;
    listenPort?: number;
    publicBaseUrl?: string;
    enableInternalHttpServer?: boolean;
    store?: AgenticSetupSessionStore;
}
export declare class AgenticSetupSessionManager {
    private server;
    private callbackBaseUrl;
    private readonly sessions;
    private readonly host;
    private readonly ttlMs;
    private readonly listenPort;
    private readonly publicBaseUrl?;
    private readonly enableInternalHttpServer;
    private readonly store?;
    constructor(options?: AgenticSetupSessionManagerOptions);
    private syncFromStore;
    private toStoredSession;
    private fromStoredSession;
    private persistSession;
    private deleteSession;
    private cleanupExpiredSessions;
    private buildCallbackUrl;
    private ensureServer;
    private readRequestBody;
    private writeCorsHeaders;
    handleCallbackHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
    createSession(setupId: string): Promise<AgenticSetupSession>;
    getSession(setupId: string): AgenticSetupSession | null;
    listSessions(): AgenticSetupSession[];
    markCompleted(setupId: string): void;
    cancelSession(setupId: string): void;
    close(): Promise<void>;
}
//# sourceMappingURL=AgenticSetupSessionManager.d.ts.map