import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import {
  GovernanceOptionTXNSSchema,
  GovernanceProposalSchema,
  GovernanceTXNSchema,
  TRANSACTION_TYPE
} from '../../../proto/generated/txn_pb.js';
import { UniversalFeeCalculator } from '../../shared/fee-calculators/universal-fee-calculator.js';
import {
  buildTextGovernanceProposalTXN,
  type BuildTextGovernanceProposalTXNOptions,
  type ProposalConstructionContext,
  type TextGovernanceProposalInput
} from '../transaction.js';

import vector from './fixtures/text-proposal-v1.json';

const input = vector.input as TextGovernanceProposalInput;
const constructionContext =
  vector.constructionContext as ProposalConstructionContext;
const deterministicOptions: BuildTextGovernanceProposalTXNOptions = {
  constructionContext,
  nonce: vector.base.nonce,
  timestamp: new Date(vector.base.timestamp),
  feeId: vector.base.feeId,
  feeAmountParts: vector.base.feeAmountParts
};

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-25T09:22:00.000Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

describe('buildTextGovernanceProposalTXN', () => {
  it('maps the v1 text-proposal test vector fields to stable unsigned protobuf bytes', async () => {
    const proposal = await buildTextGovernanceProposalTXN(
      input,
      vector.publicKey,
      deterministicOptions
    );
    const bytes = toBinary(GovernanceProposalSchema, proposal);

    expect(hex(bytes)).toBe(vector.expectedProtobufHex);
    expect(proposal.contractId).toBe(input.contractId);
    expect(proposal.title).toBe(input.title);
    expect(proposal.synopsis).toBe(input.synopsis);
    expect(proposal.body).toBe(input.body);
    expect(proposal.options).toEqual([]);
    expect(proposal.governanceTxn).toEqual([]);
    expect(proposal.governanceOptionTxns).toEqual([]);
    expect(proposal.startTimestamp).toBeUndefined();
    expect(proposal.endTimestamp).toBeUndefined();
    expect(proposal.base?.signature).toBeUndefined();
    expect(proposal.base?.hash).toBeUndefined();
  });

  it('round-trips field 10 while keeping every executable effect empty', async () => {
    const proposal = await buildTextGovernanceProposalTXN(
      input,
      vector.publicKey,
      deterministicOptions
    );
    const decoded = fromBinary(
      GovernanceProposalSchema,
      toBinary(GovernanceProposalSchema, proposal)
    );

    expect(decoded.governanceOptionTxns).toEqual([]);
    expect(decoded.governanceTxn).toEqual([]);
    expect(decoded.options).toEqual([]);
    expect(decoded.base?.signature).toBeUndefined();
    expect(decoded.base?.hash).toBeUndefined();
  });

  it('retains non-empty proposal field 10 in the generated wire schema', () => {
    const optionEffect = create(GovernanceOptionTXNSSchema, {
      optionIndex: 2,
      governanceTxn: [
        create(GovernanceTXNSchema, {
          txnType: TRANSACTION_TYPE.COIN_TYPE,
          serializedTxn: Uint8Array.of(1),
          txnHash: Uint8Array.of(2)
        })
      ]
    });
    const encoded = toBinary(
      GovernanceProposalSchema,
      create(GovernanceProposalSchema, {
        governanceOptionTxns: [optionEffect]
      })
    );
    const decoded = fromBinary(GovernanceProposalSchema, encoded);

    expect(decoded.governanceOptionTxns).toHaveLength(1);
    expect(decoded.governanceOptionTxns[0]?.optionIndex).toBe(2);
    expect(decoded.governanceOptionTxns[0]?.governanceTxn).toHaveLength(1);
    expect(encoded).toContain(0x52);
  });

  it.each(['contractId', 'title', 'synopsis', 'body'] as const)(
    'changes the serialized transaction when %s changes',
    async (field) => {
      const original = await buildTextGovernanceProposalTXN(
        input,
        vector.publicKey,
        deterministicOptions
      );
      const changedInput = {
        ...input,
        [field]:
          field === 'contractId'
            ? 'OTHER0000'
            : `${input[field]} changed`
      };
      const changedOptions =
        field === 'contractId'
          ? {
            ...deterministicOptions,
            constructionContext: {
              ...constructionContext,
              contractId: 'OTHER0000'
            }
          }
          : deterministicOptions;
      const changed = await buildTextGovernanceProposalTXN(
        changedInput,
        vector.publicKey,
        changedOptions
      );

      expect(hex(toBinary(GovernanceProposalSchema, changed))).not.toBe(
        hex(toBinary(GovernanceProposalSchema, original))
      );
    }
  );

  it.each(['adaptive', 'none', 'unknown'])(
    'rejects %s governance instead of inventing missing policy fields',
    async (governanceType) => {
      await expect(
        buildTextGovernanceProposalTXN(input, vector.publicKey, {
          ...deterministicOptions,
          constructionContext: {
            ...constructionContext,
            governanceType
          } as ProposalConstructionContext
        })
      ).rejects.toThrow(
        'text-only proposals require reviewed staged, cycle, or staggered governance'
      );
    }
  );

  it('rejects missing, mismatched, stale-shaped, or ineligible construction context', async () => {
    await expect(
      buildTextGovernanceProposalTXN(input, vector.publicKey, {} as BuildTextGovernanceProposalTXNOptions)
    ).rejects.toThrow('reviewed proposal construction context is required');
    await expect(
      buildTextGovernanceProposalTXN(input, vector.publicKey, {
        ...deterministicOptions,
        constructionContext: {
          ...constructionContext,
          contractId: 'OTHER0000'
        }
      })
    ).rejects.toThrow('does not match construction context');
    await expect(
      buildTextGovernanceProposalTXN(input, vector.publicKey, {
        ...deterministicOptions,
        constructionContext: {
          ...constructionContext,
          walletAddress: '8ffgHJD1aNbiYn5r8oP6bJtKW6vFcXFUizRJLCRQVX6H'
        }
      })
    ).rejects.toThrow('does not match construction context wallet');
    await expect(
      buildTextGovernanceProposalTXN(input, vector.publicKey, {
        ...deterministicOptions,
        constructionContext: {
          ...constructionContext,
          observedAt: 'yesterday'
        }
      })
    ).rejects.toThrow('canonical ISO timestamp');
    await expect(
      buildTextGovernanceProposalTXN(input, vector.publicKey, {
        ...deterministicOptions,
        constructionContext: {
          ...constructionContext,
          eligibleProposalInstrumentIds: []
        }
      })
    ).rejects.toThrow('eligible proposal instruments');
    await expect(
      buildTextGovernanceProposalTXN(input, vector.publicKey, {
        ...deterministicOptions,
        constructionContext: {
          ...constructionContext,
          policyVersion: 'future-policy'
        } as ProposalConstructionContext
      })
    ).rejects.toThrow('policy version is unsupported');
    await expect(
      buildTextGovernanceProposalTXN(input, vector.publicKey, {
        ...deterministicOptions,
        constructionContext: {
          ...constructionContext,
          expiresAt: '2026-07-25T09:00:00.000Z'
        }
      })
    ).rejects.toThrow('stale or has an invalid validity window');
  });

  it('rechecks context freshness after asynchronous fee work', async () => {
    const calculateFee = vi
      .spyOn(UniversalFeeCalculator, 'calculateFee')
      .mockImplementation(async (feeOptions) => {
        vi.setSystemTime(new Date('2026-07-25T09:26:00.000Z'));
        return feeOptions.protoObject;
      });
    try {
      const { feeAmountParts: _manualFee, ...automaticFeeOptions } =
        deterministicOptions;
      await expect(
        buildTextGovernanceProposalTXN(input, vector.publicKey, automaticFeeOptions)
      ).rejects.toThrow('stale or has an invalid validity window');
    } finally {
      calculateFee.mockRestore();
      vi.setSystemTime(new Date('2026-07-25T09:22:00.000Z'));
    }
  });

  it.each([
    ['contractId', 'not a contract'],
    ['contractId', '$-x+000000'],
    ['contractId', '$../../-evil+000000'],
    ['title', ''],
    ['title', ' title'],
    ['title', 'bad\u0000title'],
    ['title', 'e\u0301'],
    ['title', 'spoof\u202etext'],
    ['title', `bad${String.fromCharCode(0xd800)}text`],
    ['synopsis', 'line one\nline two'],
    ['body', 'bad\rbody']
  ] as const)('rejects non-canonical %s input', async (field, value) => {
    await expect(
      buildTextGovernanceProposalTXN(
        { ...input, [field]: value },
        vector.publicKey,
        deterministicOptions
      )
    ).rejects.toThrow();
  });

  it('rejects invalid deterministic base fields before producing bytes', async () => {
    await expect(
      buildTextGovernanceProposalTXN(input, vector.publicKey, {
        ...deterministicOptions,
        nonce: '-1'
      })
    ).rejects.toThrow('unsigned 64-bit integer');
    await expect(
      buildTextGovernanceProposalTXN(input, vector.publicKey, {
        ...deterministicOptions,
        feeAmountParts: '0'
      })
    ).rejects.toThrow('positive unsigned 256-bit integer string');
    await expect(
      buildTextGovernanceProposalTXN(input, 'A_'.padEnd(300, '1'), deterministicOptions)
    ).rejects.toThrow('bounded canonical text');
    await expect(
      buildTextGovernanceProposalTXN(input, 'A_1', {
        ...deterministicOptions,
        constructionContext: {
          ...constructionContext,
          walletAddress: '1'
        }
      })
    ).rejects.toThrow('exactly 32 decoded bytes');
    await expect(
      buildTextGovernanceProposalTXN(input, vector.publicKey, {
        ...deterministicOptions,
        feeAmountParts: '1'.repeat(79)
      })
    ).rejects.toThrow('unsigned 256-bit integer');
    await expect(
      buildTextGovernanceProposalTXN(input, vector.publicKey, {
        ...deterministicOptions,
        feeAmountParts: '9'.repeat(78)
      })
    ).rejects.toThrow('unsigned 256-bit integer');
    await expect(
      buildTextGovernanceProposalTXN(input, vector.publicKey, {
        ...deterministicOptions,
        timestamp: new Date(Number.NaN)
      })
    ).rejects.toThrow('valid protobuf Date');
    const preEpoch = await buildTextGovernanceProposalTXN(input, vector.publicKey, {
      ...deterministicOptions,
      timestamp: new Date('1960-01-01T00:00:00.123Z')
    });
    expect(preEpoch.base?.timestamp?.nanos).toBe(123000000);
  });
});
