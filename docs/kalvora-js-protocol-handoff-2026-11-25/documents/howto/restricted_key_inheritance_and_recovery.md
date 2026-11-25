# Restricted-key inheritance and recovery

This guide is for developers creating or updating instrument and token
contracts. It describes permission inheritance through `restricted_keys`.
It does not describe smart-contract code inheritance or transaction nesting.
The clean-genesis rule requires each child that inherits from a parent to keep
its **own direct local `update_contract` recovery grant**.

## One parent and a 64-contract path

A grant with `public_key.parent_contract` names the existing canonical contract
ID that supplies the child's inherited permissions. A direct wallet grant uses
`public_key.wallet_address` and the desired action flags. A contract can grant
permission before the wallet registers. The signer can exercise it starting in
the block after its registration finalizes.
Only one such parent is allowed. A permission inherited through that link is
available only when the child link and every further parent link permit the
action. If the same signer has a direct entry on the child, that local entry
decides the action, including a direct denial.

The lookup accepts a path of up to **64 contract records**, counting the child
and every ancestor. For example, `Token -> Policy A -> Policy B` has three
records. A cycle, second parent, missing parent, path of 65 records, or more
than 50 restricted keys on a contract is rejected. The resolver also limits
work across the path. A path that exceeds these limits cannot authorize an
inherited action.

## Required recovery entry

When building a child with a parent, include at least one **direct**
restricted-key entry on the child with `update_contract = true`. The entry can
name a regular wallet address, an active governance authority, or a
deployed smart-contract authority. A recovery right inherited from the parent
does **not** satisfy this rule. The validator checks the identity when the
child is created or updated, including the projected result of accepted
same-block changes.

For a vote-controlled child, keep its recovery authority vote-controlled.
Use the canonical `gov_<contract ID>` identity of the child's active governance
or an existing external contract with active governance. A smart-contract
recovery authority uses canonical `sc_<name>_<instance>` identity with the
deployed master and instance present. Creating an external controller in the
same block does not satisfy the assignment check. The validator checks that
the controller exists and is active at assignment time; it cannot guarantee
that future votes, upgrades, or contract code will keep recovery callable.
Operators must maintain a usable recovery controller.

An update that retains a parent must retain a qualifying direct recovery
grant. A nonempty `restricted_keys` list on a contract update replaces the
stored list, so include **all** keys and the parent edge that should remain.
See [SDK feature requirements](sdk_feature_requirements.md) for the broader
contract builder rules.

## If an ancestor lengthens the path

An ancestor may change its own parent without every descendant's consent.
That can make a previously valid child's inherited path 65 records long. The
child then loses inherited permissions until the path is shortened. Its
direct local grants continue to resolve. In particular, its direct
`update_contract` authority can submit an update that removes or replaces the
parent edge with a shorter path. The protocol allows that direct updater to
remove an overdeep inherited edge even when the parent's key weight would
otherwise prevent removing that edge; other key-weight protections still
apply. No automatic detachment or new permission is created.

Before signing a creation or update, a client should display the selected
parent, the resulting path length, the direct recovery authority, and whether
that authority is a key, vote, or deployed contract. Keep a way to contact the
controller when a repair vote or contract call is needed. Test a signed repair
transaction on the intended chain before relying on a deep permission path.

The [security decision and verification record](../security/descendant_availability_policy_20261020.md)
describes the same-block, restart, distributed-replay, and controller-lifecycle
work that remains for release.
