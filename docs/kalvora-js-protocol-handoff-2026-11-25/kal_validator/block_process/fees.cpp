// Project-specific headers
#include "fees.h"
#include "fee_split.h"
#include "const.h"
#include "block_process.h"
#include "wallets.h"
#include "validators.h"
#include "db_base.h"
#include "hashing.h"
#include "proposer.h"
#include "signatures.h"
#include "../temp_data/temp_data.h"
#include "../compliance/compliance.h"
#include "utils.h"
#include "../logging/logging.h"
#include "base64.h"
#include "sc_base64.h"
#include "fee_payer.h"
#include "kal_wallet_address.h"
#include "network_contracts.h"
#include "contract_id_derivation.h"
#include "db_key.h"
#include "validator_wallet_index.h"
#include "base58.h"
#include <map>
#include <limits>
#include <utility>
#include <vector>

namespace
{
KalStatus fee_cap_below_quote()
{
    KalStatus denied(KalStatus::Code::COIN_TXN_ERROR,
                     "calculate_fees: Signed fee cap is below the valid quote",
                     kal_txn::TXN_STATUS::INSUFFICIENT_AMOUNT);
    denied.mark_hard_reject(KalStatus::HardRejectKind::CannotPayFee);
    return denied;
}

uint256_t divide_round_up(
    const uint256_t &numerator,
    const uint256_t &denominator)
{
    if (numerator == 0)
    {
        return 0;
    }

    return (numerator / denominator) +
           (numerator % denominator != 0 ? 1 : 0);
}

// A fee quote is consensus-visible. Reject an unrepresentable intermediate
// instead of letting fixed-width arithmetic turn a positive fee into zero.
bool quote_component(const uint256_t &usd_amount,
                     const uint256_t &denomination,
                     const uint256_t &usd_equiv,
                     uint256_t &component)
{
    uint256_t product;
    if (!checked_mul_uint256(usd_amount, denomination, product))
        return false;
    component = divide_round_up(product, usd_equiv);
    return true;
}

KalStatus calculate_checked_base_fee(const uint256_t &usd_equiv,
                                     const uint256_t &fee_per_byte,
                                     int bytes,
                                     const std::string &denomination_str,
                                     const kal_txn::PublicKey *public_key,
                                     bool safe_send,
                                     uint32_t additional_stage_divisor,
                                     const std::string &contract_id,
                                     uint256_t &fee_amount,
                                     uint256_t &denomination,
                                     uint32_t additional_stage_count = 1,
                                     const kal_txn::PublicKey *additional_signer = nullptr)
{
    if (bytes < 0 || usd_equiv == 0 ||
        !parse_uint256(denomination_str, denomination) || denomination == 0)
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "calculate_fees: Invalid fee conversion inputs.",
                         kal_txn::TXN_STATUS::INVALID_CONTRACT_PARAMETERS);

    uint256_t byte_fee, total;
    if (!checked_mul_uint256(fee_per_byte, uint256_t(bytes), byte_fee) ||
        !quote_component(byte_fee, denomination, usd_equiv, total))
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "calculate_fees: Byte fee arithmetic overflow.",
                         kal_txn::TXN_STATUS::INVALID_CONTRACT_PARAMETERS);

    uint256_t component;
    if (safe_send &&
        (!quote_component(get_fee("SAFE_SEND"), denomination, usd_equiv, component) ||
         !checked_add_uint256(total, component, total)))
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "calculate_fees: Safe-send fee arithmetic overflow.",
                         kal_txn::TXN_STATUS::INVALID_CONTRACT_PARAMETERS);

    if (public_key != nullptr)
    {
        uint256_t key_fee;
        if (!get_key_fee_checked(*public_key, key_fee, additional_signer) ||
            !quote_component(key_fee, denomination, usd_equiv, component) ||
            !checked_add_uint256(total, component, total))
            return KalStatus(KalStatus::Code::TXN_FAILED,
                             "calculate_fees: Key fee arithmetic overflow.",
                             kal_txn::TXN_STATUS::INVALID_CONTRACT_PARAMETERS);
    }

    if (additional_stage_divisor > 0)
    {
        component = divide_round_up(total, uint256_t(additional_stage_divisor));
        if (!checked_mul_uint256(component, uint256_t(additional_stage_count), component) ||
            !checked_add_uint256(total, component, total))
            return KalStatus(KalStatus::Code::TXN_FAILED,
                             "calculate_fees: Stage fee arithmetic overflow.",
                             kal_txn::TXN_STATUS::INVALID_CONTRACT_PARAMETERS);
    }

    if (contract_id != NETWORK_CONTRACT &&
        !checked_mul_uint256(total, get_fee(TOKEN_MULTIPLIER), total))
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "calculate_fees: Token multiplier arithmetic overflow.",
                         kal_txn::TXN_STATUS::INVALID_CONTRACT_PARAMETERS);

    fee_amount = total;
    return KalStatus();
}

static_assert(VALIDATOR_FEE_PERCENTAGE + TREASURY_FEE_PERCENTAGE + BURN_FEE_PERCENTAGE == 100);

