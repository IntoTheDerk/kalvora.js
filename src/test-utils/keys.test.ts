/**
 * Universal Test Keys for Kalvora SDK Testing
 * 
 * This module provides standardized test key pairs for consistent testing across all modules.
 * These keys are specifically designed for testing purposes and should not be used in production.
 * 
 * Address format: address = base58(publicKey) = the base58 portion of the public key identifier
 * Public key identifier format: KeyPrefix_Base58PublicKey (e.g., A_<base58pubkey>)
 * 
 * Generated on: 2025-09-15T16:51:19.680Z
 * Updated: 2026-02-08 — migrated to key-only address format
 */


export interface TestKeyPair {
  privateKey: string;
  publicKey: string;
  address: string;
}


/**
 * Test Key Pairs for ED25519:
 * - Alice: A_ prefix (Ed25519)
 * - Bob: A_ prefix (Ed25519)
 * - Charlie: A_ prefix (Ed25519)
 * 
 * Address = base58 portion of the public key identifier (no hashing)
 */
export const ED25519_TEST_KEYS: Record<'alice' | 'bob' | 'charlie', TestKeyPair> = {
  alice: {
    privateKey: 'Akyo231kUTYfC9AXokfUVhq7XoL6gri7zVfFi8WSG5Kt',
    publicKey: 'A_AKpo7NMd3JhGAonxXJXuG8XgDXA8jZGikK6UaHDYxksU',
    address: 'AKpo7NMd3JhGAonxXJXuG8XgDXA8jZGikK6UaHDYxksU'
  },
  bob: {
    privateKey: '7ES16G6gu4YKsNyhRsvX4hznhgWLHaVcpcWJtUQyqodJ',
    publicKey: 'A_8ffgHJD1aNbiYn5r8oP6bJtKW6vFcXFUizRJLCRQVX6H',
    address: '8ffgHJD1aNbiYn5r8oP6bJtKW6vFcXFUizRJLCRQVX6H'
  },
  charlie: {
    privateKey: 'BmKNB363Sppn8twb6cUntLKsuFDpBrhGQLxkfFCS9R5K',
    publicKey: 'A_6Tn7ZEW3fep5PJnENTmJzGd1NTsML4WbmKFmJB8VoND',
    address: '6Tn7ZEW3fep5PJnENTmJzGd1NTsML4WbmKFmJB8VoND'
  }
};

/**
 * Test Key Pairs for ED448:
 * - Alice: B_ prefix (Ed448)
 * - Bob: B_ prefix (Ed448)
 * - Charlie: B_ prefix (Ed448)
 * 
 * Address = base58 portion of the public key identifier (no hashing)
 */
export const ED448_TEST_KEYS: Record<'alice' | 'bob' | 'charlie', TestKeyPair> = {
  alice: {
    privateKey: '8CL2rdGSJWgj5ghe1Fg39UeNtWHhVGu6yoU8W7Ac57x2',
    publicKey: 'B_BTDwQNwypMZUDdJkY9jyTS4DPtVS91EqeAdZdnHNijUFoEWGxoA6nXdB4TJHGuXjVHq37VsznXHuXd',
    address: 'BTDwQNwypMZUDdJkY9jyTS4DPtVS91EqeAdZdnHNijUFoEWGxoA6nXdB4TJHGuXjVHq37VsznXHuXd'
  },
  bob: {
    privateKey: '5NGTFZfS9TE12SKLceUhAhUnRTixJmpD4imcjbsHnExa',
    publicKey: 'B_VU7J4BNRYk1M6WYcNrDyGjoFU8onVryZPNhZ7tuhQAD8fCizJPZMJEeBSMJkLF3YKrs95TcmxDbH4b',
    address: 'VU7J4BNRYk1M6WYcNrDyGjoFU8onVryZPNhZ7tuhQAD8fCizJPZMJEeBSMJkLF3YKrs95TcmxDbH4b'
  },
  charlie: {
    privateKey: 'A47VfEGGQYDAEtibZCBNtJ7dTARVZfHQKRiQxqbVz5P3',
    publicKey: 'B_AupmN6d1KLntoXVcodk8cQTNq8tvAsi1vNW8MiBQmBvwuVmh7rzgHLbSsxc6iKK8fBZ462Dczi3nDu',
    address: 'AupmN6d1KLntoXVcodk8cQTNq8tvAsi1vNW8MiBQmBvwuVmh7rzgHLbSsxc6iKK8fBZ462Dczi3nDu'
  }
};

/**
 * Test Wallet Addresses (derived from public keys — now equal to base58 public key)
 */
export const TEST_WALLET_ADDRESSES: Record<'alice' | 'bob' | 'charlie' | 'jesse', string> = {
  alice: 'AKpo7NMd3JhGAonxXJXuG8XgDXA8jZGikK6UaHDYxksU',
  bob: '8ffgHJD1aNbiYn5r8oP6bJtKW6vFcXFUizRJLCRQVX6H',
  charlie: '6Tn7ZEW3fep5PJnENTmJzGd1NTsML4WbmKFmJB8VoND',
  jesse: 'WYEKj2jB1exPn7BStQ7WBkr8WpST9x3iT7gvoPjyZcYAP'
};

/**
 * Solana Test Key Pair Interface
 */
export interface SolanaTestKeyPair {
  /** Base58-encoded private key (secret key) */
  privateKey: string;
  /** Base58-encoded public key */
  publicKey: string;
}

/**
 * Solana Test Key Pairs for integration testing
 * 
 * These are test keys - NOT for production use!
 * They can be used for signing test transactions on devnet/testnet.
 * 
 * NOTE: These are valid keypairs (private key derives to public key).
 * Fund these on your test network before using.
 */
export const SOLANA_TEST_KEYS: Record<'primary' | 'secondary', SolanaTestKeyPair> = {
  primary: {
    privateKey: '33GArW4syeohdtUGCMpwhJZL3aWRjKuFUeY23VTzEBNHPuxfhYnmBcMFFGaVhYEzPNn8VX6fBVwjpQ9LXoiYZGk6',
    publicKey: '59m8noybeKMiZeMos4RVDgnBwSbpzDndKcR7ZBtMGaBG'
  },
  secondary: {
    // Placeholder for additional test wallet
    privateKey: '',
    publicKey: ''
  }
};

/**
 * Default Solana RPC endpoints for testing
 */
export const SOLANA_TEST_RPC = {
  /** Solana devnet */
  devnet: 'https://api.devnet.solana.com',
  /** Solana testnet */
  testnet: 'https://api.testnet.solana.com'
};
