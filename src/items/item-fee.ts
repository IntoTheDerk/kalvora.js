/**
 * Item-fee authorization.
 *
 * The node prices an item fee with the fee token's denomination and USD rate:
 * `parts = (denomination * item.contract_fees.fee) / rate`. A missing rate,
 * or the missing-schedule substitute `1`, is replaced with 10^18 ($1.00).
 */

const ONE_DOLLAR = 10n ** 18n;

export function itemFeeParts(
  itemFee: string,
  feeTokenDenomination: string,
  feeTokenRate: string | undefined
): string {
  if (!/^\d+$/u.test(itemFee) || !/^\d+$/u.test(feeTokenDenomination)) {
    throw new Error('item fee and fee-token denomination must be decimal uint256 strings');
  }
  const rate = feeTokenRate === undefined || feeTokenRate === '' || feeTokenRate === '0' || feeTokenRate === '1'
    ? ONE_DOLLAR
    : BigInt(feeTokenRate);
  if (rate <= 0n) {
    throw new Error('fee-token rate must be positive');
  }
  return ((BigInt(feeTokenDenomination) * BigInt(itemFee)) / rate).toString();
}
