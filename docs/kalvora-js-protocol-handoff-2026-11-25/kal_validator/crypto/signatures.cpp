#include "kal_wallet_address.h"
// Standard library headers
#include <vector>
#include "registered_wallet.h"
#include "wallet_registry.h"
#include <stdexcept>
#include <iostream>
#include <regex>
#include <sstream>
#include <map>
#include <set>
#include <memory>

// Third-party library headers
#include <sodium.h>
#include <openssl/evp.h>
#include <openssl/x509.h>
#include <openssl/err.h>

// Project-specific headers
#include "signatures.h"
#include "metered_signature_verification.h"
#include "validator.pb.h"
// #include "db_wallets.h"
#include "db_base.h"
#include "test.h"
#include "wallets.h"
#include "wallet.pb.h"
#include "base58.h"
#include "hex_conversion.h"
#include "validators.h"
#include "../logging/logging.h"
#include "kal_api.pb.h"
#include "fee_payer.h"
#include "governance_coin_auth.h"
#include "transaction_signature_context.h"
#include "auth_resource_limits.h"

namespace
{

    std::string_view byte_view(const std::vector<uint8_t>& bytes)
    {
        return {reinterpret_cast<const char*>(bytes.data()), bytes.size()};
    }

    std::string sign_message(const std::vector<uint8_t>& message, const KeyPair& key_pair)
    {
        return falcon_wallet::sign(falcon_wallet::variant(byte_view(key_pair.public_key)),
                                   key_pair.private_key, byte_view(message));
    }

    bool verify_signature(const std::vector<uint8_t>& message, const std::vector<uint8_t>& signature,
                          const std::vector<uint8_t>& address,
                          const std::function<bool(KeyType)>* before_verify = nullptr)
    {
        if (address.empty() || signature.empty()) return false;
        const auto record = wallet_registry::parent(std::string(address.begin(), address.end()));
        if (!record) return false;
        kal_txn::FalconPublicKey key;
        if (!falcon_wallet::read_key(*record, key)) return false;
        const auto type = key.variant() == kal_txn::FALCON_512 ? KeyType::FALCON_512 : KeyType::FALCON_1024;
        return (!before_verify || (*before_verify)(type)) &&
               falcon_wallet::verify(key.variant(), key.raw_public_key(), byte_view(message), byte_view(signature));
    }
    template <typename TXType>
    bool verify_fee_payer(TXType &tx)
    {
        return registered_wallet::verify_sponsor(tx, wallet_registry::parent);
    }

    std::string coin_signing_message(kal_txn::CoinTXN txn)
    {
        txn.mutable_base()->clear_hash();
        txn.mutable_base()->clear_fee_payer();
        txn.mutable_auth()->clear_signature();
        for (auto& signer : *txn.mutable_auth()->mutable_public_key())
            signer.clear_witnesses();
        return txn.SerializeAsString();
    }
}

int signatures::get_key_size(const KeyType &key_type)
{
    switch (key_type)
    {
    case KeyType::FALCON_512: return 897;
    case KeyType::FALCON_1024: return 1793;
    default:
        return 0;
    }
}
std::string signatures::wallet_address(const KeyPair& signer)
{
    const auto raw = byte_view(signer.public_key);
    if (falcon_wallet::variant(raw) == kal_txn::FALCON_UNSPECIFIED) return {};
    return falcon_wallet::digest(signer.wallet_hash, raw);
}
bool signatures::is_valid_public_key(const std::string &public_key)
{
    return falcon_wallet::variant(public_key) != kal_txn::FALCON_UNSPECIFIED;
}
bool signatures::is_canonical_public_key(const std::string &public_key)
{
    return is_valid_public_key(public_key);
}
KeyType signatures::get_key_type(const std::string &public_key, bool restricted)
{
    switch (falcon_wallet::variant(public_key)) {
    case kal_txn::FALCON_512: return KeyType::FALCON_512;
    case kal_txn::FALCON_1024: return KeyType::FALCON_1024;
    default: return KeyType::ERROR_TYPE;
    }
}
// ##################################################
//                   SIGNING
// ##################################################

