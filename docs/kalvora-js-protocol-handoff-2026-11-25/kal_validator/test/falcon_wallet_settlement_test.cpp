#include "../attestation/consensus_limits.h"
#include "attestation_network.h"
#include "attestation_node_fixture.h"
#include "block_process.h"
#include "committed_wallet_nonce.h"
#include "contract_id_derivation.h"
#include "council_membership.h"
#include "db_base.h"
#include "db_key.h"
#include "execution_cache.h"
#include "execution_calendar_context.h"
#include "falcon_wallet.h"
#include "proposer.h"
#include "registered_wallet.h"
#include "restricted_keys.h"
#include "signed_transaction_timestamp.h"
#include "txn_batch.h"
#include "validator_registration_slots.h"
#include "validator_wallet_index.h"
#include "verify_process_txn.h"
#include "wallet_registry.h"
#include "../../tests/transactions/disposable_runner.h"

#include <filesystem>
#include <fstream>

namespace {
void require(bool ok, const std::string& reason) {
    if (!ok) throw std::runtime_error(reason);
}
void good(const KalStatus& status) { require(status.ok(), status.read_status()); }

struct Wallet {
    KeyPair pair;
    kal_txn::FalconPublicKey key;
    std::string address;
    Wallet(kal_txn::FalconVariant variant, kal_txn::WalletHash hash) {
        pair.wallet_hash = hash;
        falcon_wallet::generate(variant, pair.public_key, pair.private_key);
        key.set_variant(variant);
        key.set_raw_public_key(pair.public_key.data(), pair.public_key.size());
        address = falcon_wallet::address(key, hash);
    }
    kal_txn::WalletRegistration registration(const Wallet* sponsor = nullptr) const {
        kal_txn::WalletRegistration txn;
        *txn.mutable_falcon() = key;
        txn.set_wallet_hash(pair.wallet_hash);
        auto* base = txn.mutable_base();
        base->set_nonce(1);
        base->set_fee_id(NETWORK_CONTRACT);
        base->set_fee_amount("1000000");
        *base->mutable_timestamp() = kalvora::signed_transaction_timestamp::wall_time();
        base->mutable_public_key()->set_wallet_address(address);
        signatures::sign_txns(&txn, pair);
        if (sponsor) {
            base->mutable_fee_payer()->mutable_public_key()->set_wallet_address(sponsor->address);
            base->mutable_fee_payer()->set_nonce(2);
            signatures::sign_fee_payer(&txn, sponsor->pair);
        }
        const auto digest = Hashing::sha256_hash(txn.SerializeAsString());
        base->set_hash(digest.data(), digest.size());
        return txn;
    }
};

struct Result {
    std::string redo, receipt;
    uint256_t fee;
};

void check_contract_permissions(const Wallet& signer) {
    database::ExecutionOverlay candidate;
    attestation::ExecutionCache caches;
    kal_txn::InstrumentContract parent, child, other;
    parent.set_contract_id(kalvora::contract_id::derive_genesis(7101).encoded_id);
    child.set_contract_id(kalvora::contract_id::derive_genesis(7102).encoded_id);
    other.set_contract_id(kalvora::contract_id::derive_genesis(7103).encoded_id);
    auto* grant = parent.add_restricted_keys();
    grant->mutable_public_key()->set_wallet_address(signer.address);
    grant->set_mint(true);
    require(db_contracts::store_single(parent.contract_id(), parent.SerializeAsString()), "Cannot stage parent grant");
    auto* link = child.add_restricted_keys();
    link->mutable_public_key()->set_parent_contract(parent.contract_id());
    link->set_mint(true);
    kal_txn::MintTXN mint;
    auto* identity = mint.mutable_base()->mutable_public_key();
    identity->set_wallet_address(signer.address);
    auto allowed = [&](kal_txn::InstrumentContract& contract) {
        return restricted_keys_check::check_restricted_keys(&mint, contract, kal_txn::MINT_TYPE).ok();
    };
    require(allowed(parent) && allowed(child) && !allowed(other), "Mint grant escaped its contract or lost its parent");
    auto* local = child.add_restricted_keys();
    local->mutable_public_key()->set_wallet_address(signer.address);
    require(!allowed(child), "Inherited mint overrode the local denial");
    local->set_mint(true);
    require(allowed(child), "Local mint grant failed");
    const auto alias = falcon_wallet::address(signer.key, kal_txn::BLAKE3_256);
    identity->set_wallet_address(alias);
    require(!allowed(child), "A different hash address inherited the signer's grant");
    const std::string same_bytes = "gov_" + std::string(28, 'g');
    local->mutable_public_key()->Clear();
    local->mutable_public_key()->set_governance_auth(same_bytes);
    identity->set_wallet_address(same_bytes);
    require(!allowed(child), "A wallet matched a typed governance grant with the same bytes");
    identity->Clear();
    identity->set_single("r_" + signer.address);
    require(!allowed(child), "A legacy restricted key authorized a mint");
    require(candidate.healthy(), "Contract permission checks invalidated the candidate");
}

void check_validator_registration(const Wallet& owner, const Wallet& operational, uint64_t nonce) {
    require(owner.address.size() == kal_wallet_address::MAX_RAW_ADDRESS_BYTES,
            "Validator fixture requires the widest owner address");
    unsetenv("ATTESTATION_KEY_PATH");
    std::string error;
    require(attestation_crypto::initialize(error), error);
    const auto bls = attestation_crypto::public_key();
    kal_txn::ValidatorRegistration txn;
    txn.set_register_(true);
    auto* base = txn.mutable_base();
    base->set_nonce(nonce);
    base->set_fee_id(NETWORK_CONTRACT);
    base->set_fee_amount(std::to_string(ONE_DOLLAR));
    *base->mutable_timestamp() = kalvora::signed_transaction_timestamp::wall_time();
    base->mutable_public_key()->set_wallet_address(owner.address);
    auto* validator = txn.mutable_validator();
    *validator->mutable_public_key() = base->public_key();
    validator->set_host("127.0.0.1");
    validator->set_client_port("50052");
    validator->set_validator_port("50051");
    auto* key = validator->mutable_attestation_key();
    key->set_version(bls.version);
    key->set_public_key(bls.public_key);
    key->set_proof_of_possession(bls.proof_of_possession);
    txn.mutable_generated_public_key()->set_wallet_address(operational.address);
    signatures::sign_txns(&txn, owner.pair);
    txn.set_generated_signature(signatures::sign_block_hash(registered_wallet::owner_message(txn), operational.pair));
    const auto hash = Hashing::sha256_hash(txn.SerializeAsString());
    base->set_hash(hash.data(), hash.size());

    database::ExecutionOverlay candidate;
    attestation::ExecutionCache caches;
    execution_calendar_context::Scope time(base->timestamp());
    node_fixture::install_test_registration_policy();
    kal_txn::TXNStatusFees receipt;
    good(block_process::process_txn(&txn, receipt, kal_txn::VALIDATOR_REGISTRATION_TYPE, std::string(32, 'F')));
    require(receipt.status() == kal_txn::OK && uint256_t(receipt.base_fees()) > 0,
            "Wide validator registration did not produce a successful paid receipt");
    kal_txn::TXNS txns;
    *txns.add_validator_registration_txns() = txn;
    std::string indexed;
    require(txn_batch::batch_validator_registration(txns, {{base->hash(), true}}, {}) &&
            validator_wallet_index::read_owner(owner.address, indexed) == database::BoundedReadStatus::complete &&
            indexed == owner.address &&
            db_validator_lookup::get_single(owner.address, indexed) && indexed == operational.address &&
            candidate.healthy(), "Batch settlement lost the wide validator owner or its operational address");

    kal_validator::Block block;
    *block.mutable_transactions() = txns;
    auto* accepted = block.mutable_transactions()->add_txn_fees_and_status();
    accepted->set_status(kal_txn::OK);
    accepted->set_txn_hash(base->hash());
    block.add_validator_expiry_certificates()->mutable_statement()->set_target_operational_key(operational.address);
    good(attestation::validate_expiry_transaction_conflicts(block));
}

void check_maximum_validator_roster() {
    database::ExecutionOverlay candidate;
    rocksdb::WriteBatch batch;
    std::string address(kal_wallet_address::MAX_RAW_ADDRESS_BYTES, '\0');
    for (std::size_t i = 0; i < attestation::maximum_validators; ++i) {
        const auto id = std::to_string(i);
        address.replace(1, id.size(), id);
        address.front() = 'o';
        const auto owner = address;
        address.front() = 'p';
        batch.Put(owner, address);
    }
    require(db_validator_lookup::store_batch(batch), "Cannot stage maximum-width roster");
    std::set<std::string> owners;
    using validator_registration_slots::Status;
    require(validator_registration_slots::load(owners) == Status::available &&
            owners.size() == attestation::maximum_validators, "Maximum-width roster could not be read");
    const auto owner = *owners.begin();
    require(db_validator_lookup::store_single(owner, address + 'x') &&
            validator_registration_slots::read_operational(owner, address) == database::BoundedReadStatus::limit_exceeded &&
            validator_registration_slots::load(owners) == Status::state_error,
            "An oversized operational address was accepted");
}

template <typename Transaction>
Result execute(const Transaction& txn, uint64_t height, bool proposing_locally,
               const kal_txn::WalletRegistration* same_block = nullptr) {
    const std::string fee_wallet(32, 'F');
    database::ExecutionOverlay overlay(database::ExecutionOverlay::Purpose::ConsensusCandidate);
    attestation::ExecutionCache caches;
    kal_validator::Block block;
    block.mutable_block_header()->set_block_height(height);
    block.mutable_block_header()->set_fee_address(fee_wallet);
    *block.mutable_block_header()->mutable_timestamp() = txn.base().timestamp();
    execution_calendar_context::Scope time(txn.base().timestamp());
    kal_txn::TXNWrapper wrapper;
    verify_txns::store_wrapper(&txn, wrapper);
    good(proposing::process_txns({wrapper.SerializeAsString()}, {get_txn_key(1, txn.base().hash())},
                                  &block, fee_wallet, false, proposing_locally));
    require(block.transactions().wallet_registrations_size() + block.transactions().coin_txns_size() == 1 &&
            block.transactions().txn_fees_and_status_size() == 1, "Transaction or receipt absent from block");
    const auto& receipt = block.transactions().txn_fees_and_status(0);
    require(receipt.status() == kal_txn::OK && receipt.txn_hash() == txn.base().hash(),
            "Transaction did not settle: " + kal_txn::TXN_STATUS_Name(receipt.status()));
    good(verify_txns::verify_block_txns(block));
    if (same_block) {
        auto sponsored = *same_block;
        require(!signatures::verify_txns(sponsored), "A pending wallet sponsored another registration");
    }
    good(proposing::add_temp_wallet_balance({txn.base().hash()}, fee_wallet));
    block_process::store_wallets();
    require(nonce_tracker::store_used_nonce(std::to_string(height)), "Cannot commit registration nonces");
    require(database::active_overlay_healthy(), "Registration invalidated the candidate");
    return {overlay.export_batch(), receipt.SerializeAsString(), uint256_t(receipt.base_fees())};
}

kal_txn::CoinTXN transfer(const Wallet& payer, uint64_t nonce, const std::string& recipient, bool safe) {
    kal_txn::CoinTXN txn;
    txn.set_contract_id(NETWORK_CONTRACT);
    auto* base = txn.mutable_base();
    base->mutable_public_key()->set_wallet_address(payer.address);
    base->set_fee_id(NETWORK_CONTRACT);
    base->set_fee_amount("1000000000000000000");
    base->set_safe_send(safe);
    *base->mutable_timestamp() = kalvora::signed_transaction_timestamp::wall_time();
    *txn.mutable_auth()->add_public_key() = base->public_key();
    txn.mutable_auth()->add_nonce(nonce);
    auto* input = txn.add_input_transfers();
    input->set_amount("7");
    input->set_fee_percent(100000000);
    input->set_contract_fee_percent(100000000);
    auto* output = txn.add_output_transfers();
    output->set_wallet_address(recipient);
    output->set_amount("7");
    signatures::sign_new_coin_txn(&txn, {payer.pair});
    auto hash = Hashing::sha256_hash(txn.SerializeAsString());
    base->set_hash(hash.data(), hash.size());
    return txn;
}

void exercise(const std::string&) {
    open_dbs();
    std::string error;
    require(attestation_network::initialize(false, DATA_DIR, {}, false, error) &&
            attestation_network::bind_signature_chain_id(std::string(32, 'G')), "Cannot configure fixture chain");
    ValidatorConfig::set_treasury_wallet(TREASURY_WALLET);
    kal_txn::InstrumentContract kal;
    kal.set_contract_id(NETWORK_CONTRACT);
    kal.mutable_coin_denomination()->set_amount(std::to_string(ONE_DOLLAR));
    require(db_contracts::store_single(NETWORK_CONTRACT, kal.SerializeAsString()), "Cannot set fixture fee instrument");
    Wallet alice(kal_txn::FALCON_512, kal_txn::BLAKE3_9001), ben(kal_txn::FALCON_1024, kal_txn::SHA3_512);
    check_contract_permissions(alice);
    const auto funding_key = db_key::wallet_contract(alice.address, NETWORK_CONTRACT);
    const uint256_t funding = ONE_DOLLAR;
    std::string initial_state;
    {
        database::ExecutionOverlay genesis;
        council_membership::Budget budget{1024, 1024 * 1024, 1024};
        require(council_membership::initialize_empty(budget) == council_membership::Result::Applied,
                "Cannot initialize the genesis balance projection");
        require(db_wallets::store_single(funding_key, funding.str()), "Cannot prefund an unregistered wallet");
        initial_state = genesis.export_batch();
    }
    require(database::apply_record(initial_state, error), error);
    auto first = alice.registration(), second = ben.registration(&alice);
    Wallet carol(kal_txn::FALCON_512, kal_txn::SHAKE256_2048);
    {
        auto unfunded = carol.registration();
        database::ExecutionOverlay candidate;
        attestation::ExecutionCache caches;
        execution_calendar_context::Scope time(unfunded.base().timestamp());
        kal_txn::TXNStatusFees receipt;
        const auto status = block_process::process_txn(&unfunded, receipt, kal_txn::REGISTER_WALLET_TYPE, std::string(32, 'F'));
        uint64_t reserved = 0;
        require(!status.ok() && status.code() != KalStatus::DATABASE_ERROR && candidate.healthy() &&
                !wallet_registry::occupied(carol.address) && !nonce_tracker::get_nonce(carol.address, reserved),
                "Unfunded registration created a signing authority or consumed a nonce");
    }
    auto payment = transfer(alice, 3, carol.address, false);
    require(!verify_txns::verify_txn(&payment).ok(), "Coin admission accepted an unregistered input");
    good(verify_txns::verify_txn(&first));
    require(!verify_txns::verify_txn(&second).ok(), "Admission accepted an unregistered sponsor");
    const auto h1 = execute(first, 1, true, &second);
    require(!wallet_registry::occupied(alice.address), "Discarding the builder staged a permanent key");
    const auto replay1 = execute(first, 1, false, &second);
    require(h1.receipt == replay1.receipt && h1.fee == first.ByteSizeLong() + 1,
            "Self-funded receipt differs across replay or omitted its proof cost");
    require(database::apply_record(replay1.redo, error), error);
    uint64_t nonce = 0;
    std::string balance;
    require(committed_wallet_nonce::read(alice.address, nonce) == committed_wallet_nonce::ReadStatus::found &&
            nonce == 1 && db_wallets::get_single(funding_key, balance) && uint256_t(balance) == funding - h1.fee,
            "Incorrect self-funded registration balance or nonce");
    require(!verify_txns::verify_txn(&first).ok(), "Admission accepted an occupied wallet");
    good(verify_txns::verify_txn(&second));
    const auto h2 = execute(second, 2, true);
    const auto replay2 = execute(second, 2, false);
    require(h2.receipt == replay2.receipt && h2.fee == second.ByteSizeLong() + 2,
            "Sponsored receipt differs across replay or omitted a proof cost");
    require(database::apply_record(replay2.redo, error), error);
    close_dbs();
    open_dbs();
    require(wallet_registry::parent(ben.address).has_value() &&
            committed_wallet_nonce::read(ben.address, nonce) == committed_wallet_nonce::ReadStatus::found && nonce == 1 &&
            committed_wallet_nonce::read(alice.address, nonce) == committed_wallet_nonce::ReadStatus::found && nonce == 2 &&
            db_wallets::get_single(funding_key, balance) && uint256_t(balance) == funding - h1.fee - h2.fee &&
            !db_wallets::exist(db_key::wallet_contract(ben.address, NETWORK_CONTRACT)),
            "Restart lost a registration or charged the wrong payer");
    good(verify_txns::verify_txn(&payment));
    const auto h3 = execute(payment, 3, true);
    const auto replay3 = execute(payment, 3, false);
    require(h3.receipt == replay3.receipt && database::apply_record(replay3.redo, error),
            "Normal transfer replay disagreed");
    require(db_wallets::get_single(db_key::wallet_contract(carol.address, NETWORK_CONTRACT), balance) &&
            balance == "7" && !wallet_registry::occupied(carol.address),
            "A transfer to an unseen wallet failed or created a signing registration");
    auto safe = transfer(alice, 4, ben.address, true);
    require(!check_safe_send(safe.base(), carol.address), "A balance alone made an unregistered recipient safe");
    good(verify_txns::verify_txn(&safe));
    const auto h4 = execute(safe, 4, true);
    const auto replay4 = execute(safe, 4, false);
    require(h4.receipt == replay4.receipt && database::apply_record(replay4.redo, error),
            "Safe transfer replay disagreed");
    require(db_wallets::get_single(db_key::wallet_contract(ben.address, NETWORK_CONTRACT), balance) && balance == "7" &&
            db_wallets::get_single(funding_key, balance) &&
            uint256_t(balance) == funding - h1.fee - h2.fee - h3.fee - h4.fee - 14 &&
            committed_wallet_nonce::read(alice.address, nonce) == committed_wallet_nonce::ReadStatus::found && nonce == 4,
            "Safe transfer credited the wrong wallet or debited the wrong amount");
    check_validator_registration(alice, ben, 5);
    check_maximum_validator_roster();
    require(db_system::store_single(db_key::components({"KAL_SIGNING_WALLET_V1", alice.address}), "damaged"),
            "Cannot prepare the damaged registry fixture");
    auto next_payment = transfer(alice, 5, ben.address, true);
    require(verify_txns::verify_txn(&next_payment).code() == KalStatus::DATABASE_ERROR,
            "A damaged registry entry was reported as a bad signature");
    close_dbs();
}

template<class Transaction>
Transaction client_fixture(const std::filesystem::path& path) {
    const auto size = std::filesystem::file_size(path);
    require(size > 0 && size <= attestation::maximum_block_bytes,
            "Client transaction file is empty or oversized");
    std::ifstream input(path, std::ios::binary);
    std::string bytes(static_cast<size_t>(size), '\0');
    input.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    require(input.gcount() == static_cast<std::streamsize>(bytes.size()) &&
            input.peek() == std::char_traits<char>::eof(),
            "Cannot read complete client transaction file");
    Transaction txn;
    require(txn.ParseFromArray(bytes.data(), static_cast<int>(bytes.size())),
            "Cannot decode client transaction");
    return txn;
}

template<class Transaction>
void rehash_client_fixture(Transaction& txn) {
    txn.mutable_base()->clear_hash();
    const auto hash = Hashing::sha256_hash(txn.SerializeAsString());
    txn.mutable_base()->set_hash(hash.data(), hash.size());
}

void client_interop(const std::filesystem::path& registration_path,
                    const std::filesystem::path& coin_path) {
    auto registration = client_fixture<kal_txn::WalletRegistration>(registration_path);
    auto coin = client_fixture<kal_txn::CoinTXN>(coin_path);
    require(registration.has_falcon() && registration.base().nonce() == 1 &&
            registration.base().fee_id() == NETWORK_CONTRACT &&
            !registration.base().has_fee_payer(),
            "Client registration must be a self-funded single-key wallet");
    const auto address = falcon_wallet::address(registration.falcon(), registration.wallet_hash());
    require(!address.empty() && registration.base().public_key().wallet_address() == address &&
            coin.base().public_key().wallet_address() == address &&
            coin.auth().public_key_size() == 1 &&
            coin.auth().public_key(0).wallet_address() == address &&
            coin.auth().nonce_size() == 1 && coin.auth().nonce(0) == 2 &&
            coin.auth().signature_size() == 1 &&
            coin.contract_id() == NETWORK_CONTRACT &&
            coin.base().fee_id() == NETWORK_CONTRACT && !coin.base().has_fee_payer() &&
            coin.input_transfers_size() == 1 && coin.output_transfers_size() == 1 &&
            coin.input_transfers(0).amount() == "7" &&
            coin.output_transfers(0).amount() == "7" &&
            coin.output_transfers(0).wallet_address() != address && !coin.base().safe_send(),
            "Client Coin must spend seven kalvs from the newly registered wallet");

    open_dbs();
    std::string error;
    require(attestation_network::initialize(false, DATA_DIR, {}, false, error) &&
            attestation_network::bind_signature_chain_id(std::string(32, 'G')),
            "Cannot configure client interoperability chain");
    ValidatorConfig::set_treasury_wallet(TREASURY_WALLET);
    kal_txn::InstrumentContract kal;
    kal.set_contract_id(NETWORK_CONTRACT);
    kal.mutable_coin_denomination()->set_amount(std::to_string(ONE_DOLLAR));
    require(db_contracts::store_single(NETWORK_CONTRACT, kal.SerializeAsString()),
            "Cannot set client interoperability fee instrument");
    const auto funding_key = db_key::wallet_contract(address, NETWORK_CONTRACT);
    const uint256_t funding = ONE_DOLLAR;
    std::string initial_state;
    {
        database::ExecutionOverlay genesis;
        council_membership::Budget budget{1024, 1024 * 1024, 1024};
        require(council_membership::initialize_empty(budget) == council_membership::Result::Applied &&
                db_wallets::store_single(funding_key, funding.str()),
                "Cannot fund client wallet before registration");
        initial_state = genesis.export_batch();
    }
    require(database::apply_record(initial_state, error), error);
    require(!verify_txns::verify_txn(&coin).ok(),
            "Client Coin spent before registration finalized");
    good(verify_txns::verify_txn(&registration));
    auto corrupted = registration;
    std::string signature = corrupted.base().signature();
    require(signature.size() > 1, "Client registration has no Falcon signature");
    signature[1] ^= 1;
    corrupted.mutable_base()->set_signature(signature);
    rehash_client_fixture(corrupted);
    require(!verify_txns::verify_txn(&corrupted).ok(),
            "Validator accepted a changed client registration signature");
    corrupted = registration;
    corrupted.mutable_base()->set_chain_id(std::string(32, 'X'));
    rehash_client_fixture(corrupted);
    require(!verify_txns::verify_txn(&corrupted).ok(),
            "Validator accepted a client registration for another chain");
    corrupted = registration;
    auto wrong_address = address;
    wrong_address[0] ^= 1;
    corrupted.mutable_base()->mutable_public_key()->set_wallet_address(wrong_address);
    rehash_client_fixture(corrupted);
    require(!verify_txns::verify_txn(&corrupted).ok(),
            "Validator accepted a client registration under another address");
    const auto proposed_registration = execute(registration, 1, true);
    const auto replayed_registration = execute(registration, 1, false);
    require(proposed_registration.receipt == replayed_registration.receipt &&
            proposed_registration.fee == replayed_registration.fee &&
            proposed_registration.redo == replayed_registration.redo &&
            database::apply_record(replayed_registration.redo, error),
            "Client registration receipt or replay diverged");
    close_dbs(); open_dbs();
    uint64_t nonce = 0;
    std::string balance;
    const auto record = wallet_registry::parent(address);
    require(record && *record == falcon_wallet::key_record(registration.falcon()) &&
            committed_wallet_nonce::read(address, nonce) == committed_wallet_nonce::ReadStatus::found &&
            nonce == 1 && db_wallets::get_single(funding_key, balance) &&
            uint256_t(balance) == funding - proposed_registration.fee,
            "Client registration did not persist its key, fee and nonce");
    good(verify_txns::verify_txn(&coin));
    auto bad_coin = coin;
    signature = bad_coin.auth().signature(0);
    require(signature.size() > 1, "Client Coin has no Falcon signature");
    signature[1] ^= 1;
    bad_coin.mutable_auth()->set_signature(0, signature);
    rehash_client_fixture(bad_coin);
    require(!verify_txns::verify_txn(&bad_coin).ok(),
            "Validator accepted a changed client Coin signature");
    const auto proposed_coin = execute(coin, 2, true);
    const auto replayed_coin = execute(coin, 2, false);
    require(proposed_coin.receipt == replayed_coin.receipt &&
            proposed_coin.fee == replayed_coin.fee &&
            proposed_coin.redo == replayed_coin.redo &&
            database::apply_record(replayed_coin.redo, error),
            "Client Coin receipt or replay diverged");
    close_dbs(); open_dbs();
    const auto recipient_key = db_key::wallet_contract(
        coin.output_transfers(0).wallet_address(), NETWORK_CONTRACT);
    require(wallet_registry::parent(address) == record &&
            committed_wallet_nonce::read(address, nonce) == committed_wallet_nonce::ReadStatus::found &&
            nonce == 2 && db_wallets::get_single(funding_key, balance) &&
            uint256_t(balance) == funding - proposed_registration.fee - proposed_coin.fee - 7 &&
            db_wallets::get_single(recipient_key, balance) && balance == "7",
            "Client Coin did not persist its balances and nonce after restart");
    const uint256_t remaining = funding - proposed_registration.fee - proposed_coin.fee - 7;
    close_dbs();
    std::ofstream expected(std::filesystem::path(DATA_DIR) / "client-expected-balance",
                           std::ios::binary);
    expected << remaining.str();
    expected.close();
    require(expected.good(), "Cannot save expected client balance for restart check");
    std::cout << "Client Falcon registration and Coin verified, settled and replayed\n";
}

void client_interop_restart(const std::filesystem::path& registration_path,
                            const std::filesystem::path& coin_path) {
    const auto registration = client_fixture<kal_txn::WalletRegistration>(registration_path);
    const auto coin = client_fixture<kal_txn::CoinTXN>(coin_path);
    const auto address = registration.base().public_key().wallet_address();
    std::ifstream expected(std::filesystem::path(DATA_DIR) / "client-expected-balance",
                           std::ios::binary);
    std::string expected_sender_balance;
    require(static_cast<bool>(expected >> expected_sender_balance),
            "Cannot load expected client balance after restart");
    open_dbs();
    uint64_t nonce = 0;
    std::string sender_balance, recipient_balance;
    const auto record = wallet_registry::parent(address);
    require(record && *record == falcon_wallet::key_record(registration.falcon()) &&
            committed_wallet_nonce::read(address, nonce) == committed_wallet_nonce::ReadStatus::found &&
            nonce == 2 &&
            db_wallets::get_single(db_key::wallet_contract(address, NETWORK_CONTRACT), sender_balance) &&
            sender_balance == expected_sender_balance &&
            db_wallets::get_single(db_key::wallet_contract(
                coin.output_transfers(0).wallet_address(), NETWORK_CONTRACT), recipient_balance) &&
            recipient_balance == "7",
            "Fresh validator process lost client wallet, nonce or Coin balances");
    close_dbs();
}
}

