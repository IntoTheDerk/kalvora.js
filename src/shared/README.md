# Shared Utilities

This module contains shared utilities used across the SDK.

## What it does

- Provides common validation functions
- Handles error management
- Manages configuration
- Performs cryptographic operations

## Key Components

### Validation (`utils/validation.ts`)
- Input validation for all SDK functions
- Type checking and format validation
- Amount and address validation

### Error Handling (`utils/error-handler.ts`)
- Standardized error creation
- Error context and severity
- Retry logic for network errors

### Configuration (`config/`)
- Environment-specific settings
- Network configuration
- Security settings

### Crypto (`crypto/`)
- Address utilities
- Signature generation
- Hash functions

### Fee Calculators (`fee-calculators/`)
- Transaction fee calculation
- Exchange rate handling
- Universal fee computation

## Usage

```typescript
import { InputValidator } from './utils/validation.js';
import { ErrorHandler } from './utils/error-handler.js';

// Validate input
const result = InputValidator.validateAmount('100.50');

// Handle errors
const error = ErrorHandler.createError('validation', 'Invalid input');
```

## Testing

Run tests with:
```bash
npm run test:shared
```