void signatures::sign_block_proposer(kal_validator::Block *block, KeyPair key_pair)
{
    kal_validator::BlockHeader *block_header = block->mutable_block_header();
    block_header->mutable_public_key()->set_wallet_address(signatures::wallet_address(key_pair));
    std::string message_str = block->SerializeAsString();
    std::vector<uint8_t> message(message_str.begin(), message_str.end());
    std::string signature = sign_message(message, key_pair);
    block_header->set_signature(signature);
}
void signatures::sign_block_broadcast(kal_validator::Block *block, KeyPair key_pair)
{
    // clear_* instead of release_*: release transfers ownership of the heap string
    // to the caller, and discarding the pointer leaks it. Wire bytes are identical.
    block->clear_public_key();
    block->clear_signature();
    block->mutable_public_key()->set_wallet_address(signatures::wallet_address(key_pair));
    std::string message_str = block->SerializeAsString();
    std::vector<uint8_t> message(message_str.begin(), message_str.end());
    std::string signature = sign_message(message, key_pair);
    block->set_signature(signature);
}

void signatures::sign_instrument_contract(kal_txn::InstrumentContract *ctxn, KeyPair key_pair)
{
    if (!transaction_signature_context::bind_for_signing(*ctxn))
        throw std::runtime_error("Contract signer has no trusted matching chain/type context");
    std::string message_str = ctxn->SerializeAsString();
    std::vector<uint8_t> message(message_str.begin(), message_str.end());
    std::string signature = sign_message(message, key_pair);
    kal_txn::BaseTXN *base = ctxn->mutable_base();
    base->set_signature(signature);
}

template <typename TXType>
void signatures::sign_request(TXType *txn, KeyPair key_pair)
{
    std::string message_str = txn->SerializeAsString();
    std::vector<uint8_t> message(message_str.begin(), message_str.end());
    std::string signature = sign_message(message, key_pair);
    txn->set_signature(signature);
}
template void signatures::sign_request<kal_validator::BlockBatch>(kal_validator::BlockBatch *, KeyPair);
template void signatures::sign_request<kal_validator::Block>(kal_validator::Block *, KeyPair);
template void signatures::sign_request<kal_validator::ValidatorSync>(kal_validator::ValidatorSync *, KeyPair);
template void signatures::sign_request<kal_validator::ValidatorSyncRequest>(kal_validator::ValidatorSyncRequest *, KeyPair);
template void signatures::sign_request<kal_validator::BlockSync>(kal_validator::BlockSync *, KeyPair);
template void signatures::sign_request<kal_validator::BlockAttestation>(kal_validator::BlockAttestation *, KeyPair);
template void signatures::sign_request<kal_validator::CheckpointInfoRequest>(kal_validator::CheckpointInfoRequest *, KeyPair);
template void signatures::sign_request<kal_validator::CheckpointRequest>(kal_validator::CheckpointRequest *, KeyPair);

void signatures::sign_new_coin_txn(kal_txn::CoinTXN *txn, std::vector<KeyPair> key_pairs)
{
    if (txn->base().has_fee_payer() || key_pairs.size() != static_cast<size_t>(txn->auth().public_key_size()))
        throw std::invalid_argument("Coin signing requires one key per input authorization");
    for (size_t i = 0; i < key_pairs.size(); ++i) {
        const auto& id = txn->auth().public_key(static_cast<int>(i));
        if (!registered_wallet::address_identity(id) || id.witnesses_size() ||
            id.wallet_address() != wallet_address(key_pairs[i]))
            throw std::invalid_argument("Coin signing key does not match its wallet address");
    }
    if (!transaction_signature_context::bind_for_signing(*txn))
        throw std::runtime_error("Coin signer has no trusted matching chain/type context");
    const auto bytes = coin_signing_message(*txn);
    const std::vector<uint8_t> message(bytes.begin(), bytes.end());
    google::protobuf::RepeatedPtrField<std::string> signatures;
    for (const auto& kp : key_pairs)
        *signatures.Add() = sign_message(message, kp);
    txn->mutable_base()->clear_hash();
    txn->mutable_auth()->mutable_signature()->Swap(&signatures);
}

