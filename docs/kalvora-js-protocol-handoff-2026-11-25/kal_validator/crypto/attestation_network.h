#pragma once
#include "const.h"
#include <sodium.h>
#include <array>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

// Startup must initialize before any BLS key or consensus journal opens.
// This helper does not move, clear, or mutate the blockchain databases.
namespace attestation_network {
namespace detail {
inline bool initialized = false, proto = false, bootstrap_required = false;
inline std::filesystem::path data_directory;
inline std::string seed, anchor, identity, record_path, signature_chain_id,
                   bound_genesis_hash;
inline int network_lock_fd = -1;
inline std::filesystem::path default_data_directory() {
    const char* configured = std::getenv("DATA_DIR");
    return configured && *configured ? configured : "/data";
}
inline void sync_directory(const std::filesystem::path& path) {
    const int fd = ::open(path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) throw std::runtime_error("Cannot open attestation network directory");
    const int result = ::fsync(fd); ::close(fd);
    if (result != 0) throw std::runtime_error("Cannot sync attestation network directory");
}
inline void private_directory(const std::filesystem::path& path, bool create_missing = true) {
    if (!path.is_absolute()) throw std::runtime_error("DATA_DIR must be absolute");
    std::filesystem::path current = path.root_path();
    for (const auto& part : path.relative_path()) {
        current /= part;
        struct stat status{};
        if (::lstat(current.c_str(), &status) != 0) {
            if (!create_missing) throw std::runtime_error("Missing attestation network directory");
            if (errno != ENOENT || ::mkdir(current.c_str(), 0700) != 0)
                throw std::runtime_error("Cannot create attestation network directory");
            sync_directory(current.parent_path());
        } else if (!S_ISDIR(status.st_mode)) throw std::runtime_error("Attestation network path is not a directory");
    }
    struct stat status{};
    if (::lstat(path.c_str(), &status) != 0 || status.st_uid != ::geteuid() || (status.st_mode & 077))
        throw std::runtime_error("Attestation network directory must be privately owned (0700)");
}
inline bool private_file(int fd) {
    struct stat status{};
    return ::fstat(fd, &status) == 0 && S_ISREG(status.st_mode) && status.st_uid == ::geteuid() &&
        !(status.st_mode & 077) && status.st_nlink == 1;
}
inline std::string read_record(const std::string& path) {
    const int fd = ::open(path.c_str(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
    if (fd < 0) {
        if (errno == ENOENT) return {};
        throw std::runtime_error("Cannot open attestation network record");
    }
    if (!private_file(fd)) { ::close(fd); throw std::runtime_error("Unsafe attestation network record permissions"); }
    std::array<unsigned char, 106> record{};
    size_t total = 0;
    while (total < record.size()) {
        const ssize_t n = ::read(fd, record.data() + total, record.size() - total);
        if (n < 0 && errno == EINTR) continue;
        if (n < 0) { ::close(fd); throw std::runtime_error("Cannot read attestation network record"); }
        if (!n) break;
        total += static_cast<size_t>(n);
    }
    ::close(fd);
    std::array<unsigned char, 32> hash{};
    crypto_hash_sha256(hash.data(), record.data(), 73);
    if (total != 105 || std::memcmp(record.data(), "ZATNET01", 8) || record[72] > 1 ||
        sodium_memcmp(hash.data(), record.data() + 73, hash.size()))
        throw std::runtime_error("Invalid attestation network record");
    return std::string(reinterpret_cast<const char*>(record.data()), total);
}
inline void persist(bool completed) {
    std::string record = std::string("ZATNET01", 8) + seed + anchor + char(completed ? 1 : 0);
    record.resize(105);
    crypto_hash_sha256(reinterpret_cast<unsigned char*>(&record[73]),
        reinterpret_cast<const unsigned char*>(record.data()), 73);
    std::array<unsigned char, 16> random{};
    std::array<char, 33> suffix{};
    randombytes_buf(random.data(), random.size());
    sodium_bin2hex(suffix.data(), suffix.size(), random.data(), random.size());
    const std::string temporary = record_path + ".tmp." + suffix.data();
    const int fd = ::open(temporary.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) throw std::runtime_error("Cannot create attestation network record");
    size_t written = 0;
    bool okay = true;
    while (written < record.size()) {
        const ssize_t n = ::write(fd, record.data() + written, record.size() - written);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) { okay = false; break; }
        written += static_cast<size_t>(n);
    }
    if (okay) okay = ::fsync(fd) == 0;
    if (::close(fd) != 0) okay = false;
    if (okay) okay = ::rename(temporary.c_str(), record_path.c_str()) == 0;
    if (!okay) { ::unlink(temporary.c_str()); throw std::runtime_error("Cannot persist attestation network record"); }
    sync_directory(std::filesystem::path(record_path).parent_path());
}
}
inline bool initialize(bool protonet, const std::string& data_dir, const std::string& fork_anchor,
                       bool populated_chain, std::string& error, bool read_existing_only = false) {
    error.clear();
    if (detail::initialized) { error = "Attestation network already initialized"; return false; }
    // This process may retry after a failed initialization, but a running
    // validator cannot switch chain identities without restarting.
    detail::signature_chain_id.clear();
    detail::bound_genesis_hash.clear();
    try {
        if (sodium_init() < 0) throw std::runtime_error("Cannot initialize secure random generator");
        detail::data_directory = data_dir;
        if (!detail::data_directory.is_absolute()) throw std::runtime_error("DATA_DIR must be absolute");
        detail::record_path = (detail::data_directory / "config/attestation/protonet-network.state").string();
        if (!protonet) {
            if (std::filesystem::exists(detail::record_path))
                throw std::runtime_error("This DATA_DIR belongs to a prototype fork; keep protonet enabled");
            detail::initialized = true;
            return true;
        }
        detail::private_directory(std::filesystem::path(detail::record_path).parent_path(), !read_existing_only);
        if (!read_existing_only) {
            const int fd = ::open((detail::record_path + ".lock").c_str(), O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
            if (fd < 0) throw std::runtime_error("Cannot open prototype network lock");
            if (!detail::private_file(fd) || ::flock(fd, LOCK_EX | LOCK_NB) != 0) {
                ::close(fd); throw std::runtime_error("Prototype namespace is already in use or has unsafe permissions");
            }
            detail::network_lock_fd = fd;
        }
        const auto record = detail::read_record(detail::record_path);
        if (read_existing_only && (record.empty() || record[72] == 0))
            throw std::runtime_error("Worker requires an established prototype network");
        std::string configured_seed;
        const char* configured = std::getenv("PROTONET_NETWORK_ID");
        if (configured && *configured) {
            configured_seed.resize(32);
            size_t written = 0;
            if (std::strlen(configured) != 64 || sodium_hex2bin(reinterpret_cast<unsigned char*>(&configured_seed[0]),
                32, configured, 64, nullptr, &written, nullptr) != 0 || written != 32)
                throw std::runtime_error("PROTONET_NETWORK_ID must be exactly 64 hexadecimal characters");
        }
        if (record.empty()) {
            const char* explicit_data = std::getenv("DATA_DIR");
            if (populated_chain && (configured_seed.empty() || !explicit_data || !*explicit_data))
                throw std::runtime_error("Importing a populated chain as protonet requires explicit DATA_DIR and PROTONET_NETWORK_ID; use a separate prototype data directory");
            if (!fork_anchor.empty() && fork_anchor.size() != 32) throw std::runtime_error("Invalid prototype fork anchor");
            detail::seed = configured_seed;
            if (detail::seed.empty()) {
                detail::seed.resize(32);
                randombytes_buf(&detail::seed[0], detail::seed.size());
            }
            detail::anchor = fork_anchor.empty() ? std::string(32, '\0') : fork_anchor;
            // Fresh proto starts from the committee committed by the signed
            // genesis. Only an imported chain needs a local validator transition.
            detail::bootstrap_required = populated_chain;
            detail::persist(!populated_chain);
        } else {
            detail::seed = record.substr(8, 32);
            detail::anchor = record.substr(40, 32);
            detail::bootstrap_required = record[72] == 0;
            if (!configured_seed.empty() && configured_seed != detail::seed)
                throw std::runtime_error("PROTONET_NETWORK_ID does not match this DATA_DIR's persisted prototype network");
        }
        const std::string preimage = std::string("KAL_PROTONET_ATTESTATION_V2") + detail::seed + detail::anchor;
        detail::identity.resize(32);
        crypto_hash_sha256(reinterpret_cast<unsigned char*>(&detail::identity[0]),
            reinterpret_cast<const unsigned char*>(preimage.data()), preimage.size());
        detail::proto = true;
        detail::initialized = true;
        return true;
    } catch (const std::exception& exception) {
        if (detail::network_lock_fd >= 0) { ::close(detail::network_lock_fd); detail::network_lock_fd = -1; }
        error = exception.what(); return false;
    }
}
inline std::string chain_id(const std::string& genesis_hash) {
    if (genesis_hash.size() != 32)
        throw std::runtime_error("Invalid committed genesis for chain identity");
    const std::string preimage = std::string("KAL_CHAIN_ID_V2|") +
        (detail::proto ? KAL_PROTO_NETWORK_ID : KAL_MAIN_NETWORK_ID) + "|" + genesis_hash;
    std::string result(32, '\0');
    crypto_hash_sha256(reinterpret_cast<unsigned char*>(&result[0]),
                       reinterpret_cast<const unsigned char*>(preimage.data()),
                       preimage.size());
    return result;
}
inline bool bind_signature_chain_id(const std::string& committed_genesis_hash) {
    if (!detail::initialized || committed_genesis_hash.size() != 32) return false;
    const std::string expected = chain_id(committed_genesis_hash);
    if (expected.size() != 32 ||
        (!detail::bound_genesis_hash.empty() &&
         detail::bound_genesis_hash != committed_genesis_hash) ||
        (!detail::signature_chain_id.empty() &&
         detail::signature_chain_id != expected))
        return false;
    detail::bound_genesis_hash = committed_genesis_hash;
    detail::signature_chain_id = expected;
    return true;
}
inline std::string signed_transaction_chain_id() {
    return detail::signature_chain_id;
}
inline std::string namespace_hex() {
    if (!detail::proto) return {};
    std::array<char, 65> encoded{};
    sodium_bin2hex(encoded.data(), encoded.size(), reinterpret_cast<const unsigned char*>(detail::identity.data()), 32);
    return encoded.data();
}
inline std::filesystem::path storage_directory() {
    auto base = (detail::initialized ? detail::data_directory : detail::default_data_directory()) / "consensus";
    return detail::proto ? base / namespace_hex() : base;
}
inline std::filesystem::path key_path() {
    auto base = (detail::initialized ? detail::data_directory : detail::default_data_directory()) / "config/attestation";
    return detail::proto ? base / namespace_hex() / "secret.key" : base / "secret.key";
}
// Selected before the genesis hash (and thus the proto namespace) is known.
inline std::filesystem::path founder_key_path() {
    return (detail::initialized ? detail::data_directory : detail::default_data_directory()) /
        "config/attestation/founder.key";
}
inline bool fork_bootstrap_required() { return detail::proto && detail::bootstrap_required; }
inline std::string fork_anchor() { return detail::anchor; }
inline bool mark_fork_bootstrapped(std::string& error) {
    error.clear();
    if (!detail::proto || !detail::bootstrap_required) return true;
    try { detail::persist(true); detail::bootstrap_required = false; return true; }
    catch (const std::exception& exception) { error = exception.what(); return false; }
}
}
