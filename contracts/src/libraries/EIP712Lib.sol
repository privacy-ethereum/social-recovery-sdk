// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title EIP712Lib
/// @notice Library for EIP-712 typed data hashing of RecoveryIntent
/// @dev Used to create replay-protected hashes that guardians sign/prove over
library EIP712Lib {
    /// @notice EIP-712 domain name
    string internal constant NAME = "SocialRecovery";

    /// @notice EIP-712 domain version
    string internal constant VERSION = "1";

    /// @notice EIP-712 domain type hash
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @notice RecoveryIntent type hash
    bytes32 internal constant RECOVERY_INTENT_TYPEHASH = keccak256(
        "RecoveryIntent(address wallet,address newOwner,uint256 nonce,uint256 deadline,uint256 chainId,address recoveryManager)"
    );

    /// @notice Recovery intent data structure
    /// @dev All guardian proofs are bound to this structure for replay protection
    /// @param wallet The wallet being recovered
    /// @param newOwner The proposed new owner address
    /// @param nonce The current nonce of the RecoveryManager (prevents replay)
    /// @param deadline Unix timestamp after which the intent expires
    /// @param chainId The chain ID (prevents cross-chain replay)
    /// @param recoveryManager The RecoveryManager contract address (prevents cross-contract replay)
    struct RecoveryIntent {
        address wallet;
        address newOwner;
        uint256 nonce;
        uint256 deadline;
        uint256 chainId;
        address recoveryManager;
    }

    /// @notice Computes the EIP-712 domain separator
    /// @param verifyingContract The contract address to include in the domain
    /// @return The domain separator hash
    function domainSeparator(address verifyingContract) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                verifyingContract
            )
        );
    }

    /// @notice Computes the struct hash for a RecoveryIntent
    /// @param intent The recovery intent to hash
    /// @return The struct hash
    function hashStruct(RecoveryIntent memory intent) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RECOVERY_INTENT_TYPEHASH,
                intent.wallet,
                intent.newOwner,
                intent.nonce,
                intent.deadline,
                intent.chainId,
                intent.recoveryManager
            )
        );
    }

    /// @notice Computes the full EIP-712 typed data hash
    /// @dev This is the hash that guardians sign/prove over
    /// @param intent The recovery intent
    /// @param verifyingContract The contract address for domain separator
    /// @return The EIP-712 typed data hash (prefixed with \x19\x01)
    function hashTypedData(
        RecoveryIntent memory intent,
        address verifyingContract
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(verifyingContract),
                hashStruct(intent)
            )
        );
    }

    /// @notice Computes the full EIP-712 typed data hash using msg.sender as verifying contract
    /// @param intent The recovery intent
    /// @return The EIP-712 typed data hash
    function hashTypedData(RecoveryIntent memory intent) internal view returns (bytes32) {
        return hashTypedData(intent, address(this));
    }
}