// Fee-policy state is contract-controlled, so a policy whose percentages are not
// each at most 100 and summing to exactly 100 uses the compiled-in split. Burn
// receives the exact remainder so credits always equal the debited amount.
fee_split::Allocation network_fee_split(const uint256_t &fee_amount)
{
    const uint256_t validator = get_fee("VALIDATOR_FEE_PERCENTAGE");
    const uint256_t treasury = get_fee("TREASURY_FEE_PERCENTAGE");
    const uint256_t burn = get_fee("BURN_FEE_PERCENTAGE");
    fee_split::Allocation split;
    if (validator > 100 || treasury > 100 || burn > 100 || validator + treasury + burn != 100 ||
        !fee_split::calculate(treasury.str(), validator.str(), fee_amount, split))
    {
        fee_split::calculate(std::to_string(TREASURY_FEE_PERCENTAGE),
                             std::to_string(VALIDATOR_FEE_PERCENTAGE), fee_amount, split);
    }
    return split;
}

KalStatus check_interface_fee_compliance(const std::string &contract_id,
                                         const std::vector<std::string> &payers,
                                         const std::string &recipient)
{
    std::string contract_data;
    kal_txn::InstrumentContract contract;
    std::size_t rows_used = 0, bytes_used = 0;
    const auto read = db_contracts::get_single_bounded_checked(
        contract_id, 1, std::numeric_limits<std::size_t>::max(),
        rows_used, bytes_used, contract_data);
    if (read == database::BoundedReadStatus::not_found)
    {
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "process_interface_fees: Interface fee contract not found",
                         kal_txn::TXN_STATUS::INVALID_CONTRACT);
    }
    if (read != database::BoundedReadStatus::complete ||
        !contract.ParseFromString(contract_data) ||
        contract.contract_id() != contract_id)
    {
        database::invalidate_active_overlay();
        return KalStatus(KalStatus::Code::DATABASE_ERROR,
                         "process_interface_fees: Interface fee contract state is unreadable or corrupt");
    }

    if (!contract.kyc_status())
    {
        return KalStatus();
    }

    for (const auto &payer : payers)
    {
        if (!compliance::check_compliance(payer, contract))
        {
            return KalStatus(KalStatus::Code::TXN_FAILED,
                             "process_interface_fees: Fee payer compliance check failed",
                             kal_txn::TXN_STATUS::COMPLIANCE_CHECK_FAILED);
        }
    }
    if (!compliance::check_compliance(recipient, contract))
    {
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "process_interface_fees: Fee recipient compliance check failed",
                         kal_txn::TXN_STATUS::COMPLIANCE_CHECK_FAILED);
    }
    return KalStatus();
}
}

KalStatus kal_fees::quote_base_fee(
    const uint256_t &fee_amount,
    const std::string &current_validator_address,
    BaseFeeQuote &quote)
{
    BaseFeeQuote next;
    next.validator_wallet = current_validator_address.empty()
        ? ValidatorConfig::get_fee_address_string()
        : current_validator_address;

    std::vector<uint8_t> treasury_bytes;
    const std::string treasury_encoded = ValidatorConfig::get_treasury_wallet();
    if (!kal_wallet_address::valid_raw(next.validator_wallet) ||
        !base58_decode_bounded(treasury_encoded, treasury_bytes, kal_wallet_address::MAX_QUERY_ENCODED_ADDRESS_BYTES) ||
        !kal_wallet_address::valid_raw(std::string(treasury_bytes.begin(), treasury_bytes.end())))
        return KalStatus(KalStatus::Code::DATABASE_ERROR,
                         "process_fees: Invalid consensus fee recipient");

    next.treasury_wallet.assign(treasury_bytes.begin(), treasury_bytes.end());
    next.burn_wallet = BURN_WALLET;
    next.allocation = network_fee_split(fee_amount);
    quote = std::move(next);
    return KalStatus();
}

bool kal_fees::get_cur_equiv_validator(const std::string &contract_id, uint256_t &cur_equiv)
{
    if(!kalvora::contract_id::decode_and_validate(contract_id) ||
       !db_contracts::exist(contract_id))
    {
        cur_equiv = 1;
        return false;
    }

    std::string stable_coin_contract;
    network_contracts::get_stable_coin_id(stable_coin_contract);
    
    if(contract_id == stable_coin_contract)
    {
        cur_equiv = ONE_DOLLAR;
        return true;
    } 
    if (contract_id == NETWORK_CONTRACT)
    {
        // A public DEX reserve ratio is not a trusted protocol fee oracle.
        // Keep the launch KAL fee conversion at its existing dollar fallback.
        cur_equiv = ONE_DOLLAR;
        return true;
    }

    // The only rates currently populated for other assets come from public
    // DEX pools. Until an independent price source is committed by consensus,
    // do not count those assets toward validator fee/stake value.
    cur_equiv = 1;
    return false;
}

// function to get the cur equivalent of both the token and the fee token
// 1.00$ = 1 000 000 000 000 000 000
bool kal_fees::get_cur_equiv(const std::string &contract_id, uint256_t &cur_equiv)
{
    return get_cur_equiv_eligibility(contract_id, cur_equiv) ==
           FeeEligibility::Eligible;
}

