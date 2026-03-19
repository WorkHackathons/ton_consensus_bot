/**
 * Copyright (c) TonTech.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { NetworkType } from '../types/config.js';
export interface StoredKeyData {
    /** User's wallet address that this keypair controls */
    walletAddress: string;
    /** Public key in hex format */
    publicKey: string;
    /** Private key (seed) in hex format */
    privateKey: string;
    /** Network */
    network: NetworkType;
    /** Creation timestamp */
    createdAt: string;
}
export interface KeyPairResult {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
}
/**
 * KeyManager handles creation and storage of keypairs for controlled wallets
 */
export declare class KeyManager {
    /**
     * Check if a key file exists
     */
    static hasStoredKey(): Promise<boolean>;
    /**
     * Load stored key data from ~/.ton/key.json
     */
    static loadKey(): Promise<StoredKeyData | null>;
    /**
     * Generate a new keypair and store it
     */
    static generateAndStoreKey(walletAddress: string, network: NetworkType): Promise<StoredKeyData>;
    /**
     * Save key data to ~/.ton/key.json
     */
    static saveKey(keyData: StoredKeyData): Promise<void>;
    /**
     * Get keypair from stored key data
     */
    static getKeyPair(keyData: StoredKeyData): KeyPairResult;
    /**
     * Get the path to the key file
     */
    static getKeyFilePath(): string;
    /**
     * Delete stored key
     */
    static deleteKey(): Promise<void>;
}
//# sourceMappingURL=KeyManager.d.ts.map