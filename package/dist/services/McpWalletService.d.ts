/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { WalletAdapter, TransactionStatusResponse } from '@ton/walletkit';
import type { IContactResolver } from '../types/contacts.js';
import type { NetworkType } from '../types/config.js';
/**
 * Jetton information
 */
export interface JettonInfoResult {
    address: string;
    balance: string;
    name?: string;
    symbol?: string;
    decimals?: number;
}
export interface JettonMetadataResult {
    address: string;
    name?: string;
    symbol?: string;
    decimals?: number;
    description?: string;
    image?: string;
    uri?: string;
}
export interface AddressBalanceResult {
    address: string;
    balanceNano: string;
    balanceTon: string;
}
/**
 * NFT information
 */
export interface NftInfoResult {
    address: string;
    name?: string;
    description?: string;
    image?: string;
    collection?: {
        address: string;
        name?: string;
    };
    attributes?: Array<{
        trait_type?: string;
        value?: string;
    }>;
    ownerAddress?: string;
    isOnSale?: boolean;
    isSoulbound?: boolean;
    saleContractAddress?: string;
}
/**
 * Transaction info (from events API)
 */
export interface TransactionInfo {
    eventId: string;
    timestamp: number;
    type: 'TonTransfer' | 'JettonTransfer' | 'JettonSwap' | 'NftItemTransfer' | 'ContractDeploy' | 'SmartContractExec' | 'Unknown';
    status: 'success' | 'failure';
    from?: string;
    to?: string;
    amount?: string;
    comment?: string;
    jettonAddress?: string;
    jettonSymbol?: string;
    jettonAmount?: string;
    dex?: string;
    amountIn?: string;
    amountOut?: string;
    description?: string;
    isScam: boolean;
}
/**
 * Transfer result
 */
export interface TransferResult {
    success: boolean;
    message: string;
    normalizedHash?: string;
}
export interface DeployAgenticSubwalletResult extends TransferResult {
    subwalletAddress?: string;
    subwalletNftIndex?: string;
    ownerAddress?: string;
    collectionAddress?: string;
    operatorPublicKey?: string;
    amountNano?: string;
    queryId?: string;
}
/**
 * Swap quote result with transaction params
 */
export interface SwapQuoteResult {
    fromToken: string;
    toToken: string;
    /** Amount to swap from in human-readable format (e.g., "1.5") */
    fromAmount: string;
    /** Amount to receive in human-readable format (e.g., "2.3") */
    toAmount: string;
    /** Minimum amount to receive after slippage in human-readable format */
    minReceived: string;
    provider: string;
    expiresAt?: number;
    /** Raw transaction params ready to send */
    transaction: {
        messages: Array<{
            address: string;
            amount: string;
            stateInit?: string;
            payload?: string;
        }>;
        validUntil?: number;
    };
}
/**
 * Network configuration with optional API key
 */
export interface NetworkConfig {
    /** TonCenter API key for this network */
    apiKey?: string;
}
/**
 * Configuration for McpWalletService
 */
export interface McpWalletServiceConfig {
    wallet: WalletAdapter;
    contacts?: IContactResolver;
    /** Network-specific configuration */
    networks?: {
        mainnet?: NetworkConfig;
        testnet?: NetworkConfig;
    };
}
interface DeployAgenticSubwalletParams {
    operatorPublicKey: string;
    amountNano: string;
    metadata: Record<string, string | number | boolean>;
}
/**
 * McpWalletService manages wallet operations for a single wallet.
 */