kal_fees::FeeEligibility kal_fees::get_cur_equiv_eligibility(
    const std::string &contract_id, uint256_t &cur_equiv)
{
    cur_equiv = 1;
    if (!kalvora::contract_id::decode_and_validate(contract_id))
        return FeeEligibility::StateFault;

    // KAL is allowed independently of stable-asset configuration, but its
    // canonical contract must still be readable on this validator.
    if (contract_id == NETWORK_CONTRACT)
    {
        std::string contract_data;
        kal_txn::InstrumentContract contract;
        if (!db_contracts::get_single(contract_id, contract_data) ||
            !contract.ParseFromString(contract_data) ||
            contract.contract_id() != contract_id)
            return FeeEligibility::StateFault;
        cur_equiv = ONE_DOLLAR;
        return FeeEligibility::Eligible;
    }

    // A local absence cannot prove that the canonical chain has no stable
    // fee asset. An approved governance child must not record a terminal
    // CannotPayFee outcome from a missing policy row until parent state is
    // authenticated. KAL remains independently eligible above.
    std::size_t policy_rows = 0;
    std::size_t policy_bytes = 0;
    std::string configured_stable;
    const auto policy_read = db_smart_contract_states::get_single_bounded_checked(
        db_key::legacy_smart_contract_state(STABLE_COIN_SC), 1, 4096,
        policy_rows, policy_bytes, configured_stable);
    if (policy_read != database::BoundedReadStatus::not_found &&
        policy_read != database::BoundedReadStatus::complete)
        return FeeEligibility::StateFault;
    if (policy_read == database::BoundedReadStatus::not_found)
        return FeeEligibility::StateFault;
    if (configured_stable == NO_STABLE_COIN_POLICY)
        return FeeEligibility::Ineligible;

    std::string stable_coin_contract;
    if (!network_contracts::get_stable_coin_id(stable_coin_contract))
        return FeeEligibility::StateFault;
    std::string stable_contract_data;
    kal_txn::InstrumentContract stable_contract;
    if (!db_contracts::get_single(stable_coin_contract, stable_contract_data) ||
        !stable_contract.ParseFromString(stable_contract_data) ||
        stable_contract.contract_id() != stable_coin_contract)
        return FeeEligibility::StateFault;

    // No row for this signed ID is needed: only KAL and the configured stable
    // asset are accepted for network fees, regardless of DEX or whitelist rows.
    if (contract_id != stable_coin_contract)
        return FeeEligibility::Ineligible;

    cur_equiv = ONE_DOLLAR;
    return FeeEligibility::Eligible;
}

KalStatus kal_fees::check_allowed_contract_fee(const google::protobuf::RepeatedPtrField<std::string> &allowed_fees, const std::string contract_id, kal_fees::ALLOWED_CONTRACT_FEE &allowed_fee)
{
    if (!kalvora::contract_id::decode_and_validate(contract_id))
    {
        return KalStatus(
            KalStatus::Code::TXN_FAILED,
            "process_utils.cpp: check_contract_fee_id: Malformed fee contract ID",
            kal_txn::TXN_STATUS::INVALID_CONTRACT_ID);
    }

    allowed_fee = kal_fees::ALLOWED_CONTRACT_FEE::NOT_ALLOWED;
    bool qualified_allowed = false;
    bool any_allowed = false;
    for (const auto &fee_id : allowed_fees)
    {
        if (fee_id == "QUALIFIED")
        {
            qualified_allowed = true;
        }
        else if (fee_id == "ANY")
        {
            any_allowed = true;
        }
        else if (contract_id == fee_id)
        {
            allowed_fee = kal_fees::ALLOWED_CONTRACT_FEE::ALLOWED;
            break;
        }
    }

    // An explicit token remains allowed even when a preceding QUALIFIED
    // marker would not authorize it. The marker is only a fallback.
    if (allowed_fee == kal_fees::ALLOWED_CONTRACT_FEE::NOT_ALLOWED)
    {
        if (any_allowed)
            allowed_fee = kal_fees::ALLOWED_CONTRACT_FEE::ANY;
        else if (qualified_allowed)
            allowed_fee = kal_fees::ALLOWED_CONTRACT_FEE::QUALIFIED;
    }

    if (allowed_fee == kal_fees::ALLOWED_CONTRACT_FEE::NOT_ALLOWED)
    {
        return KalStatus(KalStatus::Code::TXN_FAILED, "process_utils.cpp: check_contract_fee_id: Fee contract id is not allowed: " + contract_id, kal_txn::TXN_STATUS::INVALID_CONTRACT_FEE_ID);
    }

    if (!db_contracts::exist(contract_id))
    {
        return KalStatus(KalStatus::Code::TXN_FAILED, "process_utils.cpp: check_contract_fee_id: Fee contract id does not exist", kal_txn::TXN_STATUS::INVALID_CONTRACT_FEE_ID);
    }

    return KalStatus();
}

// function to check if token is qualified, and get the usd equiv of token
bool kal_fees::check_qualified(const std::string &contract_id)
{
    if (!kalvora::contract_id::decode_and_validate(contract_id) ||
        !db_contracts::exist(contract_id))
    {
        return false;
    }

    if (contract_id == KALV_CONTRACT_ID)
    {
        return true;
    }

    std::string stable_coin_contract;
    if (!network_contracts::get_stable_coin_id(stable_coin_contract) ||
        contract_id != stable_coin_contract)
    {
        // A public DEX price or whitelist cannot qualify an arbitrary asset
        // for dollar-denominated proposal and contract fees.
        return false;
    }

    std::string fee_token_data;
    kal_validator::FeeToken fee_token;
    // The configured stable coin has a fixed protocol quote. Its DEX-backed
    // authorization bit is intentionally false, but a canonical row must
    // still be present and belong to the configured contract.
    return db_fee_tokens::get_single(
               db_key::fee_token(FEE_TOKENS, contract_id), fee_token_data) &&
           fee_token.ParseFromString(fee_token_data) &&
           fee_token.contract_id() == contract_id;
}

