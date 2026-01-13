// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title GuardianLib
/// @notice Library for guardian types and identifier computation
/// @dev Guardian identifiers are computed differently based on authentication method
library GuardianLib {
    /// @notice Guardian authentication types
    /// @dev EOA = 0, Passkey = 1, ZkJWT = 2
    enum GuardianType {
        EOA,     // Standard Ethereum address, identifier = address as bytes32
        Passkey, // WebAuthn/P-256, identifier = keccak256(pubKeyX || pubKeyY)
        ZkJWT    // Zero-knowledge JWT, identifier = Poseidon(email, salt)
    }

    /// @notice Guardian configuration stored on-chain
    /// @param guardianType The authentication method for this guardian
    /// @param identifier The unique identifier (encoding depends on type)
    struct Guardian {
        GuardianType guardianType;
        bytes32 identifier;
    }

    /// @notice Computes the guardian identifier for a passkey from P-256 public key coordinates
    /// @param pubKeyX The X coordinate of the P-256 public key
    /// @param pubKeyY The Y coordinate of the P-256 public key
    /// @return The guardian identifier: keccak256(pubKeyX || pubKeyY)
    function computePasskeyIdentifier(
        uint256 pubKeyX,
        uint256 pubKeyY
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(pubKeyX, pubKeyY));
    }

    /// @notice Computes the guardian identifier for an EOA address
    /// @param addr The EOA address
    /// @return The guardian identifier: address left-padded to bytes32
    function computeEoaIdentifier(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    /// @notice Extracts the EOA address from a guardian identifier
    /// @param identifier The guardian identifier
    /// @return The EOA address
    function identifierToAddress(bytes32 identifier) internal pure returns (address) {
        return address(uint160(uint256(identifier)));
    }

    /// @notice Validates that a guardian configuration is valid
    /// @param guardian The guardian to validate
    /// @return True if the guardian is valid
    function isValidGuardian(Guardian memory guardian) internal pure returns (bool) {
        // Identifier must not be zero
        if (guardian.identifier == bytes32(0)) {
            return false;
        }

        // Guardian type must be valid (implicit in enum, but check for safety)
        if (uint8(guardian.guardianType) > uint8(GuardianType.ZkJWT)) {
            return false;
        }

        return true;
    }
}
