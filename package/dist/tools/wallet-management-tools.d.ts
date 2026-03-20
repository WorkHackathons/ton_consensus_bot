/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { z } from 'zod';
import type { WalletRegistryService } from '../services/WalletRegistryService.js';
import type { ToolResponse } from './types.js';
declare const setNetworkConfigSchema: z.ZodObject<{
    network: z.ZodEnum<["mainnet", "testnet"]>;
    toncenterApiKey: z.ZodOptional<z.ZodString>;
    agenticCollectionAddress: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    network: "mainnet" | "testnet";
    toncenterApiKey?: string | undefined;
    agenticCollectionAddress?: string | undefined;
}, {
    network: "mainnet" | "testnet";
    toncenterApiKey?: string | undefined;
    agenticCollectionAddress?: string | undefined;
}>;
declare const setActiveWalletSchema: z.ZodObject<{
    walletSelector: z.ZodString;
}, "strip", z.ZodTypeAny, {
    walletSelector: string;
}, {
    walletSelector: string;
}>;
declare const removeWalletSchema: z.ZodObject<{
    walletSelector: z.ZodString;
}, "strip", z.ZodTypeAny, {
    walletSelector: string;
}, {
    walletSelector: string;
}>;
declare const validateAgenticWalletSchema: z.ZodObject<{
    address: z.ZodString;
    network: z.ZodOptional<z.ZodEnum<["mainnet", "testnet"]>>;
    collectionAddress: z.ZodOptional<z.ZodString>;
    ownerAddress: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    address: string;
    network?: "mainnet" | "testnet" | undefined;
    ownerAddress?: string | undefined;
    collectionAddress?: string | undefined;
}, {
    address: string;
    network?: "mainnet" | "testnet" | undefined;
    ownerAddress?: string | undefined;
    collectionAddress?: string | undefined;
}>;
declare const listAgenticWalletsByOwnerSchema: z.ZodObject<{
    ownerAddress: z.ZodString;
    network: z.ZodOptional<z.ZodEnum<["mainnet", "testnet"]>>;
}, "strip", z.ZodTypeAny, {
    ownerAddress: string;
    network?: "mainnet" | "testnet" | undefined;
}, {
    ownerAddress: string;
    network?: "mainnet" | "testnet" | undefined;
}>;
declare const importAgenticWalletSchema: z.ZodObject<{
    address: z.ZodString;
    network: z.ZodOptional<z.ZodEnum<["mainnet", "testnet"]>>;
    name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    address: string;
    network?: "mainnet" | "testnet" | undefined;
    name?: string | undefined;
}, {
    address: string;
    network?: "mainnet" | "testnet" | undefined;
    name?: string | undefined;
}>;
declare const rotateOperatorKeySchema: z.ZodObject<{
    walletSelector: z.ZodOptional<z.ZodString>;
    operatorPrivateKey: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    walletSelector?: string | undefined;
    operatorPrivateKey?: string | undefined;
}, {
    walletSelector?: string | undefined;
    operatorPrivateKey?: string | undefined;
}>;
declare const pendingOperatorKeyRotationSchema: z.ZodObject<{
    rotationId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    rotationId: string;
}, {
    rotationId: string;
}>;
export declare function createMcpWalletManagementTools(registry: WalletRegistryService): {
    list_wallets: {
        description: string;
        inputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
        handler: () => Promise<ToolResponse>;
    };
    get_current_wallet: {
        description: string;
        inputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
        handler: () => Promise<ToolResponse>;
    };
    set_active_wallet: {
        description: string;
        inputSchema: z.ZodObject<{
            walletSelector: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            walletSelector: string;
        }, {
            walletSelector: string;
        }>;
        handler: (args: z.infer<typeof setActiveWalletSchema>) => Promise<ToolResponse>;
    };
    remove_wallet: {
        description: string;
        inputSchema: z.ZodObject<{
            walletSelector: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            walletSelector: string;
        }, {
            walletSelector: string;
        }>;
        handler: (args: z.infer<typeof removeWalletSchema>) => Promise<ToolResponse>;
    };
    set_network_config: {
        description: string;
        inputSchema: z.ZodObject<{
            network: z.ZodEnum<["mainnet", "testnet"]>;
            toncenterApiKey: z.ZodOptional<z.ZodString>;
            agenticCollectionAddress: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            network: "mainnet" | "testnet";
            toncenterApiKey?: string | undefined;
            agenticCollectionAddress?: string | undefined;
        }, {
            network: "mainnet" | "testnet";
            toncenterApiKey?: string | undefined;
            agenticCollectionAddress?: string | undefined;
        }>;
        handler: (args: z.infer<typeof setNetworkConfigSchema>) => Promise<ToolResponse>;
    };
    validate_agentic_wallet: {
        description: string;
        inputSchema: z.ZodObject<{
            address: z.ZodString;
            network: z.ZodOptional<z.ZodEnum<["mainnet", "testnet"]>>;
            collectionAddress: z.ZodOptional<z.ZodString>;
            ownerAddress: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            address: string;
            network?: "mainnet" | "testnet" | undefined;
            ownerAddress?: string | undefined;
            collectionAddress?: string | undefined;
        }, {
            address: string;
            network?: "mainnet" | "testnet" | undefined;
            ownerAddress?: string | undefined;
            collectionAddress?: string | undefined;
        }>;
        handler: (args: z.infer<typeof validateAgenticWalletSchema>) => Promise<ToolResponse>;
    };
    list_agentic_wallets_by_owner: {
        description: string;
        inputSchema: z.ZodObject<{
            ownerAddress: z.ZodString;
            network: z.ZodOptional<z.ZodEnum<["mainnet", "testnet"]>>;
        }, "strip", z.ZodTypeAny, {
            ownerAddress: string;
            network?: "mainnet" | "testnet" | undefined;
        }, {
            ownerAddress: string;
            network?: "mainnet" | "testnet" | undefined;
        }>;
        handler: (args: z.infer<typeof listAgenticWalletsByOwnerSchema>) => Promise<ToolResponse>;
    };
    import_agentic_wallet: {
        description: string;
        inputSchema: z.ZodObject<{
            address: z.ZodString;
            network: z.ZodOptional<z.ZodEnum<["mainnet", "testnet"]>>;
            name: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            address: string;
            network?: "mainnet" | "testnet" | undefined;
            name?: string | undefined;
        }, {
            address: string;
            network?: "mainnet" | "testnet" | undefined;
            name?: string | undefined;
        }>;
        handler: (args: z.infer<typeof importAgenticWalletSchema>) => Promise<ToolResponse>;
    };
    rotate_operator_key: {
        description: string;
        inputSchema: z.ZodObject<{
            walletSelector: z.ZodOptional<z.ZodString>;
            operatorPrivateKey: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            walletSelector?: string | undefined;
            operatorPrivateKey?: string | undefined;
        }, {
            walletSelector?: string | undefined;
            operatorPrivateKey?: string | undefined;
        }>;
        handler: (args: z.infer<typeof rotateOperatorKeySchema>) => Promise<ToolResponse>;
    };
    list_pending_operator_key_rotations: {
        description: string;
        inputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
        handler: () => Promise<ToolResponse>;
    };
    get_pending_operator_key_rotation: {
        description: string;
        inputSchema: z.ZodObject<{
            rotationId: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            rotationId: string;
        }, {
            rotationId: string;
        }>;
        handler: (args: z.infer<typeof pendingOperatorKeyRotationSchema>) => Promise<ToolResponse>;
    };
    complete_rotate_operator_key: {
        description: string;
        inputSchema: z.ZodObject<{
            rotationId: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            rotationId: string;
        }, {
            rotationId: string;
        }>;
        handler: (args: z.infer<typeof pendingOperatorKeyRotationSchema>) => Promise<ToolResponse>;
    };
    cancel_rotate_operator_key: {
        description: string;
        inputSchema: z.ZodObject<{
            rotationId: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            rotationId: string;
        }, {
            rotationId: string;
        }>;
        handler: (args: z.infer<typeof pendingOperatorKeyRotationSchema>) => Promise<ToolResponse>;
    };
};
export {};
//# sourceMappingURL=wallet-management-tools.d.ts.map