KalStatus kal_fees::calculate_fees(const uint256_t &TOKEN_USD_EQIV, const uint256_t &FEE_PER_BYTE, const int &bytes,
                                     const std::string &authorized_fees, uint256_t &txn_fee_amount, std::string denomination_str, const kal_txn::PublicKey &public_key, const std::string &contract_id, const bool safe_send, const uint32_t additional_stage_divisor, const bool reserve_quota, const uint32_t additional_stage_count,
                                     const kal_txn::PublicKey *additional_signer)
{
    uint256_t authorized_fees_uint;
    if (!parse_uint256(authorized_fees, authorized_fees_uint))
    {
        KalStatus invalid(KalStatus::Code::TXN_FAILED,
                          "calculate_fees: Invalid authorized fee amount.",
                          kal_txn::TXN_STATUS::INVALID_UINT256);
        invalid.mark_hard_reject(KalStatus::HardRejectKind::InvalidChildParameters);
        return invalid;
    }

    uint256_t denomination;
    KalStatus quote = calculate_checked_base_fee(
        TOKEN_USD_EQIV, FEE_PER_BYTE, bytes, denomination_str, &public_key,
        safe_send, additional_stage_divisor, contract_id, txn_fee_amount,
        denomination, additional_stage_count, additional_signer);
    if (!quote.ok())
        return quote;


    if (txn_fee_amount > authorized_fees_uint)
    {
        logging::print("process_coin.cpp: calculate_fees: The sender did not authorize enough fees.", txn_fee_amount.str(), true);
        logging::print("authorized_fees_uint: ", authorized_fees_uint.str(), true);
        return fee_cap_below_quote();
    }

    if (reserve_quota && contract_id != NETWORK_CONTRACT &&
        !fee_token_tracker::add_temp_fee_token(
            contract_id, txn_fee_amount, denomination))
    {
        return KalStatus(KalStatus::Code::COIN_TXN_ERROR, "process_coin.cpp: calculate_fees: Failed to add temp fee token.", kal_txn::TXN_STATUS::INSUFFICIENT_AMOUNT);
    }

    return KalStatus();
}

KalStatus kal_fees::calculate_fees(const uint256_t &TOKEN_USD_EQIV, const uint256_t &FEE_PER_BYTE, const int &bytes,
                                     const std::string &authorized_fees, uint256_t &txn_fee_amount, std::string denomination_str, const std::string &contract_id, bool safe_send, bool reserve_quota)
{
    uint256_t authorized_fees_uint;
    if (!parse_uint256(authorized_fees, authorized_fees_uint))
    {
        KalStatus invalid(KalStatus::Code::TXN_FAILED,
                          "calculate_fees: Invalid authorized fee amount.",
                          kal_txn::TXN_STATUS::INVALID_UINT256);
        invalid.mark_hard_reject(KalStatus::HardRejectKind::InvalidChildParameters);
        return invalid;
    }

    uint256_t denomination;
    KalStatus quote = calculate_checked_base_fee(
        TOKEN_USD_EQIV, FEE_PER_BYTE, bytes, denomination_str, nullptr,
        safe_send, 0, contract_id, txn_fee_amount, denomination);
    if (!quote.ok())
        return quote;

    if (txn_fee_amount > authorized_fees_uint)
    {
        logging::print("process_coin.cpp: calculate_fees: The sender did not authorize enough fees.", txn_fee_amount.str(), true);
        logging::print("authorized_fees_uint: ", authorized_fees_uint.str(), true);
        return fee_cap_below_quote();
    }

    if (reserve_quota && contract_id != NETWORK_CONTRACT &&
        !fee_token_tracker::add_temp_fee_token(
            contract_id, txn_fee_amount, denomination))
    {
        return KalStatus(KalStatus::Code::COIN_TXN_ERROR, "process_coin.cpp: calculate_fees: Failed to add temp fee token.", kal_txn::TXN_STATUS::INSUFFICIENT_AMOUNT);
    }

    return KalStatus();
}

KalStatus kal_fees::calculate_fees_heartbeat(const uint256_t &TOKEN_USD_EQIV, const uint256_t &FEE_PER_BYTE, const int &bytes,
                                               const std::string &authorized_fees, uint256_t &txn_fee_amount, std::string denomination_str, const kal_txn::PublicKey &public_key, const std::string &contract_id, bool reserve_quota)
{
    uint256_t authorized_fees_uint;
    if (!parse_uint256(authorized_fees, authorized_fees_uint))
    {
        KalStatus invalid(KalStatus::Code::TXN_FAILED,
                          "calculate_fees_heartbeat: Invalid authorized fee amount.",
                          kal_txn::TXN_STATUS::INVALID_UINT256);
        invalid.mark_hard_reject(KalStatus::HardRejectKind::InvalidChildParameters);
        return invalid;
    }

    uint256_t denomination;
    KalStatus quote = calculate_checked_base_fee(
        TOKEN_USD_EQIV, FEE_PER_BYTE, bytes, denomination_str, &public_key,
        false, 0, contract_id, txn_fee_amount, denomination);
    if (!quote.ok())
        return quote;


    if (txn_fee_amount > authorized_fees_uint)
    {
        return fee_cap_below_quote();
    }

    if (reserve_quota && contract_id != NETWORK_CONTRACT &&
        !fee_token_tracker::add_temp_fee_token(
            contract_id, txn_fee_amount, denomination))
    {
        return KalStatus(KalStatus::Code::COIN_TXN_ERROR, "process_coin.cpp: calculate_fees: Failed to add temp fee token.", kal_txn::TXN_STATUS::INSUFFICIENT_AMOUNT);
    }

    return KalStatus();
}

