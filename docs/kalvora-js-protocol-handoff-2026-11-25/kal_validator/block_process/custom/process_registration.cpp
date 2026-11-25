#include "../block_process.h"
#include "utils.h"
#include "../logging/logging.h"
#include "fees.h"
#include "db_key.h"
#include "attestation_registration.h"
#include "gossip_v2.h"
#include "validator_endpoint_policy.h"
#include "validator_wallet_index.h"
#include "fee_payer.h"
#include "kal_wallet_address.h"
#include "contract_id_derivation.h"

namespace
{
    KalStatus quote_registration_fee(const kal_txn::ValidatorRegistration *txn,
                                     const kal_txn::TRANSACTION_TYPE &txn_type,
                                     const kal_txn::PublicKey &public_key,
                                     kal_txn::InstrumentContract &contract,
                                     uint256_t &txn_fee_amount)
    {
        if (txn->base().fee_id() != NETWORK_CONTRACT)
        {
            return KalStatus(KalStatus::Code::BLOCK_FAULTY_TXN, "process_registration.cpp: process_registration_fees: invalid fee id: " + txn->base().fee_id());
        }

        // On fresh genesis the trusted bootstrap precedes the fee contracts.
        // Ordinary joins wait for a selected policy before reserving any fee.
        if (txn->register_())
        {
            const auto key = db_key::legacy_smart_contract_state(NETWORK_FEE_PROXY);
            std::size_t rows = 0, bytes = 0;
            const auto read = db_smart_contract_states::exists_bounded_checked(
                key, 1, key.size(), rows, bytes);
            if (read == database::BoundedReadStatus::not_found)
                return KalStatus(KalStatus::TXN_FAILED, "Validator registration policy is not installed",
                                 kal_txn::INVALID_PARAMETERS);
            if (read != database::BoundedReadStatus::complete)
                return KalStatus(KalStatus::DATABASE_ERROR, "Cannot read validator registration policy");
        }

        const uint256_t fee_type = get_txn_fee(txn_type);

        KalStatus status = block_process::get_contract(txn->base().fee_id(), contract);
        if (!status.ok())
        {
            return KalStatus(KalStatus::Code::DATABASE_ERROR,
                             "process_registration.cpp: Network fee contract state is unavailable");
        }

        // check to see if token is qualified and get usd_equiv if it is, or send back KALV USD equivalent if it is not qualified
        uint256_t usd_equiv;

        const auto eligibility = kal_fees::get_cur_equiv_eligibility(
            contract.contract_id(), usd_equiv);
        if (eligibility != kal_fees::FeeEligibility::Eligible)
        {
            // Registration accepts only the network fee instrument. If its
            // quote cannot be read, this validator has no canonical proof of
            // an ordinary payer failure.
            return KalStatus(KalStatus::Code::DATABASE_ERROR,
                             "process_registration.cpp: Network fee-token quote is unavailable");
        }
        // calculate the fees that need to be paid, and verify they have authorized enough coin to pay it
        status = kal_fees::calculate_fees(usd_equiv, fee_type, txn->ByteSize(), txn->base().fee_amount(), txn_fee_amount, contract.coin_denomination().amount(), public_key, contract.contract_id(), false, 0, true, 1,
                                         txn->register_() ? &txn->generated_public_key() : nullptr);

        if (!status.ok())
        {
            return status;
        }
        return KalStatus();
    }

    KalStatus process_registration_fees(const kal_txn::ValidatorRegistration *txn, kal_txn::TXNStatusFees &status_fees, const kal_txn::TRANSACTION_TYPE &txn_type, const kal_txn::PublicKey &public_key, const std::string &fee_address, const bool &sc_txn, const std::string &sc_fee_address)
    {
        kal_txn::InstrumentContract contract;
        uint256_t txn_fee_amount;
        KalStatus status = quote_registration_fee(txn, txn_type, public_key, contract, txn_fee_amount);
        if (!status.ok()) return status;

        // CHANGELOG: added sc_fee address for sc_txns
        std::string wallet_key;
        if (sc_txn)
        {
            wallet_key = sc_fee_address;
        }
        else
        {
            wallet_key = wallets::generate_wallet(public_key);
        }

        if (!sc_txn)
        {
            status = kal_fees::preflight_interface_fees(
                txn->base(), contract.contract_id(), txn_fee_amount, wallet_key, true);
            if (!status.ok())
                return status;
        }
        status = balance_tracker::preflight_debit(wallet_key, contract.contract_id(), txn_fee_amount);
        if (!status.ok())
        {
            if (status.code() == KalStatus::Code::WALLET_INSUFFICIENT_FUNDS)
                status.mark_hard_reject(KalStatus::HardRejectKind::CannotPayFee);
            return status;
        }
        status = kal_fees::process_fees(contract, txn_fee_amount, wallet_key, contract.contract_id(), true, status_fees, txn->base().hash(), fee_address, false, !sc_txn);
        if (!status.ok())
            return KalStatus(KalStatus::Code::DATABASE_ERROR,
                             "process_registration: Network fee settlement contradicted preflight");
        return status;
    }

