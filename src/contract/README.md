# Instrument contracts

`buildContractTXN` creates an unsigned `InstrumentContract` and
`buildContractUpdateTXN` creates an unsigned `ContractUpdateTXN`. Their
`create` counterparts also sign, and their `send` counterparts submit the
signed message.

Clean genesis retires `quashThreshold` and the restricted-key properties
`timeDelay`, `global`, and `quash`. These builders reject old options before
protobuf creation can discard them. Quash transactions are no longer part of
the SDK. Governance `REMOVE` is also rejected while the network's consensus
gate disables it.

Governance participation `threshold` and `regularQuorum` both use basis
points: `10000` means 100%. `convertPercentToThreshold(0.25)` returns `25`.
For percentage contract fees, the `fee` field uses `1000000000000000000`
for 100%, while `burn` and `validator` take whole percentages such as
`"10"`. Their combined value must be at most 100.

An inherited restricted-key configuration must retain the child's local
`updateContract` recovery grant, or an active vote controller for a
vote-controlled child. The network resolves inheritance through one parent
and at most 64 contract records.