KalStatus kal_fees::check_fee_payer(const std::string &wallet,
                                    bool own_validator_network_fee)
{
    std::string owner;
    const auto read = validator_wallet_index::read_owner(wallet, owner);
    if (read == database::BoundedReadStatus::not_found)
        return KalStatus();
    if (read != database::BoundedReadStatus::complete ||
        !kal_wallet_address::valid_raw(owner) || owner != wallet)
    {
        database::invalidate_active_overlay();
        return KalStatus(KalStatus::Code::DATABASE_ERROR,
                         "fees: Validator wallet index is unreadable or inconsistent");
    }
    if (own_validator_network_fee)
        return KalStatus();
    KalStatus denied(KalStatus::Code::TXN_FAILED,
                     "fees: Registered or unbonding validator wallet cannot fund this payment",
                     kal_txn::TXN_STATUS::VALIDATOR_ADDRESS);
    denied.mark_hard_reject(KalStatus::HardRejectKind::CannotPayFee);
    return denied;
}

KalStatus kal_fees::process_fees(const kal_txn::InstrumentContract &contract, uint256_t fee_amount,
                                   const std::string &wallet_adr, const std::string &fee_symbol,
                                   bool base, kal_txn::TXNStatusFees &status_fees, const std::string &txn_hash, const std::string &current_validator_address, const bool storage_fees, bool own_validator_network_fee)
{
    if (!storage_fees)
    {
        const auto payer_status = check_fee_payer(
            wallet_adr, base && own_validator_network_fee);
        if (!payer_status.ok())
            return payer_status;
    }

    fee_split::Allocation split;
    if (!base && !fee_split::calculate(contract.contract_fees().burn(),
                                        contract.contract_fees().validator(), fee_amount, split))
    {
        return KalStatus(KalStatus::Code::TXN_FAILED, "process_fees: Invalid contract fee shares", kal_txn::TXN_STATUS::INVALID_CONTRACT_PARAMETERS);
    }
    if (!base && (split.remainder_percent > 0 || split.remainder > 0) &&
        !kal_wallet_address::valid_raw(contract.contract_fees().fee_address()) &&
        contract.contract_fees().fee_address() != BURN_WALLET)
    {
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "process_fees: Invalid contract fee recipient",
                         kal_txn::TXN_STATUS::INVALID_CONTRACT_PARAMETERS);
    }

    // A prior fee component and this charge must fit the receipt type before
    // any payer debit, recipient credit, or fee-row cache write is staged.
    const bool has_prior_base_fee =
        base && !storage_fees && is_valid_uint256(status_fees.base_fees());
    uint256_t total_base_fee = fee_amount;
    if (has_prior_base_fee &&
        !checked_add_uint256(uint256_t(status_fees.base_fees()),
                             fee_amount, total_base_fee))
        return KalStatus(KalStatus::Code::DATABASE_ERROR,
                         "process_fees: Base fee receipt overflow");

    BaseFeeQuote base_quote;
    std::string validator_fee_address;
    std::string treasury_wallet;
    if (base)
    {
        // The read-only projector and live settlement share the same policy
        // fallback, rounding and validated recipients.
        const KalStatus quote_status = quote_base_fee(
            fee_amount, current_validator_address, base_quote);
        if (!quote_status.ok())
            return quote_status;
        validator_fee_address = base_quote.validator_wallet;
        treasury_wallet = base_quote.treasury_wallet;
    }
    else
    {
        validator_fee_address = current_validator_address.empty()
            ? ValidatorConfig::get_fee_address_string()
            : current_validator_address;
        const auto treasury_bytes =
            base58_decode(ValidatorConfig::get_treasury_wallet());
        treasury_wallet.assign(treasury_bytes.begin(), treasury_bytes.end());
    }

    const uint256_t zero_256 = 0;
    uint256_t sender_balance;
    KalStatus status = KalStatus();
    if (!storage_fees)
    {
        status = balance_tracker::subtract_txn_balance(wallet_adr, fee_symbol, fee_amount, txn_hash);
    }

    if (!status.ok())
    {
        logging::print("process_utils.cpp: process_fees: ", status.read_status());

        if (status.code() == KalStatus::Code::DATABASE_ERROR)
            return status;

        if (base)
        {
            return KalStatus(KalStatus::Code::WALLET_INSUFFICIENT_FUNDS, "process_utils.cpp: process_fess: " + status.read_status());
        }

        return status;
    }
    uint256_t burn_percent = 0;
    uint256_t validator_percent = 0;
    uint256_t treasury_percent = 0;

    uint256_t validator_fee = 0;
    uint256_t contract_fee = 0;
    uint256_t treasury_fee = 0;
    uint256_t burn_fee = 0;

    if (!base)
    {
        burn_percent = split.share_percent;
        validator_percent = split.validator_percent;
        validator_fee = split.validator;
        burn_fee = split.share;
        contract_fee = split.remainder;
    }
    else
    {
        split = base_quote.allocation;
        validator_percent = split.validator_percent;
        treasury_percent = split.share_percent;
        burn_percent = split.remainder_percent;
        validator_fee = split.validator;
        treasury_fee = split.share;
        burn_fee = split.remainder;
    }
    if (validator_percent > zero_256)
    {
        balance_tracker::add_txn_balance(validator_fee_address, fee_symbol, validator_fee, txn_hash);
        proposing::set_txn_token_fees(txn_hash, fee_symbol, validator_fee_address, validator_fee);
    }
    if (treasury_percent > zero_256)
    {
        balance_tracker::add_txn_balance(treasury_wallet, fee_symbol, treasury_fee, txn_hash);
        proposing::set_txn_token_fees(txn_hash, fee_symbol, treasury_wallet, treasury_fee);
    }
    if (burn_percent > zero_256 || burn_fee > zero_256)
    {
        const std::string &burn_wallet = base ? base_quote.burn_wallet : BURN_WALLET;
        balance_tracker::add_txn_balance(burn_wallet, fee_symbol, burn_fee, txn_hash);
        proposing::set_txn_token_fees(txn_hash, fee_symbol, burn_wallet, burn_fee);
    }
    if (!base && (split.remainder_percent > 0 || contract_fee > zero_256))
    {
        balance_tracker::add_txn_balance(contract.contract_fees().fee_address(), fee_symbol, contract_fee, txn_hash);
        proposing::set_txn_token_fees(txn_hash, fee_symbol, contract.contract_fees().fee_address(), contract_fee);
    }

    if (!storage_fees && base)
    {
        if (has_prior_base_fee)
            status_fees.set_base_fees(total_base_fee.str());
        else
        {
            status_fees.set_base_contract_id(fee_symbol);
            status_fees.set_base_fees(fee_amount.str());
        }
    }
    else if (storage_fees)
    {
        status_fees.set_native_function_fees(boost::lexical_cast<std::string>(fee_amount));
    }

    return KalStatus(KalStatus::Code::OK);
}
KalStatus kal_fees::process_interface_fees(const kal_txn::CoinTXN *txn, kal_txn::TXNStatusFees &status_fees)
{
    kal_txn::BaseTXN base = txn->base();

    if (base.interface_fee().empty())
    {
        return KalStatus();
    }

    uint256_t interface_fee;
    if (!parse_uint256(base.interface_fee(), interface_fee))
    {
        return KalStatus(KalStatus::Code::TXN_FAILED, "process_utils.cpp: process_interface_fees: Invalid interface fee", kal_txn::TXN_STATUS::INVALID_UINT256);
    }

    if (interface_fee <= 0)
    {
        return KalStatus();
    }

    if (base.interface_fee_id().empty())
    {
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "process_interface_fees: Positive interface fee requires an instrument",
                         kal_txn::TXN_STATUS::INVALID_CONTRACT_FEE_ID);
    }

    if (!kal_wallet_address::valid_raw(base.interface_address()) &&
        base.interface_address() != BURN_WALLET)
    {
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "process_interface_fees: Invalid interface fee recipient address",
                         kal_txn::TXN_STATUS::INVALID_WALLET_ADDRESS);
    }

    std::string contract_id = base.interface_fee_id();
    std::string interface_wallet = base.interface_address();
    std::string interface_amount = base.interface_fee();
    const uint256_t fee_amount = interface_fee;
    std::string txn_hash = base.hash();

    const int payer_count = txn->auth().public_key_size();
    if (payer_count == 0)
    {
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "process_interface_fees: No interface fee payer",
                         kal_txn::TXN_STATUS::INVALID_PARAMETERS);
    }

    const uint256_t divided_fee = fee_amount / payer_count;

    std::map<std::string, uint256_t> required_by_wallet;
    std::vector<std::string> payers;
    int payer_index = 1;
    for (const auto &auth : txn->auth().public_key())
    {
        const uint256_t auth_fee = payer_index == payer_count
                                           ? fee_amount - divided_fee * (payer_index - 1)
                                           : divided_fee;
        const std::string auth_wallet = wallets::generate_wallet(auth);
        uint256_t aggregate;
        if (!checked_add_uint256(required_by_wallet[auth_wallet], auth_fee, aggregate))
        {
            return KalStatus(KalStatus::Code::TXN_FAILED,
                             "process_interface_fees: Aggregate payer fee overflow",
                             kal_txn::TXN_STATUS::INVALID_PARAMETERS);
        }
        required_by_wallet[auth_wallet] = aggregate;
        payers.push_back(auth_wallet);
        ++payer_index;
    }

    KalStatus status = check_interface_fee_compliance(contract_id, payers, interface_wallet);
    if (!status.ok())
    {
        return status;
    }

    // Check every payer against the current candidate balance before the first
    // debit. A later payer's failure must not leave an earlier payer charged.
    for (const auto &payer : required_by_wallet)
    {
        status = check_fee_payer(payer.first);
        if (!status.ok())
            return status;
        const std::string balance_key = db_key::wallet_contract(payer.first, contract_id);
        std::string balance_str;
        if (!db_processed_wallets::get_single(balance_key, balance_str) &&
            !db_wallets::get_single(balance_key, balance_str))
        {
            return KalStatus(KalStatus::Code::TXN_FAILED,
                             "process_interface_fees: Fee payer wallet does not exist",
                             kal_txn::TXN_STATUS::INVALID_WALLET_ADDRESS);
        }
        uint256_t available;
        if (!parse_uint256(balance_str, available))
        {
            return KalStatus(KalStatus::Code::DATABASE_ERROR,
                             "process_interface_fees: Invalid fee payer balance",
                             kal_txn::TXN_STATUS::INVALID_UINT256);
        }
        if (available < payer.second)
        {
            return KalStatus(KalStatus::Code::TXN_FAILED,
                             "process_interface_fees: Fee payer has insufficient balance",
                             kal_txn::TXN_STATUS::INSUFFICIENT_AMOUNT);
        }
    }

    int x = 1;
    for (auto auth : txn->auth().public_key())
    {
        uint256_t auth_fee = divided_fee;
        if (x == txn->auth().public_key_size())
        {
            auth_fee = fee_amount - (divided_fee * (x - 1));
        }

        auto auth_wallet = wallets::generate_wallet(auth);
        status = balance_tracker::subtract_txn_balance(auth_wallet, contract_id, auth_fee, txn_hash);

        if (!status.ok())
        {
            logging::print("process_interface_fees.cpp: ", status.read_status());
            if (status.code() == KalStatus::Code::DATABASE_ERROR)
                return status;

            return KalStatus(KalStatus::Code::TXN_FAILED, "process_utils.cpp: process_fess: " + status.read_status(), kal_txn::TXN_STATUS::INSUFFICIENT_AMOUNT);
        }

        x++;
    }

    balance_tracker::add_txn_balance(interface_wallet, contract_id, fee_amount, txn_hash);
    proposing::set_txn_token_fees(txn_hash, contract_id, interface_wallet, fee_amount);

    status_fees.set_interface_fee(interface_amount);
    status_fees.set_interface_fee_id(contract_id);

    return KalStatus();
}