template <typename TXType>
void signatures::sign_txns(TXType *txn, KeyPair key_pair)
{
    if (!transaction_signature_context::bind_for_signing(*txn))
        throw std::runtime_error("Signer has no trusted matching chain/type context");
    if constexpr (std::is_same_v<TXType, kal_txn::ValidatorRegistration>)
        txn->clear_generated_signature();
    auto* base = txn->mutable_base();
    if (base->public_key().witnesses_size())
        throw std::invalid_argument("A policy wallet requires member witnesses");
    base->clear_hash();
    if (base->has_fee_payer()) base->mutable_fee_payer()->clear_signature();
    const auto bytes = registered_wallet::owner_message(*txn);
    base->set_signature(sign_message({bytes.begin(), bytes.end()}, key_pair));
}
template void signatures::sign_txns<kal_txn::ValidatorRegistration>(kal_txn::ValidatorRegistration *, KeyPair);
template void signatures::sign_txns<kal_txn::ValidatorHeartbeat>(kal_txn::ValidatorHeartbeat *, KeyPair);
template void signatures::sign_txns<kal_txn::ProposalCancelTXN>(kal_txn::ProposalCancelTXN *, KeyPair);
template void signatures::sign_txns<kal_txn::WalletRegistration>(kal_txn::WalletRegistration *, KeyPair);
template void signatures::sign_txns<kal_txn::ProposalResult>(kal_txn::ProposalResult *, KeyPair);
template void signatures::sign_txns<kal_txn::SmartContractTXN>(kal_txn::SmartContractTXN *, KeyPair);

