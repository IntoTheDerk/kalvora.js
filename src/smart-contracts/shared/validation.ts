/**
 * Shared smart contract validation helpers.
 */

export function validateSmartContractName(smartContractName: string): void {
  if (!smartContractName) throw new Error('smartContractName is required');
}

export function validateSmartContractInstance(instance: number): void {
  if (!Number.isInteger(instance) || instance < 0 || instance > 0xFFFFFFFF) {
    throw new Error('instance must be an unsigned 32-bit integer');
  }
}
