# CoinTXN (Transactions)

This module handles coin transactions on the Kalvora network with comprehensive fee calculation, validation, and network submission capabilities.

## What it does

- Creates coin transactions with inputs and outputs
- Calculates fees automatically with exchange rate handling
- Handles nonce generation and validation
- Signs transactions with private keys
- Submits transactions to the Kalvora network
- Supports complex transaction flows (multi-input/output, allowances)

## Key Features

- **Balance Validation**: Ensures inputs match outputs exactly
- **Automatic Fee Calculation**: Smart fee computation with exchange rates
- **Manual Fee Override**: Full control when you need it
- **Nonce Management**: Automatic nonce retrieval from network
- **Transaction Signing**: Cryptographic signing with all required keys
- **Multi-Input/Output**: Support for complex transaction flows
- **Allowance Transactions**: Spend on behalf of others with proper authorization
- **Hash Generation**: Creates transaction hash for network submission

## Transaction Creation Process

1. **Input Processing**: Validates private keys, amounts, and fee percentages
2. **Output Processing**: Validates recipient addresses and amounts
3. **Nonce Retrieval**: Fetches current nonces
4. **Fee Calculation**: Automatic or manual fee computation
5. **Transaction Signing**: Cryptographic signing with all required keys
6. **Hash Generation**: Creates transaction hash for network submission

## Input/Output Structure

### Input Structure

```typescript
interface CoinTXNInput {
  privateKey?: string;      // Base58-encoded private key
  publicKey?: string;       // Public key identifier
  amount?: string;          // Human-readable amount (e.g., "10.5")
  feePercent?: string;      // Fee percentage (e.g., "100" for 100%)
  allowanceAddress?: string; // For allowance transactions
}
```

### Output Structure

```typescript
interface CoinTXNOutput {
  to: string;              // Recipient address
  amount: string;          // Human-readable amount
  memo?: string;           // Optional memo
}
```

## Basic Usage

```typescript
import { createCoinTXN, sendCoinTXN } from '<hosted location>';

// Define transaction input (who's sending)
const inputs = [{
  privateKey: 'sender-private-key',
  publicKey: 'sender-public-key',
  amount: '100.5',
  feePercent: '100'  // Pays 100% of transaction fees
}];

// Define transaction output (who's receiving)
const outputs = [{
  to: 'recipient-address',
  amount: '100.5',
  memo: 'Payment for goods'
}];

// Create transaction (fees calculated automatically)
const transaction = await createCoinTXN(
  inputs,
  outputs,
  'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'  // Contract ID
);

// Send to network
const txHash = await sendCoinTXN(transaction);
console.log('Transaction hash:', txHash);
```

## Advanced Usage

### Multi-Input Transactions

```typescript
// Multiple senders contributing to one transaction
const inputs = [
  {
    privateKey: 'alice-private-key',
    publicKey: 'alice-public-key',
    amount: '50.0',
    feePercent: '60'  // Alice pays 60% of fees
  },
  {
    privateKey: 'bob-private-key',
    publicKey: 'bob-public-key',
    amount: '50.0',
    feePercent: '40'  // Bob pays 40% of fees
  }
];

const outputs = [{
  to: 'recipient-address',
  amount: '100.0',
  memo: 'Joint payment from Alice and Bob'
}];

const transaction = await createCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
```

### Multi-Output Transactions

```typescript
// Single sender to multiple recipients
const inputs = [{
  privateKey: 'sender-private-key',
  publicKey: 'sender-public-key',
  amount: '100.0',
  feePercent: '100'
}];

const outputs = [
  {
    to: 'recipient1-address',
    amount: '40.0',
    memo: 'Payment to recipient 1'
  },
  {
    to: 'recipient2-address',
    amount: '35.0',
    memo: 'Payment to recipient 2'
  },
  {
    to: 'recipient3-address',
    amount: '25.0',
    memo: 'Payment to recipient 3'
  }
];

const transaction = await createCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
```

### Allowance Transactions