export declare class McpWalletService {
    private readonly config;
    private readonly wallet;
    private kit;
    private constructor();
    private static parseUint256;
    private static createQueryId;
    private static onchainMetadataKey;
    private static buildOnchainMetadataValue;
    private static buildOnchainMetadata;
    private static buildAgenticWalletConfigData;
    private static calculateAgenticWalletIndex;
    private static createDeployWalletBody;
    private static isAgenticWalletInitialized;
    private assertAgenticWalletVersion;
    private getAgenticRootWalletState;
    static create(config: McpWalletServiceConfig): Promise<McpWalletService>;
    /**
     * Get wallet address
     */
    getAddress(): string;
    /**
     * Get wallet network
     */
    getNetwork(): NetworkType;
    /**
     * Initialize TonWalletKit (for swap operations)
     */
    private getKit;
    /**
     * Get TON balance
     */
    getBalance(): Promise<string>;
    /**
     * Get TON balance for any address.
     */
    getBalanceByAddress(address: string): Promise<AddressBalanceResult>;
    /**
     * Get Jetton balance
     */
    getJettonBalance(jettonAddress: string): Promise<string>;
    /**
     * Get Jettons for any address.
     */
    getJettonsByAddress(address: string, limit?: number, offset?: number): Promise<JettonInfoResult[]>;
    /**
     * Get metadata for a Jetton master.
     */
    getJettonInfo(jettonAddress: string): Promise<JettonMetadataResult | null>;
    /**
     * Resolve jetton-wallet address for an owner.
     */
    getJettonWalletAddress(jettonAddress: string, ownerAddress: string): Promise<string>;
    /**
     * Get all Jettons
     */
    getJettons(): Promise<JettonInfoResult[]>;
    /**
     * Get transaction history using events API
     */
    getTransactions(limit?: number): Promise<TransactionInfo[]>;
    /**
     * Send TON
     */
    sendTon(toAddress: string, amountNano: string, comment?: string): Promise<TransferResult>;
    /**
     * Send Jetton
     */
    sendJetton(toAddress: string, jettonAddress: string, amountRaw: string, comment?: string): Promise<TransferResult>;
    /**
     * Send a raw transaction request directly
     */
    sendRawTransaction(request: {
        messages: Array<{
            address: string;
            amount: string;
            mode?: number;
            stateInit?: string;
            payload?: string;
        }>;
        validUntil?: number;
        fromAddress?: string;
    }): Promise<TransferResult>;
    /**
     * Deploy a new Agentic sub-wallet from the current Agentic root wallet.
     */
    deployAgenticSubwallet(params: DeployAgenticSubwalletParams): Promise<DeployAgenticSubwalletResult>;
    /**
     * Get the status of a transaction by its normalized hash.
     *
     * In TON, a single external message triggers a tree of internal messages.
     * The transaction is "complete" only when the entire trace finishes.
     */
    getTransactionStatus(normalizedHash: string): Promise<TransactionStatusResponse>;
    /**
     * Get swap quote with transaction params ready to execute
     * @param fromToken Token to swap from ("TON" or jetton address)
     * @param toToken Token to swap to ("TON" or jetton address)
     * @param amount Amount to swap in human-readable format (e.g., "1.5" for 1.5 TON)
     * @param slippageBps Slippage tolerance in basis points (default 100 = 1%)
     */
    getSwapQuote(fromToken: string, toToken: string, amount: string, slippageBps?: number): Promise<SwapQuoteResult>;
    /**
     * Get all NFTs
     */
    getNfts(limit?: number, offset?: number): Promise<NftInfoResult[]>;
    /**
     * Get NFTs for any address.
     */
    getNftsByAddress(address: string, limit?: number, offset?: number): Promise<NftInfoResult[]>;
    /**
     * Get a specific NFT by address
     */
    getNft(nftAddress: string): Promise<NftInfoResult | null>;
    /**
     * Send NFT
     */
    sendNft(nftAddress: string, toAddress: string, comment?: string): Promise<TransferResult>;
    /**
     * Resolve contact name to address
     */
    resolveContact(name: string): Promise<string | null>;
    /**
     * Resolve a TON DNS domain (e.g., "wallet.ton") to a wallet address
     */
    resolveDns(domain: string): Promise<string | null>;
    /**
     * Reverse resolve a wallet address to a TON DNS domain
     */
    backResolveDns(address: string): Promise<string | null>;
    /**
     * Close and cleanup
     */
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=McpWalletService.d.ts.map