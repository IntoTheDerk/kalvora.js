#include "registered_wallet.h"
#include "kal_wallet_address.h"
#include "transaction_unknown_fields.h"
#include <map>
#include <set>
#include <stdexcept>

namespace registered_wallet {
namespace {
constexpr std::string_view policy_domain = "KAL_WALLET_MULTISIG_V1";
constexpr char policy_tag = 3;

void u32(std::string& out, uint32_t value) {
    for (int shift = 24; shift >= 0; shift -= 8) out.push_back(static_cast<char>(value >> shift));
}
bool read_u32(std::string_view& input, uint32_t& value) {
    if (input.size() < 4) return false;
    value = 0;
    for (unsigned char byte : input.substr(0, 4)) value = (value << 8) | byte;
    input.remove_prefix(4);
    return true;
}
bool read_policy(std::string_view descriptor, kal_txn::WalletPolicy& policy, kal_txn::WalletHash& hash) {
    if (descriptor.size() > max_policy_bytes || descriptor.substr(0, policy_domain.size()) != policy_domain)
        return false;
    auto input = descriptor.substr(policy_domain.size());
    uint32_t version, hash_id, count;
    if (!read_u32(input, version) || version != 1 || !read_u32(input, hash_id) ||
        hash_id > kal_txn::WalletHash_MAX || !read_u32(input, count) || count > max_members)
        return false;
    hash = static_cast<kal_txn::WalletHash>(hash_id);
    for (uint32_t i = 0; i < count; ++i) {
        uint32_t id, len;
        if (!read_u32(input, id) || !read_u32(input, len) || len > input.size()) return false;
        auto* member = policy.add_members();
        member->set_class_id(id);
        member->set_wallet_address(input.data(), len);
        input.remove_prefix(len);
    }
    if (!read_u32(input, count) || count > max_patterns) return false;
    for (uint32_t i = 0; i < count; ++i) {
        uint32_t classes;
        if (!read_u32(input, classes) || classes > max_members) return false;
        auto* pattern = policy.add_patterns();
        for (uint32_t j = 0; j < classes; ++j) {
            uint32_t id, required;
            if (!read_u32(input, id) || !read_u32(input, required)) return false;
            auto* threshold = pattern->add_thresholds();
            threshold->set_class_id(id);
            threshold->set_required(required);
        }
    }
    return input.empty() && policy_descriptor(policy, hash) == descriptor;
}
bool verify_policy(const kal_txn::WalletPolicy& policy, const kal_txn::PublicKey& signer,
                   std::string_view message, const Lookup& parent, bool registering) {
    if (signer.witnesses_size() == 0 || signer.witnesses_size() > policy.members_size()) return false;
    std::set<std::string> underlying;
    std::map<uint32_t, unsigned> votes;
    int witness_index = 0;
    for (int slot = 0; slot < policy.members_size(); ++slot) {
        const auto& member = policy.members(slot);
        const bool signed_slot = witness_index < signer.witnesses_size() &&
            signer.witnesses(witness_index).slot() == static_cast<uint32_t>(slot);
        if (!registering && !signed_slot) continue;
        const auto row = parent(member.wallet_address());
        if (!row) return false;
        if (!row->empty() && row->front() == policy_tag) return false;
        kal_txn::FalconPublicKey key;
        if (!falcon_wallet::read_key(*row, key)) throw std::runtime_error("Invalid registered Falcon key");
        if (registering && !underlying.insert(*row).second) return false;
        if (signed_slot) {
            const auto& witness = signer.witnesses(witness_index++);
            if (!falcon_wallet::verify(key.variant(), key.raw_public_key(), message, witness.signature())) return false;
            ++votes[member.class_id()];
        }
    }
    if (witness_index != signer.witnesses_size()) return false;
    for (const auto& pattern : policy.patterns()) {
        bool passed = true;
        for (const auto& t : pattern.thresholds())
            if (votes[t.class_id()] < t.required()) { passed = false; break; }
        if (passed) return true;
    }
    return false;
}
bool verify_key_row(const std::string& row, std::string_view message, std::string_view signature) {
    kal_txn::FalconPublicKey key;
    if (!falcon_wallet::read_key(row, key)) throw std::runtime_error("Invalid registered Falcon key");
    return falcon_wallet::verify(key.variant(), key.raw_public_key(), message, signature);
}
}

bool address_identity(const kal_txn::PublicKey& id) {
    return id.has_wallet_address() && kal_wallet_address::valid_raw(id.wallet_address()) &&
        id.single().empty() && !id.has_multi() && !id.has_governance_auth() && !id.has_smart_contract_auth() && !id.has_parent_contract() &&
        static_cast<size_t>(id.witnesses_size()) <= max_members;
}

std::string policy_descriptor(const kal_txn::WalletPolicy& policy, kal_txn::WalletHash hash) {
    if (hash == kal_txn::WALLET_HASH_UNSPECIFIED || !kal_txn::WalletHash_IsValid(hash) ||
        !policy.members_size() || static_cast<size_t>(policy.members_size()) > max_members ||
        !policy.patterns_size() || static_cast<size_t>(policy.patterns_size()) > max_patterns ||
        policy.ByteSizeLong() > max_policy_bytes ||
        kalvora::has_unknown_fields_recursive(policy)) return {};
    std::string out(policy_domain);
    u32(out, 1);
    u32(out, hash);
    u32(out, policy.members_size());
    std::map<uint32_t, uint32_t> classes;
    std::set<std::string_view> addresses;
    for (const auto& member : policy.members()) {
        if (!kal_wallet_address::valid_raw(member.wallet_address()) ||
            !addresses.insert(member.wallet_address()).second) return {};
        ++classes[member.class_id()];
        u32(out, member.class_id());
        u32(out, member.wallet_address().size());
        out.append(member.wallet_address());
    }
    u32(out, policy.patterns_size());
    for (const auto& pattern : policy.patterns()) {
        if (!pattern.thresholds_size() || static_cast<size_t>(pattern.thresholds_size()) > max_members) return {};
        u32(out, pattern.thresholds_size());
        bool requires_vote = false;
        std::set<uint32_t> seen;
        for (const auto& t : pattern.thresholds()) {
            if (!classes.count(t.class_id()) || t.required() > classes.at(t.class_id()) ||
                !seen.insert(t.class_id()).second) return {};
            requires_vote |= t.required() > 0;
            u32(out, t.class_id());
            u32(out, t.required());
        }
        if (!requires_vote) return {};
    }
    return out.size() <= max_policy_bytes ? out : std::string{};
}

std::string policy_address(const kal_txn::WalletPolicy& policy, kal_txn::WalletHash hash) {
    const auto descriptor = policy_descriptor(policy, hash);
    return descriptor.empty() ? std::string{} : falcon_wallet::digest(hash, descriptor);
}

bool read_policy_record(std::string_view row, kal_txn::WalletPolicy& policy, kal_txn::WalletHash& hash) {
    if (row.empty() || row.front() != policy_tag) return false;
    kal_txn::WalletPolicy parsed;
    if (!read_policy(row.substr(1), parsed, hash)) return false;
    policy.Swap(&parsed);
    return true;
}

bool verify_single(const kal_txn::PublicKey& signer, std::string_view signature,
                   std::string_view message, const Lookup& parent) {
    if (!address_identity(signer) || signer.witnesses_size()) return false;
    const auto row = parent(signer.wallet_address());
    if (!row || (!row->empty() && row->front() == policy_tag)) return false;
    return verify_key_row(*row, message, signature);
}

bool verify(const kal_txn::PublicKey& signer, std::string_view signature,
            std::string_view message, const Lookup& parent) {
    if (!address_identity(signer)) return false;
    const auto row = parent(signer.wallet_address());
    if (!row) return false;
    if (!row->empty() && row->front() == policy_tag) {
        if (!signature.empty()) return false;
        kal_txn::WalletPolicy policy;
        kal_txn::WalletHash hash;
        if (!read_policy(std::string_view(*row).substr(1), policy, hash))
            throw std::runtime_error("Invalid registered wallet policy");
        return verify_policy(policy, signer, message, parent, false);
    }
    return !signer.witnesses_size() && verify_key_row(*row, message, signature);
}

std::optional<std::string> registration(const kal_txn::WalletRegistration& txn, const Lookup& parent) {
    const auto& id = txn.base().public_key();
    if (!address_identity(id) || !txn.base().nonce() ||
        kalvora::has_unknown_fields_recursive(txn)) return std::nullopt;
    if (txn.has_falcon()) {
        if (id.witnesses_size() || falcon_wallet::address(txn.falcon(), txn.wallet_hash()) != id.wallet_address() ||
            !falcon_wallet::verify(txn.falcon().variant(), txn.falcon().raw_public_key(), owner_message(txn),
                                   txn.base().signature())) return std::nullopt;
        return falcon_wallet::key_record(txn.falcon());
    }
    if (txn.has_policy() && !txn.base().has_signature()) {
        auto descriptor = policy_descriptor(txn.policy(), txn.wallet_hash());
        if (!descriptor.empty() && falcon_wallet::digest(txn.wallet_hash(), descriptor) == id.wallet_address() &&
            verify_policy(txn.policy(), id, owner_message(txn), parent, true))
            return policy_tag + descriptor;
    }
    return std::nullopt;
}
}