KalStatus kal_fees::preflight_interface_fees(const kal_txn::BaseTXN &base,
                                             const std::string &preceding_fee_id,
                                             const uint256_t &preceding_fee_amount,
                                             const std::string &preceding_payer,
                                             bool own_validator_network_fee)
{
    // Check the network payer even when the optional interface fee is absent.
    // A vote's type exception does not authorize its locked sponsor.
    auto payer_status = check_fee_payer(
        preceding_payer, own_validator_network_fee && !fee_payer::has(base));
    if (!payer_status.ok())
        return payer_status;
    if (fee_payer::has(base) && fee_payer::source_wallet(base) != preceding_payer)
    {
        payer_status = check_fee_payer(fee_payer::source_wallet(base));
        if (!payer_status.ok())
            return payer_status;
    }
    // Match process_interface_fees' optional-field and zero-fee behavior.
    if (base.interface_fee().empty())
        return KalStatus();

    uint256_t interface_fee;
    if (!parse_uint256(base.interface_fee(), interface_fee))
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "process_interface_fees: Invalid interface fee",
                         kal_txn::TXN_STATUS::INVALID_UINT256);
    if (interface_fee == 0)
        return KalStatus();

    if (base.interface_fee_id().empty())
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "process_interface_fees: Positive interface fee requires an instrument",
                         kal_txn::TXN_STATUS::INVALID_CONTRACT_FEE_ID);

    if (!kal_wallet_address::valid_raw(base.interface_address()) &&
        base.interface_address() != BURN_WALLET)
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "process_interface_fees: Invalid interface fee recipient address",
                         kal_txn::TXN_STATUS::INVALID_WALLET_ADDRESS);

    const std::string payer = fee_payer::source_wallet(base);
    payer_status = check_fee_payer(payer);
    if (!payer_status.ok())
        return payer_status;
    KalStatus status = check_interface_fee_compliance(
        base.interface_fee_id(), {payer}, base.interface_address());
    if (!status.ok())
        return status;

    uint256_t required = interface_fee;
    if (base.interface_fee_id() == preceding_fee_id && payer == preceding_payer &&
        !checked_add_uint256(required, preceding_fee_amount, required))
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "process_interface_fees: Combined fee amount overflow",
                         kal_txn::TXN_STATUS::INVALID_UINT256);

    status = balance_tracker::preflight_debit(
        payer, base.interface_fee_id(), required);
    if (status.code() == KalStatus::Code::DATABASE_ERROR)
        database::invalidate_active_overlay();
    if (status.code() == KalStatus::Code::WALLET_INSUFFICIENT_FUNDS)
        status.mark_hard_reject(KalStatus::HardRejectKind::CannotPayFee);
    return status;
}