```typescript
// Alice spending Charlie's funds (with Charlie's authorization)
const inputs = [
  {
    privateKey: 'alice-private-key',
    publicKey: 'alice-public-key',
    feePercent: '100'  // Alice pays 100% of fees
  },
  {
    allowanceAddress: 'charlie-address',
    amount: '50.0'  // Charlie's funds being spent
  }
];

const outputs = [{
  to: 'recipient-address',
  amount: '50.0',
  memo: 'Allowance transfer from Charlie via Alice'
}];

const transaction = await createCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
```

### Custom Fee Configuration

```typescript
import type { FeeConfig } from '<hosted location>';

// Automatic fee calculation (recommended)
const autoFeeConfig: FeeConfig = {
  baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'
  // SDK calculates fees automatically
};

// Manual fee specification
const manualFeeConfig: FeeConfig = {
  baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  baseFee: '0.001',           // Base network fee
  contractFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  contractFee: '0.0005'       // Contract-specific fee
};

// With overestimation (adds safety margin)
const safeFeeConfig: FeeConfig = {
  baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  overestimatePercent: 10  // Add 10% to calculated fees (default: 5%)
};

const transaction = await createCoinTXN(
  inputs,
  outputs,
  'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  manualFeeConfig
);
```

### Transaction with Base Memo

```typescript
// Base memo applies to the entire transaction
const transaction = await createCoinTXN(
  inputs,
  outputs,
  'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  { baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao' },
  'Transaction memo for the entire transaction'
);
```

## Fee Calculation

### Automatic Fee Calculation

The SDK includes a sophisticated fee calculation system that automatically computes:
- **Base Network Fees**: Transaction size, key types, hash operations
- **Contract-Specific Fees**: Per-token fee structures
- **Interface Fees**: Third-party service fees
- **Exchange Rate Conversion**: Accurate fee calculations across different tokens
- **Overestimation**: Safety margins to prevent transaction failures

### Universal Fee Calculator

```typescript
import { UniversalFeeCalculator } from '<hosted location>';

// The fee calculator handles all fee types automatically
// - Base network fees
// - Contract-specific fees
// - Interface fees
// - Exchange rate conversion
// - Overestimation for safety margins
```

### Contract Fees

```typescript
// Contract fees are automatically fetched from the network
// and applied based on the token being used
const transaction = await createCoinTXN(
  inputs,
  outputs,
  'CUSTOM0001',  // Custom token with its own fee structure
  { baseFeeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao' }
);
```

## Error Handling

```typescript
import { 
  ValidationError, 
  NetworkError, 
  CryptoError, 
  TransactionError 
} from '<hosted location>';

try {
  const transaction = await createCoinTXN(inputs, outputs, 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao');
  const txHash = await sendCoinTXN(transaction);
  console.log('Transaction sent:', txHash);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Validation failed:', error.message);
  } else if (error instanceof NetworkError) {
    console.error('Network error:', error.message);
  } else if (error instanceof CryptoError) {
    console.error('Crypto error:', error.message);
  } else if (error instanceof TransactionError) {
    console.error('Transaction error:', error.message);
  } else {
    console.error('Unknown error:', error.message);
  }
}
```

## Examples

See [`examples/real-world-usage.ts`](./examples/real-world-usage.ts) for complete examples including:
- Simple transfers
- Multi-input/multi-output transactions
- Allowance transactions
- Custom fee configurations
- Error handling patterns

## API Reference

### createCoinTXN

```typescript
async function createCoinTXN(
  inputs: CoinTXNInput[],
  outputs: CoinTXNOutput[],
  contractId: string,
  feeConfig?: FeeConfig,
  baseMemo?: string,
  grpcConfig?: GRPCConfig
): Promise<CoinTXN>
```

### sendCoinTXN

```typescript
async function sendCoinTXN(
  coinTxn: CoinTXN,
  grpcConfig?: GRPCConfig
): Promise<string>
```

### FeeConfig

```typescript
interface FeeConfig {
  baseFeeId?: string;
  baseFee?: string;
  contractFeeId?: string;
  contractFee?: string;
  interfaceFeeId?: string;
  interfaceFee?: string;
  overestimatePercent?: number;
}
```

## Testing

Run tests with:
```bash
npm run test:coin-txn
```