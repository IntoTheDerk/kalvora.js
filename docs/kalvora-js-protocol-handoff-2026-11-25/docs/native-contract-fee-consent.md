# Native Send contract fee limits

Contract wallet send imports have matching `*_with_fee_limit` imports in both
`native_functions` and `native_functions_v2`. This includes `send`, `current_send`,
`delegate_send`, the derived wallet and multi-send forms, and the `send_all` forms.
Serialized `submit_txn` also has `submit_txn_with_fee_limit` in both modules.

Pass two additional `(pointer, length)` string pairs after the existing inputs:
the expected fee asset's contract ID and the maximum contract fee in that
asset's raw units. The legacy ABI's output pointer remains last; v2 continues
to use `output_copy`. A contract should choose these values from its own code
or state, with a maximum appropriate to the payout. The host rejects a
different quoted asset or a fee above the maximum before processing the child.
For a sweep, the maximum covers the sum of all attempted child fees.

Existing imports retain their signatures. They can send fee-free tokens, but
fee-bearing transfers return `FAILED: Contract fee not authorized`. Contracts
that intend to pay token contract fees must use the new imports. A serialized
CoinTXN submitted from a contract-owned wallet follows the same rule; a denied
legacy `submit_txn` traps the execution. User-wallet serialized CoinTXNs retain
their signed per-execution allowance checks. Network gas fees remain governed
by the root call's signed fee budget.
