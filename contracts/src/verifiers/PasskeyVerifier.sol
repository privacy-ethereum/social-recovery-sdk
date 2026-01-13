// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IVerifier} from "../interfaces/IVerifier.sol";
import {GuardianLib} from "../libraries/GuardianLib.sol";
import {WebAuthn} from "p256-verifier/WebAuthn.sol";

/// @title PasskeyVerifier
/// @notice Verifies WebAuthn/P-256 signatures for passkey-based guardians
/// @dev Uses daimo-eth/p256-verifier which supports RIP-7212 precompile with fallback
contract PasskeyVerifier is IVerifier {
    /// @notice Verifies a passkey proof against a guardian identifier and intent hash
    /// @param guardianIdentifier The guardian's identifier: keccak256(pubKeyX || pubKeyY)
    /// @param intentHash The EIP-712 typed data hash of the RecoveryIntent
    /// @param proof ABI-encoded PasskeyProof struct
    /// @return True if the proof is valid
    function verify(
        bytes32 guardianIdentifier,
        bytes32 intentHash,
        bytes calldata proof
    ) external view override returns (bool) {
        // Decode the proof
        (
            bytes memory authenticatorData,
            string memory clientDataJSON,
            uint256 challengeLocation,
            uint256 responseTypeLocation,
            uint256 r,
            uint256 s,
            uint256 pubKeyX,
            uint256 pubKeyY
        ) = abi.decode(
            proof,
            (bytes, string, uint256, uint256, uint256, uint256, uint256, uint256)
        );

        // Verify the guardian identifier matches the public key
        bytes32 computedIdentifier = GuardianLib.computePasskeyIdentifier(pubKeyX, pubKeyY);
        if (computedIdentifier != guardianIdentifier) {
            return false;
        }

        // The challenge for WebAuthn is the intentHash as bytes
        bytes memory challenge = abi.encodePacked(intentHash);

        // Verify the WebAuthn signature
        // requireUserVerification = true for security
        return WebAuthn.verifySignature(
            challenge,
            authenticatorData,
            true, // requireUserVerification
            clientDataJSON,
            challengeLocation,
            responseTypeLocation,
            r,
            s,
            pubKeyX,
            pubKeyY
        );
    }

    /// @notice Returns the guardian type this verifier handles
    /// @return 1 (Passkey)
    function guardianType() external pure override returns (uint8) {
        return uint8(GuardianLib.GuardianType.Passkey);
    }
}
