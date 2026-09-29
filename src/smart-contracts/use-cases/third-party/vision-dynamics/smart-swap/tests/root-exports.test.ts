import { describe, expect, it } from 'vitest';

import {
  buildCoinTXN,
  buildVoteTXN,
  createSmartSwap,
  sendCoinTXN,
  sendVoteTXN,
  smartSwap
} from '../../../../../../../index.js';

describe('kalvora.js root consumer exports', () => {
  it('exports transaction lifecycle functions without deep dist imports', () => {
    expect(buildCoinTXN).toBeTypeOf('function');
    expect(sendCoinTXN).toBeTypeOf('function');
    expect(buildVoteTXN).toBeTypeOf('function');
    expect(sendVoteTXN).toBeTypeOf('function');
  });

  it('exports Smart Swap as named and namespace APIs', () => {
    expect(createSmartSwap).toBeTypeOf('function');
    expect(smartSwap.createSmartSwap).toBe(createSmartSwap);
  });
});
