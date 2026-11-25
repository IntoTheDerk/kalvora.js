#pragma once

#include "txn.pb.h"
#include <cstddef>
#include <string_view>

// Protocol-12 resource checks only: passing these checks grants no authority.
// Signature presence, thresholds, internal provenance and nonces stay with
// their existing verifiers. No database access, wallet hashing or crypto here.
namespace auth_resources
{
inline constexpr std::size_t max_coin_slots = 64;
inline constexpr std::size_t max_single_bytes = 256;
inline constexpr std::size_t max_single_hash_tokens = 16;
inline constexpr std::size_t max_auth_bytes = 256 * 1024;
inline constexpr std::size_t max_verifications = 64;
inline constexpr std::size_t max_verification_bytes = 8 * 1024 * 1024;

bool public_key(const kal_txn::PublicKey &key);

// Blocks/wrappers are traversed per root transaction. A proposal and all its
// serialized children share one budget, including mutually exclusive options.
bool check(const google::protobuf::Message &message);
}
