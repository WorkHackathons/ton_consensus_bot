/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { ApiClient } from '@ton/walletkit';
import type { TonNetwork } from '../registry/config.js';
export declare function getApiClientRequestIntervalMs(apiKey?: string): number;
export declare function resolveToncenterApiKey(network: TonNetwork, apiKey?: string): string;
export declare function createRateLimitedFetch(delayMs: number, fetchImpl?: typeof fetch): typeof fetch;
export declare function createApiClient(network: TonNetwork, apiKey?: string): ApiClient;
//# sourceMappingURL=ton-client.d.ts.map