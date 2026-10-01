import { describe, expect, it } from 'vitest';

import { itemContractDatabaseKey } from '../../query/keys.js';
import { itemFeeParts } from '../item-fee.js';

describe('item fees and item keys', () => {
  it('substitutes 10^18 when the rate is missing or 1', () => {
    expect(itemFeeParts('5', '1000000000', '1')).toBe('0');
    expect(itemFeeParts('1000000000000000000', '1000000000', undefined)).toBe('1000000000');
    expect(itemFeeParts('2', '10', '5')).toBe('4');
  });

  it('length-prefixes each component of an item database key', () => {
    const key = itemContractDatabaseKey('1', 'AB');
    const bytes = Uint8Array.from(key, ch => ch.charCodeAt(0));
    expect(Array.from(bytes)).toEqual([
      0, 0, 0, 1, 0x31,
      0, 0, 0, 2, 0x41, 0x42
    ]);
  });
});
