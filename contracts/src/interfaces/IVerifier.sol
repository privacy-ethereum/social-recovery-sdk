// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title IVerifier
/// @notice Common interface for guardian proof verification
/// @dev Implemented by PasskeyVerifier, ZkJwtVerifier. EOA uses ecrecover directly.
interface IVerifier {
    /// @notice Verifies a guardian proof against an intent hash
    /// @param guardianIdentifier The unique identifier for the guardian
    ///        - Passkey: keccak256(pubKeyX || pubKeyY)
    ///        - ZkJWT: Poseidon(email, salt)
    /// @param intentHash The EIP-712 typed data hash of the RecoveryIntent
    /// @param proof The encoded proof data (format depends on verifier type)
    /// @return True if the proof is valid, false otherwise
    function verify(
        bytes32 guardianIdentifier,
        bytes32 intentHash,
        bytes calldata proof
    ) external view returns (bool);

    /// @notice Returns the guardian type this verifier handles
    /// @return The guardian type (1 = Passkey, 2 = ZkJWT)
    function guardianType() external pure returns (uint8);
}
