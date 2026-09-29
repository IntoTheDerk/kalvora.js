import { describe, expect, it } from 'vitest';

import { InvalidMnemonicError } from '../errors.js';

describe('wallet creation error security', () => {
  it('does not retain mnemonic content in InvalidMnemonicError', () => {
    const mnemonic = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
    const error = new InvalidMnemonicError(mnemonic, 'checksum mismatch');

    expect(error.message).toContain('checksum mismatch');
    expect(error.details).toEqual({ reason: 'checksum mismatch' });
    expect(error.details).not.toHaveProperty('mnemonic');
    expect(JSON.stringify(error)).not.toContain('abandon');
    expect(JSON.stringify(error)).not.toContain(mnemonic);
  });
});