KalStatus kal_fees::preflight_interface_fees(
    const kal_txn::CoinTXN &txn, const std::string &base_fee_id,
    const std::map<std::string, uint256_t> &base_charges)
{
    // Coin can express sponsorship as another authenticated input. Check
    // every input, including a zero-share payer, before any fee is staged.
    for (const auto &auth : txn.auth().public_key())
    {
        const auto status = check_fee_payer(wallets::generate_wallet(auth));
        if (!status.ok())
            return status;
    }
    for (const auto &charge : base_charges)
    {
        const auto status = check_fee_payer(charge.first);
        if (!status.ok())
            return status;
    }
    const auto &base = txn.base();
    if (base.interface_fee().empty())
        return KalStatus();
    uint256_t amount;
    if (!parse_uint256(base.interface_fee(), amount))
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "Coin interface fee is malformed", kal_txn::TXN_STATUS::INVALID_UINT256);
    if (amount == 0)
        return KalStatus();
    if (base.interface_fee_id().empty())
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "Coin interface fee has no instrument", kal_txn::TXN_STATUS::INVALID_CONTRACT_FEE_ID);
    if (!kal_wallet_address::valid_raw(base.interface_address()) &&
        base.interface_address() != BURN_WALLET)
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "Coin interface fee recipient is invalid", kal_txn::TXN_STATUS::INVALID_WALLET_ADDRESS);
    const int count = txn.auth().public_key_size();
    if (count == 0)
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "Coin interface fee has no payer", kal_txn::TXN_STATUS::INVALID_PARAMETERS);
    std::map<std::string, uint256_t> required;
    std::vector<std::string> payers;
    const uint256_t share = amount / count;
    for (int i = 0; i < count; ++i)
    {
        const std::string wallet = wallets::generate_wallet(txn.auth().public_key(i));
        const uint256_t due = i + 1 == count ? amount - share * (count - 1) : share;
        if (!checked_add_uint256(required[wallet], due, required[wallet]))
            return KalStatus(KalStatus::Code::TXN_FAILED,
                             "Coin interface fee payer sum overflows", kal_txn::TXN_STATUS::INVALID_UINT256);
        payers.push_back(wallet);
    }
    auto status = check_interface_fee_compliance(base.interface_fee_id(), payers,
                                                 base.interface_address());
    if (!status.ok())
        return status;
    for (auto &[wallet, due] : required)
    {
        if (base.interface_fee_id() == base_fee_id)
        {
            const auto prior = base_charges.find(wallet);
            if (prior != base_charges.end() &&
                !checked_add_uint256(due, prior->second, due))
                return KalStatus(KalStatus::Code::TXN_FAILED,
                                 "Combined Coin fee overflows", kal_txn::TXN_STATUS::INVALID_UINT256);
        }
        status = balance_tracker::preflight_debit(wallet, base.interface_fee_id(), due);
        if (!status.ok())
        {
            if (status.code() == KalStatus::Code::DATABASE_ERROR)
                database::invalidate_active_overlay();
            if (status.code() == KalStatus::Code::WALLET_INSUFFICIENT_FUNDS)
                status.mark_hard_reject(KalStatus::HardRejectKind::CannotPayFee);
            return status;
        }
    }
    return KalStatus();
}