template <typename TXType>
void signatures::sign_fee_payer(TXType *txn, KeyPair key_pair)
{
    if (!transaction_signature_context::matches(*txn))
        throw std::runtime_error("Sponsor refuses an unbound or wrong-chain transaction");
    // Sponsor signs the user-signed txn with base.hash and fee_payer.signature absent,
    // but the user's signature and the sponsor's public key + nonce present.
    kal_txn::BaseTXN *base = txn->mutable_base();
    base->clear_hash();
    base->mutable_fee_payer()->clear_signature();

    std::string message_str = txn->SerializeAsString();
    std::vector<uint8_t> message(message_str.begin(), message_str.end());
    std::string signature = sign_message(message, key_pair);
    base->mutable_fee_payer()->set_signature(signature);
}
// Instantiated for every type in the fee_payer allowlist (fee_payer.h).
template void signatures::sign_fee_payer<kal_txn::GovernanceVote>(kal_txn::GovernanceVote *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::GovernanceProposal>(kal_txn::GovernanceProposal *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::ProposalCancelTXN>(kal_txn::ProposalCancelTXN *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::WalletRegistration>(kal_txn::WalletRegistration *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::DelegatedTXN>(kal_txn::DelegatedTXN *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::NFTTXN>(kal_txn::NFTTXN *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::MintTXN>(kal_txn::MintTXN *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::ItemizedMintTXN>(kal_txn::ItemizedMintTXN *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::BurnSBTTXN>(kal_txn::BurnSBTTXN *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::InstrumentContract>(kal_txn::InstrumentContract *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::ContractUpdateTXN>(kal_txn::ContractUpdateTXN *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::ExpenseRatioTXN>(kal_txn::ExpenseRatioTXN *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::RevokeTXN>(kal_txn::RevokeTXN *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::ComplianceTXN>(kal_txn::ComplianceTXN *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::AllowanceTXN>(kal_txn::AllowanceTXN *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::SmartContractTXN>(kal_txn::SmartContractTXN *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::SmartContractInstantiateTXN>(kal_txn::SmartContractInstantiateTXN *, KeyPair);
template void signatures::sign_fee_payer<kal_txn::SmartContractExecuteTXN>(kal_txn::SmartContractExecuteTXN *, KeyPair);

// ##################################################
//                   VERIFYING
// ##################################################
bool signatures::verify_multi(const std::string &public_key, const std::string &signature, const std::string &message)
{
    if (!kal_wallet_address::valid_raw(public_key) || (signature.size() != 666 && signature.size() != 1280)) return false;
    try
    {
        std::vector<uint8_t> public_key_vec(public_key.begin(), public_key.end());
        std::vector<uint8_t> signature_vec(signature.begin(), signature.end());
        std::vector<uint8_t> message_vec(message.begin(), message.end());
        return verify_signature(message_vec, signature_vec, public_key_vec);
    }
    catch (...)
    {
        return false;
    }
}

template <typename TXType>
bool signatures::verify_txns(TXType &tx)
{
    if (!auth_resources::check(tx)) return false;
    try
    {
        if (!transaction_signature_context::matches(tx))
            return false;
        // Third-party fee payer: only allowed on allowlisted txn types (see fee_payer.h).
        // When present, verify the sponsor signature over the user-signed txn first.
        if (tx.base().has_fee_payer())
        {
            if (!fee_payer::type_allowed<TXType>())
            {
                logging::print("verify_txns: fee_payer not permitted for this txn type");
                return false;
            }
            if (!verify_fee_payer(tx))
            {
                return false;
            }
        }

        if constexpr (std::is_same_v<TXType, kal_txn::WalletRegistration>) {
            return registered_wallet::registration(tx, wallet_registry::parent).has_value();
        }
        if (tx.base().public_key().witnesses_size() && tx.base().has_signature()) return false;
        return registered_wallet::verify(tx.base().public_key(), tx.base().signature(),
                                         registered_wallet::owner_message(tx), wallet_registry::parent);
    }
    catch (const wallet_registry::StateError&) { throw; }
    catch (...)
    {
        logging::print("verify_txns 3");
        return false;
    }
}
template bool signatures::verify_txns<kal_txn::GovernanceProposal>(kal_txn::GovernanceProposal &);
template bool signatures::verify_txns<kal_txn::WalletRegistration>(kal_txn::WalletRegistration &);
template bool signatures::verify_txns<kal_txn::GovernanceVote>(kal_txn::GovernanceVote &);
template bool signatures::verify_txns<kal_txn::NFTTXN>(kal_txn::NFTTXN &);
template bool signatures::verify_txns<kal_txn::MintTXN>(kal_txn::MintTXN &);
template bool signatures::verify_txns<kal_txn::ItemizedMintTXN>(kal_txn::ItemizedMintTXN &);
template bool signatures::verify_txns<kal_txn::InstrumentContract>(kal_txn::InstrumentContract &);
template bool signatures::verify_txns<kal_txn::SmartContractTXN>(kal_txn::SmartContractTXN &);
template bool signatures::verify_txns<kal_txn::SmartContractExecuteTXN>(kal_txn::SmartContractExecuteTXN &);
template bool signatures::verify_txns<kal_txn::ExpenseRatioTXN>(kal_txn::ExpenseRatioTXN &);
template bool signatures::verify_txns<kal_txn::ContractUpdateTXN>(kal_txn::ContractUpdateTXN &);
template bool signatures::verify_txns<kal_txn::ValidatorHeartbeat>(kal_txn::ValidatorHeartbeat &);
template bool signatures::verify_txns<kal_txn::DelegatedTXN>(kal_txn::DelegatedTXN &);
template bool signatures::verify_txns<kal_txn::RevokeTXN>(kal_txn::RevokeTXN &);
template bool signatures::verify_txns<kal_txn::ComplianceTXN>(kal_txn::ComplianceTXN &);
template bool signatures::verify_txns<kal_txn::BurnSBTTXN>(kal_txn::BurnSBTTXN &);
template bool signatures::verify_txns<kal_txn::SmartContractInstantiateTXN>(kal_txn::SmartContractInstantiateTXN &);
template bool signatures::verify_txns<kal_txn::RequiredVersion>(kal_txn::RequiredVersion &);
template bool signatures::verify_txns<kal_txn::AllowanceTXN>(kal_txn::AllowanceTXN &);
template bool signatures::verify_txns<kal_txn::ProposalCancelTXN>(kal_txn::ProposalCancelTXN &);
template bool signatures::verify_txns<kal_txn::ProposalResult>(kal_txn::ProposalResult &);

template <>
bool signatures::verify_txns<kal_txn::ValidatorRegistration>(kal_txn::ValidatorRegistration &tx)
{
    if (!auth_resources::check(tx) || !transaction_signature_context::matches(tx) || tx.base().has_fee_payer())
        return false;
    const auto& owner = tx.base().public_key();
    if (!registered_wallet::address_identity(owner) || owner.witnesses_size() ||
        owner.SerializeAsString() != tx.validator().public_key().SerializeAsString()) return false;
    auto unsigned_tx = tx;
    unsigned_tx.clear_generated_signature();
    const auto message = registered_wallet::owner_message(unsigned_tx);
    if (!registered_wallet::verify_single(owner, tx.base().signature(), message, wallet_registry::parent)) return false;
    if (!tx.register_()) return !tx.has_generated_public_key() && tx.generated_signature().empty();
    const auto& operator_id = tx.generated_public_key();
    if (!registered_wallet::verify_single(operator_id, tx.generated_signature(), message, wallet_registry::parent)) return false;
    // A second digest of the same underlying key cannot provide custody separation.
    return wallet_registry::parent(owner.wallet_address()) != wallet_registry::parent(operator_id.wallet_address());
}

namespace
{
bool verify_coin_debits(const kal_txn::CoinTXN &tx, const std::string *governance_auth)
{
    if (!auth_resources::check(tx)) return false;
    try
    {
        // A fee payer is not allowed on CoinTXN: fees are split across its inputs, so a
        // sponsor is expressed as an extra zero-output input instead.
        if (tx.base().has_fee_payer())
        {
            logging::print("CoinTXN: fee_payer not permitted");
            return false;
        }

        const bool unsigned_governance_only = governance_auth != nullptr &&
                                              tx.auth().signature_size() == 0;
        if (!unsigned_governance_only &&
            !transaction_signature_context::matches(tx))
            return false;
        if ((!unsigned_governance_only && tx.auth().public_key_size() != tx.auth().signature_size()) ||
            tx.auth().public_key_size() != tx.auth().nonce_size())
        {
            logging::print("public key size (" + std::to_string(tx.auth().public_key_size()) + ") does not match signature size (" + std::to_string(tx.auth().signature_size()) + ") or nonce size (" + std::to_string(tx.auth().nonce_size()) + ")");
            return false;
        }

        if (tx.auth().public_key_size() == 0)
        {
            logging::print("CoinTXN: no authorization keys");
            return false;
        }

        // A governance child can debit its own authority wallet without a
        // signature, but cannot use an allowance or let the same exemption
        // cover any ordinary-wallet input. Ordinary CoinTXNs retain the exact
        // pre-existing signature contract.
        if (governance_auth != nullptr &&
            (tx.auth().public_key_size() != tx.input_transfers_size() ||
             tx.auth().allowance_address_size() != 0 ||
             tx.auth().allowance_nonce_size() != 0))
            return false;

        // Build the ONE canonical message every signer signs: the txn with
        // base.hash, base.fee_payer, every OUTER auth signature and every
        // multisig INNER signature cleared. Excluding all signatures makes the
        // message well-defined and identical for every slot (single or multisig
        // sub-signer).
        const auto message_str = coin_signing_message(tx);

        // Verify each authorization slot against EXACTLY its own key descriptor,
        // signature and message. The debited wallet is derived from
        // auth.public_key(i) (validate_wallets / process_transfers /
        // balance_tracker), so binding verification to that same descriptor
        // closes the base/auth key confusion (C-02 variant A).
        bool saw_governance_input = false;
        for (int i = 0; i < tx.auth().public_key_size(); i++)
        {
            const kal_txn::PublicKey &public_key = tx.auth().public_key(i);

            if (governance_auth != nullptr && public_key.has_governance_auth() &&
                public_key.governance_auth() == *governance_auth &&
                auth_resources::public_key(public_key))
            {
                if (!unsigned_governance_only && !tx.auth().signature(i).empty())
                    return false;
                saw_governance_input = true;
                continue;
            }
            if ((governance_auth != nullptr &&
                 (public_key.has_governance_auth() || public_key.has_smart_contract_auth())) ||
                unsigned_governance_only)
                return false;

            if (!registered_wallet::verify(public_key, tx.auth().signature(i), message_str, wallet_registry::parent))
                return false;
        }

        return governance_auth == nullptr || saw_governance_input;
    }
    catch (const wallet_registry::StateError&) { throw; }
    catch (...)
    {
        return false;
    }
}
} // namespace

template <>
bool signatures::verify_txns<kal_txn::CoinTXN>(kal_txn::CoinTXN &tx)
{
    return verify_coin_debits(tx, nullptr);
}

bool signatures::verify_governance_coin_debits(const kal_txn::CoinTXN &tx)
{
    if (!tx.base().public_key().has_governance_auth() ||
        tx.base().public_key().governance_auth().empty())
        return false;
    return verify_coin_debits(tx, &tx.base().public_key().governance_auth());
}

template <typename TXType>
bool signatures::verify_request(TXType &txn)
{
    if (!auth_resources::check(txn) || !registered_wallet::address_identity(txn.public_key()) ||
        txn.public_key().witnesses_size()) return false;
    try
    {
        std::string pub_key_str = wallets::get_public_key_string(txn.public_key());
        std::vector<uint8_t> public_key(pub_key_str.begin(), pub_key_str.end());
        TXType copy;
        copy.CopyFrom(txn);

        // Copy + clear instead of release_signature(): release returns nullptr when
        // the field is unset, and a null dereference is a segfault the surrounding
        // try/catch cannot catch. An empty signature simply fails verification below.
        std::string signature_value = copy.signature();
        copy.clear_signature();
        std::string message_str = copy.SerializeAsString();
        std::vector<uint8_t> signature(signature_value.begin(), signature_value.end());
        std::vector<uint8_t> message(message_str.begin(), message_str.end());

        return verify_signature(message, signature, public_key);
    }
    catch (...)
    {
        return false;
    }
}
template bool signatures::verify_request<kal_validator::BlockSync>(kal_validator::BlockSync &);
template bool signatures::verify_request<kal_validator::ValidatorSyncRequest>(kal_validator::ValidatorSyncRequest &);
template bool signatures::verify_request<kal_validator::ValidatorSync>(kal_validator::ValidatorSync &);
template bool signatures::verify_request<kal_validator::BlockAttestation>(kal_validator::BlockAttestation &);
template bool signatures::verify_request<kal_validator::BlockAttestationResponse>(kal_validator::BlockAttestationResponse &);
template bool signatures::verify_request<kal_validator::BlockBatch>(kal_validator::BlockBatch &);

KalStatus signatures::verify_block_batch(kal_validator::BlockBatch &block_batch)
{
    if (!auth_resources::check(block_batch))
        return KalStatus(KalStatus::Code::BLOCK_FAULTY_TXN, "Block batch exceeds auth resource limits");
    std::string pub_key_str = wallets::get_public_key_string(block_batch.public_key());
    std::vector<uint8_t> public_key(pub_key_str.begin(), pub_key_str.end());
    kal_validator::BlockBatch batch_copy;
    batch_copy.CopyFrom(block_batch);
    std::string signature_value = batch_copy.signature();
    batch_copy.clear_signature();
    std::string message_str = batch_copy.SerializeAsString();
    std::vector<uint8_t> signature(signature_value.begin(), signature_value.end());
    std::vector<uint8_t> message(message_str.begin(), message_str.end());

    if (!verify_signature(message, signature, public_key))
        return KalStatus(KalStatus::Code::SIGNATURE_ERROR, "signatures.cpp: verify_block_batch: Failed to verify Block Batch signature");

    for (auto tmp_block : block_batch.blocks())
    {
        KalStatus status = verify_block(tmp_block);
        if (!status.ok())
        {
            status.prepend_message("verify_block_batch");
            return status;
        }
    }

    return KalStatus(KalStatus::Code::OK);
}
KalStatus signatures::verify_block_validator(kal_validator::Block &block)
{
    if (!auth_resources::check(block))
        return KalStatus(KalStatus::Code::BLOCK_FAULTY_TXN, "Block exceeds auth resource limits");
    std::string block_pub = wallets::get_public_key_string(block.public_key());

    if (block_pub.empty() || block.signature().empty())
    {
        return KalStatus(KalStatus::Code::SIGNATURE_ERROR, "signatures: verify_block_validator: block does not have validator signature or public key");
    }

    kal_validator::Block block_copy;
    block_copy.CopyFrom(block);

    std::string signature_value = block_copy.signature();
    block_copy.clear_signature();
    std::string message_str = block_copy.SerializeAsString();

    std::vector<uint8_t> signature(signature_value.begin(), signature_value.end());
    std::vector<uint8_t> message(message_str.begin(), message_str.end());
    std::string pub_key_str = wallets::get_public_key_string(block.public_key());
    std::vector<uint8_t> public_key(pub_key_str.begin(), pub_key_str.end());

    if (!verify_signature(message, signature, public_key))
    {
        return KalStatus(KalStatus::Code::SIGNATURE_ERROR, "signatures: verify_block_validator: block validator signature failed");
    }

    return KalStatus(KalStatus::Code::OK);
}
KalStatus signatures::verify_block(kal_validator::Block &block)
{
    if (!auth_resources::check(block))
        return KalStatus(KalStatus::Code::BLOCK_FAULTY_TXN, "Block exceeds auth resource limits");
    if (!block.block_header().has_signature())
    {
        return KalStatus(KalStatus::Code::SIGNATURE_ERROR, "signatures: verify_block: block_header does not have a signature");
    }
    std::string public_key_string = wallets::get_public_key_string(block.block_header().public_key());

    std::vector<uint8_t> public_key(public_key_string.begin(), public_key_string.end());
    kal_validator::Block block_copy;
    block_copy.CopyFrom(block);
    block_copy.mutable_block_header()->clear_hash();

    std::string signature_value = block_copy.block_header().signature();
    block_copy.mutable_block_header()->clear_signature();
    std::string message_str = block_copy.SerializeAsString();

    std::vector<uint8_t> signature(signature_value.begin(), signature_value.end());
    std::vector<uint8_t> message(message_str.begin(), message_str.end());

    if (!verify_signature(message, signature, public_key))
    {
        logging::print(block.block_header().DebugString());
        return KalStatus(KalStatus::Code::SIGNATURE_ERROR, "signatures: verify_block: block_header signature failed");
    }

    return KalStatus(KalStatus::Code::OK);
}
bool signatures::verify_activity_request(kal_api::ActivityRequest request)
{
    std::string pub_key_str = wallets::get_public_key_string(request.public_key());
    std::vector<uint8_t> public_key(pub_key_str.begin(), pub_key_str.end());
    // Copy + clear instead of release_signature(): a request that omits the
    // signature would make release return nullptr and crash the API service.
    std::string signature_value = request.signature();
    request.clear_signature();
    std::string message_str = request.SerializeAsString();
    std::vector<uint8_t> signature(signature_value.begin(), signature_value.end());
    std::vector<uint8_t> message(message_str.begin(), message_str.end());

    return verify_signature(message, signature, public_key);
}
bool signatures::verify_attestation(const kal_validator::BlockAttestation &attestation)
{
    try
    {
        std::vector<uint8_t> block_hash(attestation.block_hash().begin(), attestation.block_hash().end());
        for (const auto &support : attestation.validator_support())
        {
            std::string support_pub_key = wallets::get_public_key_string(support.public_key());
            std::vector<uint8_t> public_key(support_pub_key.begin(), support_pub_key.end());
            std::vector<uint8_t> signature(support.signature().begin(), support.signature().end());

            if (!verify_signature(block_hash, signature, public_key))
            {
                return false;
            }
        }

        return true;
    }
    catch (...)
    {
        return false;
    }
}
void signatures::sign_attestation_response(kal_validator::BlockAttestationResponse *response, KeyPair key_pair)
{
    std::string message_str = response->SerializeAsString();
    std::vector<uint8_t> message(message_str.begin(), message_str.end());
    std::string signature = sign_message(message, key_pair);

    response->set_signature(signature);
}

std::string signatures::sign_block_hash(const std::string &block_hash, KeyPair key_pair)
{
    std::vector<uint8_t> message(block_hash.begin(), block_hash.end());
    std::string signature = sign_message(message, key_pair);
    return signature;
}

void signatures::sign_txn_gossip(kal_validator::TXNGossip *txn, KeyPair key_pair)
{
    std::string message_str = txn->SerializeAsString();
    std::vector<uint8_t> message(message_str.begin(), message_str.end());
    std::string signature = sign_message(message, key_pair);
    txn->set_signature(signature);
}
bool signatures::verify_txn_gossip(kal_validator::TXNGossip *txn)
{
    std::string public_key_str = wallets::get_public_key_string(txn->public_key());
    std::vector<uint8_t> public_key(public_key_str.begin(), public_key_str.end());
    // Copy + clear instead of release_signature(): a gossip message that omits the
    // signature would make release return nullptr and crash the validator. The
    // signature is intentionally left cleared on *txn, matching the old behavior.
    std::string signature_value = txn->signature();
    txn->clear_signature();
    std::string message_str = txn->SerializeAsString();
    std::vector<uint8_t> signature(signature_value.begin(), signature_value.end());
    std::vector<uint8_t> message(message_str.begin(), message_str.end());

    if (!verify_signature(message, signature, public_key))
    {
        return false;
    }

    return true;
}

void signatures::sign_smart_contract_event(kal_api::SmartContractEventsResponse *event, KeyPair key_pair)
{
    std::string message_str = event->SerializeAsString();
    std::vector<uint8_t> message(message_str.begin(), message_str.end());
    std::string signature = sign_message(message, key_pair);
    event->set_signature(signature);
}

bool signatures::verify_message(const std::string &message, const std::string &signature, const std::string &public_key)
{
    return verify_message(message, signature, public_key, nullptr);
}

bool signatures::verify_message(const std::string &message, const std::string &signature,
                                const std::string &public_key,
                                const std::function<bool(KeyType)> *before_verify)
{
    std::vector<uint8_t> public_key_vec, signature_vec;
    if (!base58_decode_bounded(public_key, public_key_vec, kal_wallet_address::MAX_QUERY_ENCODED_ADDRESS_BYTES) ||
        !base58_decode_bounded(signature, signature_vec, 1280 * 138 / 100 + 1)) return false;
    auto message_vec = hex_conversion::hex_to_bytes(message);

    return verify_signature(message_vec, signature_vec, public_key_vec, before_verify);
}
void signatures::sign_response(kal_api::ContractResponse *response, KeyPair key_pair)
{
    std::string message_str = response->SerializeAsString();
    std::vector<uint8_t> message(message_str.begin(), message_str.end());
    std::string signature = sign_message(message, key_pair);
    response->set_signature(signature);
}

void signatures::sign_response(kal_api::SmartContractEventsSearchResponse *response, KeyPair key_pair)
{
    std::string message_str = response->SerializeAsString();
    std::vector<uint8_t> message(message_str.begin(), message_str.end());
    std::string signature = sign_message(message, key_pair);
    response->set_signature(signature);
}

bool signatures::verify_checkpoint_info_request(const kal_validator::CheckpointInfoRequest &request)
{
    kal_validator::CheckpointInfoRequest request_copy;
    request_copy.CopyFrom(request);

    std::string pub_key_str = wallets::get_public_key_string(request_copy.public_key());
    std::vector<uint8_t> public_key(pub_key_str.begin(), pub_key_str.end());
    // Copy + clear instead of release_signature(): a request that omits the
    // signature would make release return nullptr and crash on dereference.
    std::string signature_value = request_copy.signature();
    request_copy.clear_signature();
    std::string message_str = request_copy.SerializeAsString();
    std::vector<uint8_t> signature(signature_value.begin(), signature_value.end());
    std::vector<uint8_t> message(message_str.begin(), message_str.end());

    return verify_signature(message, signature, public_key);
}

bool signatures::verify_checkpoint_request(const kal_validator::CheckpointRequest &request)
{
    kal_validator::CheckpointRequest request_copy;
    request_copy.CopyFrom(request);

    std::string pub_key_str = wallets::get_public_key_string(request_copy.public_key());
    std::vector<uint8_t> public_key(pub_key_str.begin(), pub_key_str.end());
    // Copy + clear instead of release_signature(): a request that omits the
    // signature would make release return nullptr and crash on dereference.
    std::string signature_value = request_copy.signature();
    request_copy.clear_signature();
    std::string message_str = request_copy.SerializeAsString();
    std::vector<uint8_t> signature(signature_value.begin(), signature_value.end());
    std::vector<uint8_t> message(message_str.begin(), message_str.end());

    return verify_signature(message, signature, public_key);
}

void signatures::sign_checkpoint_info(kal_validator::CheckpointInfo *info, KeyPair key_pair)
{
    info->clear_signature();
    std::string message_str = info->SerializeAsString();
    std::vector<uint8_t> message(message_str.begin(), message_str.end());
    std::string signature = sign_message(message, key_pair);
    info->set_signature(signature);
}

bool signatures::verify_checkpoint_info(const kal_validator::CheckpointInfo &info)
{
    if (info.signature().empty())
    {
        return false;
    }

    kal_validator::CheckpointInfo info_copy;
    info_copy.CopyFrom(info);

    std::string pub_key_str = wallets::get_public_key_string(info_copy.public_key());
    std::vector<uint8_t> public_key(pub_key_str.begin(), pub_key_str.end());
    std::string signature_value = info_copy.signature();
    info_copy.clear_signature();
    std::string message_str = info_copy.SerializeAsString();
    std::vector<uint8_t> signature(signature_value.begin(), signature_value.end());
    std::vector<uint8_t> message(message_str.begin(), message_str.end());

    return verify_signature(message, signature, public_key);
}
