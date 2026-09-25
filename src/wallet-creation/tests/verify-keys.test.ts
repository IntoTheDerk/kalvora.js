/**
 * Verification Script: Test Key Pair Integrity
 * 
 * This test verifies that the hardcoded test keys in keys.test.ts are
 * cryptographically valid — i.e., each private key actually derives
 * to the stored public key and address.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { ed448 } from '@noble/curves/ed448.js';
import bs58 from 'bs58';
import { describe, it, expect } from 'vitest';


import {
  ED25519_TEST_KEYS,
  ED448_TEST_KEYS
} from '../../test-utils/keys.test.js';
import { Ed448KeyPair } from '../crypto-core.js';

describe('Test Key Pair Cryptographic Verification', () => {
  describe('ED25519 Keys', () => {
    for (const [name, keys] of Object.entries(ED25519_TEST_KEYS)) {
      it(`${name}: private key should derive to stored public key`, () => {
        // 1. Decode the stored private key from base58
        const privateKeyBytes = bs58.decode(keys.privateKey);
        
        // 2. Derive the public key using ed25519
        const derivedPublicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
        const derivedPublicKeyBase58 = bs58.encode(derivedPublicKeyBytes);
        
        // 3. Extract expected base58 public key from the identifier (strip "A_" prefix)
        const expectedPublicKeyBase58 = keys.publicKey.substring(2); // Remove "A_"
        
        console.log(`  ${name}:`);
        console.log(`    Private Key:  ${keys.privateKey}`);
        console.log(`    Derived PubKey: ${derivedPublicKeyBase58}`);
        console.log(`    Stored PubKey:  ${expectedPublicKeyBase58}`);
        console.log(`    Match: ${derivedPublicKeyBase58 === expectedPublicKeyBase58}`);
        
        // 4. Verify the derived public key matches what's stored
        expect(derivedPublicKeyBase58).toBe(expectedPublicKeyBase58);
      });

      it(`${name}: address should equal base58 public key (new format)`, () => {
        const expectedPublicKeyBase58 = keys.publicKey.substring(2);
        expect(keys.address).toBe(expectedPublicKeyBase58);
      });
    }
  });

  describe('ED448 Keys', () => {
    for (const [name, keys] of Object.entries(ED448_TEST_KEYS)) {
      it(`${name}: private key should derive to stored public key`, () => {
        // 1. Decode the stored private key from base58
        //    Note: ED448 test keys store 32-byte SLIP-0010 seeds,
        //    not raw 57-byte ED448 private keys. The SDK's Ed448KeyPair 
        //    handles the 32→57 byte expansion internally.
        const privateKeyBytes = bs58.decode(keys.privateKey);
        
        // 2. Derive via Ed448KeyPair (handles seed expansion)
        const keyPair = new Ed448KeyPair(privateKeyBytes);
        const derivedPublicKeyBase58 = bs58.encode(keyPair.publicKey);
        
        // 3. Extract expected base58 public key from the identifier (strip "B_" prefix)
        const expectedPublicKeyBase58 = keys.publicKey.substring(2); // Remove "B_"
        
        console.log(`  ${name}:`);
        console.log(`    Private Key (32-byte seed): ${keys.privateKey}`);
        console.log(`    Expanded to 57-byte key:    ${bs58.encode(keyPair.getPrivateKeyBase58 ? bs58.decode(keyPair.getPrivateKeyBase58()) : new Uint8Array())}`);
        console.log(`    Derived PubKey: ${derivedPublicKeyBase58}`);
        console.log(`    Stored PubKey:  ${expectedPublicKeyBase58}`);
        console.log(`    Match: ${derivedPublicKeyBase58 === expectedPublicKeyBase58}`);
        
        // 4. Verify the derived public key matches what's stored
        expect(derivedPublicKeyBase58).toBe(expectedPublicKeyBase58);
      });

      it(`${name}: address should equal base58 public key (new format)`, () => {
        const expectedPublicKeyBase58 = keys.publicKey.substring(2);
        expect(keys.address).toBe(expectedPublicKeyBase58);
      });
    }
  });

  describe('Sign & Verify Round-Trip', () => {
    it('ED25519 alice: should sign and verify data', () => {
      const keys = ED25519_TEST_KEYS.alice;
      const privateKeyBytes = bs58.decode(keys.privateKey);
      const publicKeyBytes = bs58.decode(keys.address); // address = base58 pubkey
      
      const message = new TextEncoder().encode('test message');
      const signature = ed25519.sign(message, privateKeyBytes);
      const isValid = ed25519.verify(signature, message, publicKeyBytes);
      
      expect(isValid).toBe(true);
    });

    it('ED448 alice: should sign and verify data', () => {
      const keys = ED448_TEST_KEYS.alice;
      const privateKeyBytes = bs58.decode(keys.privateKey);
      
      // Use Ed448KeyPair to handle seed expansion
      const keyPair = new Ed448KeyPair(privateKeyBytes);
      const publicKeyBytes = keyPair.publicKey;
      
      const message = new TextEncoder().encode('test message');
      const signature = keyPair.sign(message);
      const isValid = keyPair.verify(signature, message);
      
      expect(isValid).toBe(true);
    });
  });
});