KalStatus kal_fees::process_interface_fees(const kal_txn::BaseTXN &base, kal_txn::TXNStatusFees &status_fees)
{
    if (base.interface_fee().empty())
    {
        return KalStatus();
    }

    uint256_t interface_fee;
    if (!parse_uint256(base.interface_fee(), interface_fee))
    {
        return KalStatus(KalStatus::Code::TXN_FAILED, "process_utils.cpp: process_interface_fees: Invalid interface fee", kal_txn::TXN_STATUS::INVALID_UINT256);
    }

    if (interface_fee <= 0)
    {
        return KalStatus();
    }

    if (base.interface_fee_id().empty())
    {
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "process_interface_fees: Positive interface fee requires an instrument",
                         kal_txn::TXN_STATUS::INVALID_CONTRACT_FEE_ID);
    }

    if (!kal_wallet_address::valid_raw(base.interface_address()) &&
        base.interface_address() != BURN_WALLET)
    {
        return KalStatus(KalStatus::Code::TXN_FAILED,
                         "process_interface_fees: Invalid interface fee recipient address",
                         kal_txn::TXN_STATUS::INVALID_WALLET_ADDRESS);
    }

    std::string contract_id = base.interface_fee_id();
    std::string interface_wallet = base.interface_address();
    std::string interface_amount = base.interface_fee();
    const uint256_t fee_amount = interface_fee;
    std::string txn_hash = base.hash();

    // When a third-party fee payer is present, the sponsor covers the interface fee too.
    auto sender_wallet = fee_payer::source_wallet(base);

    KalStatus status = check_fee_payer(sender_wallet);
    if (!status.ok())
        return status;
    status = check_interface_fee_compliance(contract_id, {sender_wallet}, interface_wallet);
    if (!status.ok())
    {
        return status;
    }

    status = balance_tracker::subtract_txn_balance(sender_wallet, contract_id, fee_amount, txn_hash);

    if (!status.ok())
    {
        logging::print("process_interface_fees.cpp: ", status.read_status());
        if (status.code() == KalStatus::Code::DATABASE_ERROR)
            return status;

        return KalStatus(KalStatus::Code::TXN_FAILED, "process_utils.cpp: process_fess: " + status.read_status(), kal_txn::TXN_STATUS::INSUFFICIENT_AMOUNT);
    }

    balance_tracker::add_txn_balance(interface_wallet, contract_id, fee_amount, txn_hash);
    proposing::set_txn_token_fees(txn_hash, contract_id, interface_wallet, fee_amount);

    status_fees.set_interface_fee(interface_amount);
    status_fees.set_interface_fee_id(contract_id);

    return KalStatus();
}
