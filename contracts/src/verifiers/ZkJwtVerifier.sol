// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IVerifier} from "../interfaces/IVerifier.sol";
import {GuardianLib} from "../libraries/GuardianLib.sol";

/// @notice Minimal interface for the generated Honk verifier
interface IHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @title ZkJwtVerifier
/// @notice Wraps the generated HonkVerifier to implement the IVerifier interface for zkJWT proofs
/// @dev Public inputs layout (20 elements):
///      [0..17]  RSA pubkey modulus limbs (18 limbs, identifies the signing key)
///      [18]     intentHash (binds proof to specific recovery session)
///      [19]     commitment (guardian identifier = Poseidon2(email_hash, salt))
contract ZkJwtVerifier is IVerifier {
    uint256 public constant NUM_PUBLIC_INPUTS = 20;
    uint256 public constant NUM_MODULUS_LIMBS = 18;

    IHonkVerifier public immutable honkVerifier;

    constructor(address _honkVerifier) {
        honkVerifier = IHonkVerifier(_honkVerifier);
    }

    /// @inheritdoc IVerifier
    function verify(
        bytes32 guardianIdentifier,
        bytes32 intentHash,
        bytes calldata proof
    ) external view override returns (bool) {
        // Decode the proof: raw Honk proof bytes + RSA pubkey modulus limbs
        (bytes memory rawProof, bytes32[18] memory pubkeyModulusLimbs) =
            abi.decode(proof, (bytes, bytes32[18]));

        // Build the public inputs array in circuit order
        bytes32[] memory publicInputs = new bytes32[](NUM_PUBLIC_INPUTS);

        // [0..17] modulus limbs
        for (uint256 i = 0; i < NUM_MODULUS_LIMBS; i++) {
            publicInputs[i] = pubkeyModulusLimbs[i];
        }

        // [18] intentHash
        publicInputs[18] = intentHash;

        // [19] commitment (= guardianIdentifier for zkJWT)
        publicInputs[19] = guardianIdentifier;

        // Delegate to the generated Honk verifier
        return honkVerifier.verify(rawProof, publicInputs);
    }

    /// @inheritdoc IVerifier
    function guardianType() external pure override returns (uint8) {
        return uint8(GuardianLib.GuardianType.ZkJWT);
    }
}
