/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
export interface ServerlessRequest {
    headers: Record<string, string | string[] | undefined>;
    method?: string;
    url?: string;
    body?: unknown;
}
export interface ServerlessResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
}
/**
 * Create a serverless handler for MCP requests
 *
 * @example
 * ```typescript
 * // AWS Lambda
 * import { createServerlessHandler } from '@ton/mcp/serverless';
 * export const handler = createServerlessHandler();
 *
 * // Vercel
 * import { createServerlessHandler } from '@ton/mcp/serverless';
 * export default createServerlessHandler();
 * ```
 */
export declare function createServerlessHandler(): (req: ServerlessRequest) => Promise<ServerlessResponse>;
/**
 * Default serverless handler
 */
export declare const handler: (req: ServerlessRequest) => Promise<ServerlessResponse>;
//# sourceMappingURL=serverless.d.ts.map