/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export interface HttpSessionServerInstance {
    server: McpServer;
    close: () => Promise<void>;
}
export interface HttpMcpSessionRouterOptions {
    host: string;
    port: number;
    createServerInstance: () => Promise<HttpSessionServerInstance>;
    handleExtraRequest?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
}
export declare function createHttpMcpSessionRouter(options: HttpMcpSessionRouterOptions): {
    handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
    close(): Promise<void>;
    getSessionCount(): number;
};
//# sourceMappingURL=http-mode.d.ts.map