int main(int argc, char** argv) {
    try {
        if (argc == 4 && std::string(argv[1]) == "--client-interop-worker") {
            client_interop(argv[2], argv[3]);
            return 0;
        }
        if (argc == 4 && std::string(argv[1]) == "--client-interop-check") {
            client_interop_restart(argv[2], argv[3]);
            return 0;
        }
        if (argc == 4 && std::string(argv[1]) == "--client-interop") {
            const auto registration = std::filesystem::absolute(argv[2]);
            const auto coin = std::filesystem::absolute(argv[3]);
            char directory[] = "/tmp/kal-falcon-client-XXXXXX";
            require(mkdtemp(directory), "Cannot create disposable client ledger");
            const auto run = [&](const char* mode) {
                const auto child = fork();
                require(child >= 0, "Cannot fork client interoperability fixture");
                if (!child) {
                    setenv("DATA_DIR", directory, 1);
                    setenv("LOCAL_MODE", "true", 1);
                    execl("/proc/self/exe", argv[0], mode,
                          registration.c_str(), coin.c_str(), nullptr);
                    _exit(127);
                }
                int status = 0;
                require(waitpid(child, &status, 0) == child && WIFEXITED(status) &&
                        !WEXITSTATUS(status),
                        std::string("Client interoperability fixture failed (") + mode +
                            "); retained at " + directory);
            };
            run("--client-interop-worker");
            run("--client-interop-check");
            std::filesystem::remove_all(directory);
            return 0;
        }
        return disposable_main(argc, argv, exercise);
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
