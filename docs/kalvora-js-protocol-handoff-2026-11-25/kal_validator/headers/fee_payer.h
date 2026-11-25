#ifndef FEE_PAYER_H
#define FEE_PAYER_H

// Helpers for the third-party fee payer ("sponsored txn") feature.
//
// A sponsor pays the fees for a txn the user already signed. The sponsor
// counter-signs the entire user-signed txn and supplies their own nonce.
//
// A fee_payer is accepted on every user-facing txn type that goes through the
// generic signatures::verify_txns path (see the allowlist below). Deliberately
// excluded:
//   - CoinTXN: fees are split across its inputs, so a sponsor is expressed as
//     an extra zero-output input rather than a fee_payer.
//   - ValidatorRegistration / ValidatorHeartbeat: validator-operational txns
//     with their own fee paths; the validator pays its own way.
//   - RequiredVersion: KIP governance-only and carries no fee.
// Every other txn type that carries a fee_payer is rejected at signature
// verification.
// This file is header-only on purpose so no new CMake source entry is required.

#include <string>

#include "txn.pb.h"
#include "wallets.h"

namespace fee_payer
{
    // True if this txn carries a third-party fee payer.
    inline bool has(const kal_txn::BaseTXN &base)
    {
        return base.has_fee_payer();
    }

    // Wallet address that funds the fees: the sponsor when present, otherwise the sender.
    inline std::string source_wallet(const kal_txn::BaseTXN &base)
    {
        if (base.has_fee_payer())
        {
            return wallets::generate_wallet(base.fee_payer().public_key());
        }
        return wallets::generate_wallet(base.public_key());
    }

    // Sponsor wallet address (assumes a fee payer is present).
    inline std::string payer_wallet(const kal_txn::BaseTXN &base)
    {
        return wallets::generate_wallet(base.fee_payer().public_key());
    }

    inline const kal_txn::PublicKey* signer(const kal_txn::BaseTXN& base)
    {
        return base.has_fee_payer() ? &base.fee_payer().public_key() : nullptr;
    }

    // Allowlist of txn types permitted to carry a fee_payer. Default deny.
    // Every allowed type must charge its fees through source_wallet() (and
    // refund any unspent gas budget to it), never directly to base.public_key.
    template <typename TXType>
    struct type_allowed_t
    {
        static constexpr bool value = false;
    };

#define FEE_PAYER_ALLOW(TXType)                    \
    template <>                                    \
    struct type_allowed_t<TXType>                  \
    {                                              \
        static constexpr bool value = true;        \
    };

    FEE_PAYER_ALLOW(kal_txn::GovernanceVote)
    FEE_PAYER_ALLOW(kal_txn::GovernanceProposal)
    FEE_PAYER_ALLOW(kal_txn::ProposalCancelTXN)
    FEE_PAYER_ALLOW(kal_txn::WalletRegistration)
    FEE_PAYER_ALLOW(kal_txn::DelegatedTXN)
    FEE_PAYER_ALLOW(kal_txn::NFTTXN)
    FEE_PAYER_ALLOW(kal_txn::MintTXN)
    FEE_PAYER_ALLOW(kal_txn::ItemizedMintTXN)
    FEE_PAYER_ALLOW(kal_txn::BurnSBTTXN)
    FEE_PAYER_ALLOW(kal_txn::InstrumentContract)
    FEE_PAYER_ALLOW(kal_txn::ContractUpdateTXN)
    FEE_PAYER_ALLOW(kal_txn::ExpenseRatioTXN)
    FEE_PAYER_ALLOW(kal_txn::RevokeTXN)
    FEE_PAYER_ALLOW(kal_txn::ComplianceTXN)
    FEE_PAYER_ALLOW(kal_txn::AllowanceTXN)
    FEE_PAYER_ALLOW(kal_txn::SmartContractTXN)
    FEE_PAYER_ALLOW(kal_txn::SmartContractInstantiateTXN)
    FEE_PAYER_ALLOW(kal_txn::SmartContractExecuteTXN)

#undef FEE_PAYER_ALLOW

    template <typename TXType>
    constexpr bool type_allowed()
    {
        return type_allowed_t<TXType>::value;
    }
}

#endif