    KalStatus check_validator_balance(const std::string &wallet_str)
    {
        uint256_t validator_min_hold;
        uint256_t validator_min_kal;
        if (!get_required_network_fee("VALIDATOR_HOLDING_MINIMUM", validator_min_hold) ||
            !get_required_network_fee("VALIDATOR_MINIMUM_KAL", validator_min_kal))
        {
            return KalStatus(KalStatus::Code::DATABASE_ERROR,
                             "process_registration.cpp: check_validator_balance: Missing or invalid validator stake configuration.",
                             kal_txn::TXN_STATUS::INVALID_PARAMETERS);
        }

        uint256_t cur_equiv;
        kal_txn::InstrumentContract contract;

        if (kal_fees::get_cur_equiv_eligibility(KALV_CONTRACT_ID, cur_equiv) !=
                kal_fees::FeeEligibility::Eligible || cur_equiv == 0)
        {
            return KalStatus(KalStatus::Code::DATABASE_ERROR,
                             "process_registration.cpp: KAL stake quote state is unavailable");
        }
        const KalStatus contract_status = block_process::get_contract(KALV_CONTRACT_ID, contract);
        uint256_t denomination;
        if (!contract_status.ok() ||
            !parse_uint256(contract.coin_denomination().amount(), denomination) || denomination == 0)
            return KalStatus(KalStatus::Code::DATABASE_ERROR,
                             "process_registration.cpp: Invalid KAL denomination");

        // The existing stake predicate accepts either minimum. Compute its
        // equivalent raw-unit lower bound using wide arithmetic, then reuse
        // the same checked candidate balance reader as fee debit preflight.
        using boost::multiprecision::cpp_int;
        const cpp_int value_minimum =
            (cpp_int(validator_min_hold) * cpp_int(denomination) +
             cpp_int(cur_equiv) - 1) / cpp_int(cur_equiv);
        const uint256_t required = value_minimum < cpp_int(validator_min_kal)
            ? static_cast<uint256_t>(value_minimum) : validator_min_kal;
        const auto stake_status = balance_tracker::preflight_debit(
            wallet_str, KALV_CONTRACT_ID, required);
        if (stake_status.code() == KalStatus::Code::WALLET_INSUFFICIENT_FUNDS)
            return KalStatus(KalStatus::Code::TXN_FAILED,
                             "process_registration.cpp: Validator does not have enough coin to stake",
                             kal_txn::TXN_STATUS::INSUFFICIENT_AMOUNT);
        if (!stake_status.ok())
            return stake_status;

        return KalStatus();
    }
}
KalStatus block_process::pending_registration_fee_check(const kal_txn::ValidatorRegistration &txn)
{
    if (txn.base().fee_id() != NETWORK_CONTRACT)
        return KalStatus(KalStatus::Code::BLOCK_FAULTY_TXN,
                         "Registration requires the network fee instrument");
    if (!gossip_v2::canonical_validator_key(txn.base().public_key()) ||
        !gossip_v2::canonical_validator_key(txn.validator().public_key()) ||
        (txn.register_() && !gossip_v2::canonical_validator_key(txn.generated_public_key())))
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "Registration has a noncanonical validator key",
                         kal_txn::VALIDATOR_ADDRESS);
    if (wallets::get_public_key_string(txn.base().public_key()) !=
        wallets::get_public_key_string(txn.validator().public_key()))
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "Registration owner key does not match signer",
                         kal_txn::VALIDATOR_ADDRESS);
    const auto owner = wallets::generate_wallet(txn.validator().public_key());
    if (!kal_wallet_address::valid_raw(owner))
        return KalStatus(KalStatus::Code::BLOCK_FAULTY_TXN,
                         "Invalid registration owner wallet",
                         kal_txn::VALIDATOR_ADDRESS);

    kal_txn::InstrumentContract contract;
    uint256_t network_fee;
    const auto quote = quote_registration_fee(&txn, kal_txn::VALIDATOR_REGISTRATION_TYPE,
                                              txn.validator().public_key(), contract, network_fee);
    if (!quote.ok()) return quote;
    const auto payer_status = kal_fees::check_fee_payer(owner, true);
    if (!payer_status.ok()) return payer_status;

    uint256_t interface_fee = 0;
    if (!txn.base().interface_fee().empty() &&
        !parse_uint256(txn.base().interface_fee(), interface_fee))
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "Invalid registration interface fee",
                         kal_txn::INVALID_UINT256);
    if (interface_fee != 0 &&
        !kalvora::contract_id::decode_and_validate(txn.base().interface_fee_id()))
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "Invalid registration interface fee instrument",
                         kal_txn::INVALID_CONTRACT_FEE_ID);
    if (interface_fee != 0 &&
        !kal_wallet_address::valid_raw(txn.base().interface_address()) &&
        txn.base().interface_address() != BURN_WALLET)
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "Invalid registration interface fee recipient",
                         kal_txn::INVALID_WALLET_ADDRESS);
    if (interface_fee != 0 && fee_payer::source_wallet(txn.base()) != owner)
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "Registration interface fee payer differs from owner",
                         kal_txn::VALIDATOR_ADDRESS);
    if (interface_fee != 0) {
        const auto interface_payer_status = kal_fees::check_fee_payer(owner);
        if (!interface_payer_status.ok()) return interface_payer_status;
    }
    uint256_t required = network_fee;
    if (interface_fee != 0 && txn.base().interface_fee_id() == NETWORK_CONTRACT &&
        !checked_add_uint256(required, interface_fee, required))
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "Combined registration fee overflows",
                         kal_txn::INVALID_UINT256);
    auto affordability = balance_tracker::preflight_debit(owner, NETWORK_CONTRACT, required);
    if (!affordability.ok() || interface_fee == 0 ||
        txn.base().interface_fee_id() == NETWORK_CONTRACT)
        return affordability;
    return balance_tracker::preflight_debit(owner, txn.base().interface_fee_id(), interface_fee);
}
template <>
KalStatus block_process::process_txn<kal_txn::ValidatorRegistration>(const kal_txn::ValidatorRegistration *txn, kal_txn::TXNStatusFees &status_fees, const kal_txn::TRANSACTION_TYPE &txn_type, const std::string &fee_address, bool sc_txn, const std::string &sc_fee_address)
{
    const auto schema_status = validate_active_transaction_schema(*txn);
    if (!schema_status.ok())
        return schema_status;

    // Block replay and governance callers do not necessarily pass through
    // mempool admission. Reject before nonce or fee state can be staged.
    if (txn->register_() &&
        !validator_endpoint_policy::valid_registration(txn->validator()))
        return KalStatus(
            KalStatus::Code::TXN_FAILED,
            "process_registration.cpp: invalid or oversized validator endpoint",
            kal_txn::TXN_STATUS::INVALID_PARAMETERS);

    uint64_t nonce = txn->base().nonce();
    KalStatus status;

    if (!attestation_registration::valid_metadata_timestamp(*txn))
    {
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "process_registration.cpp: process_txn: Invalid validator metadata timestamp.",
                         kal_txn::TXN_STATUS::INVALID_PARAMETERS);
    }

    std::string attestation_error;
    const auto attestation = attestation_registration::check(*txn, attestation_error);
    if (attestation == attestation_registration::Check::registry_error)
        return KalStatus(KalStatus::Code::DATABASE_ERROR, attestation_error);
    if (attestation == attestation_registration::Check::invalid)
    {
        return KalStatus(KalStatus::Code::BLOCK_FAULTY_TXN, attestation_error,
                         kal_txn::TXN_STATUS::VALIDATOR_ADDRESS);
    }

    if (!gossip_v2::canonical_validator_key(txn->validator().public_key()) ||
        txn->validator().public_key().SerializeAsString() != txn->base().public_key().SerializeAsString() ||
        (txn->register_() && !gossip_v2::canonical_validator_key(txn->generated_public_key())))
        return KalStatus(KalStatus::BLOCK_FAULTY_TXN, "Invalid validator wallet assignment",
                         kal_txn::VALIDATOR_ADDRESS);
    const std::string wallet_adr = wallets::generate_wallet(txn->validator().public_key());
    if (wallet_adr.empty())
        return KalStatus(KalStatus::Code::BLOCK_FAULTY_TXN,
                         "process_registration.cpp: Invalid validator owner wallet",
                         kal_txn::TXN_STATUS::VALIDATOR_ADDRESS);

    status = block_process::check_nonce(txn->validator().public_key(), nonce, txn->base().hash(), sc_txn);

    if (!status.ok())
    {
        return status;
    }

    status = process_registration_fees(txn, status_fees, txn_type, txn->validator().public_key(), fee_address, sc_txn, sc_fee_address);

    if (!status.ok())
    {
        return status;
    }

    // Only this handler's authorized, affordable post-fee outcomes are
    // receipted. Local faults must abort without consuming an owner nonce.
    const auto complete = [&](KalStatus outcome) {
        if (outcome.code() == KalStatus::Code::DATABASE_ERROR)
        {
            database::invalidate_active_overlay();
            return outcome;
        }
        status_fees.set_status(outcome.txn_status());
        if (!sc_txn)
            nonce_tracker::add_nonce(wallet_adr, nonce, txn->base().hash());
        return KalStatus();
    };
    status = kal_fees::process_interface_fees(txn->base(), status_fees);
    if (!status.ok())
        return complete(sc_txn ? status
                               : KalStatus(KalStatus::Code::DATABASE_ERROR,
                                           "process_registration: Interface fee settlement contradicted preflight"));

    const std::string owner_key =
        wallets::get_public_key_string(txn->validator().public_key());
    if (!gossip_v2::canonical_validator_key(txn->validator().public_key()))
    {
        status = KalStatus(KalStatus::Code::TXN_FAILED,
                           "process_registration.cpp: noncanonical validator owner key",
                           kal_txn::TXN_STATUS::VALIDATOR_ADDRESS);
        return complete(status);
    }
    std::string indexed_owner;
    const auto owner_read = validator_wallet_index::read_owner(wallet_adr, indexed_owner);
    if (owner_read != database::BoundedReadStatus::complete &&
        owner_read != database::BoundedReadStatus::not_found)
    {
        database::invalidate_active_overlay();
        return KalStatus(KalStatus::Code::DATABASE_ERROR,
                         "process_registration.cpp: validator wallet index unreadable");
    }
    if (owner_read == database::BoundedReadStatus::complete &&
        indexed_owner != owner_key)
    {
        database::invalidate_active_overlay();
        return KalStatus(KalStatus::Code::DATABASE_ERROR,
                         "process_registration.cpp: validator wallet index owner mismatch");
    }

    if (txn->register_())
    {
        const std::string operational_key =
            wallets::get_public_key_string(txn->generated_public_key());
        std::string registered_bytes;
        std::size_t rows_used = 0, bytes_used = 0;
        const auto operational_read = db_validators::get_single_bounded_checked(
            operational_key, 1, gossip_v2::max_outbox_page_bytes,
            rows_used, bytes_used, registered_bytes);
        if (operational_read != database::BoundedReadStatus::complete &&
            operational_read != database::BoundedReadStatus::not_found)
            return complete(KalStatus(KalStatus::Code::DATABASE_ERROR,
                                      "process_registration.cpp: operational key row is unreadable"));
        if (operational_read == database::BoundedReadStatus::complete)
        {
            kal_txn::Validator registered;
            if (!registered.ParseFromString(registered_bytes) ||
                !registered.has_public_key())
                return complete(KalStatus(KalStatus::Code::DATABASE_ERROR,
                                          "process_registration.cpp: operational key row is malformed"));
            if (wallets::get_public_key_string(registered.public_key()) != owner_key)
                return complete(KalStatus(KalStatus::Code::TXN_FAILED,
                                          "process_registration.cpp: operational key belongs to another validator",
                                          kal_txn::TXN_STATUS::VALIDATOR_ADDRESS));
        }
    }

    std::size_t rows_used = 0, bytes_used = 0;
    const auto validator_read = db_validator_lookup::exists_bounded_checked(
        owner_key, 1, owner_key.size(), rows_used, bytes_used);
    if (validator_read != database::BoundedReadStatus::complete &&
        validator_read != database::BoundedReadStatus::not_found)
        return complete(KalStatus(KalStatus::Code::DATABASE_ERROR,
                                  "process_registration.cpp: Validator lookup is unreadable"));
    if (validator_read == database::BoundedReadStatus::not_found)
    {
        if (!txn->register_())
        {
            logging::print("Validator does not exist, cannot unbond. 1");
            status = KalStatus(KalStatus::Code::TXN_FAILED, "process_registration.cpp: process_txn: Validator does not exist, cannot unbond.", kal_txn::TXN_STATUS::VALIDATOR_ADDRESS);
            return complete(status);
        }
    }
    else
    {
        logging::print("Validator does exist");
    }

    if (txn->register_())
    {
        // Earlier accepted spending/funding and this row's own fee are part
        // of stake eligibility. Never fall back to stale processed DB rows.
        status = check_validator_balance(wallet_adr);
        if (status.ok() && database::overlay_active() &&
            !db_validator_wallet::store_single(wallet_adr, owner_key))
            return complete(KalStatus(KalStatus::Code::DATABASE_ERROR,
                                      "process_registration: Cannot stage validator wallet lock"));
        // This index write is covered by the root/candidate savepoint. Batch
        // storage writes the same owner after acceptance; rollback removes it.
    }
    return complete(status);
}
