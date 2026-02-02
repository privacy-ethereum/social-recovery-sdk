// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Test} from "forge-std/Test.sol";
import {ZkJwtVerifier, IHonkVerifier} from "../src/verifiers/ZkJwtVerifier.sol";
import {GuardianLib} from "../src/libraries/GuardianLib.sol";

/// @dev Mock HonkVerifier that returns a configurable boolean
contract MockHonkVerifier {
    bool public returnValue = true;

    function setReturnValue(bool _value) external {
        returnValue = _value;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return returnValue;
    }
}

/// @dev Mock HonkVerifier that validates expected public inputs (view-compatible)
contract ValidatingHonkVerifier {
    /// @dev Validates that public inputs match the expected layout:
    ///      [0..17] modulus limbs = i+1 for each i
    ///      [18] = intentHash
    ///      [19] = guardianIdentifier (commitment)
    function verify(bytes calldata, bytes32[] calldata publicInputs) external pure returns (bool) {
        require(publicInputs.length == 20, "wrong public inputs length");

        // Validate modulus limbs
        for (uint256 i = 0; i < 18; i++) {
            require(publicInputs[i] == bytes32(uint256(i + 1)), "wrong modulus limb");
        }

        // Validate intentHash at [18]
        require(publicInputs[18] == bytes32(uint256(0xcafebabe)), "wrong intent hash");

        // Validate commitment at [19]
        require(publicInputs[19] == bytes32(uint256(0xdeadbeef)), "wrong commitment");

        return true;
    }
}

/// @dev Mock HonkVerifier that validates raw proof passthrough (view-compatible)
contract ProofValidatingHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata) external pure returns (bool) {
        // Validate the raw proof matches expected bytes
        bytes memory expected = hex"deadbeefcafebabe1234567890";
        require(keccak256(proof) == keccak256(expected), "wrong raw proof");
        return true;
    }
}

/// @dev Mock HonkVerifier that always reverts
contract RevertingHonkVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        revert("honk verification failed");
    }
}

contract ZkJwtVerifierTest is Test {
    ZkJwtVerifier verifier;
    MockHonkVerifier mockHonk;

    // Pre-deployed validating verifiers for view-compatible tests
    ZkJwtVerifier validatorVerifier;
    ZkJwtVerifier proofValidatorVerifier;

    bytes32 constant GUARDIAN_ID = bytes32(uint256(0xdeadbeef));
    bytes32 constant INTENT_HASH = bytes32(uint256(0xcafebabe));

    function setUp() public {
        mockHonk = new MockHonkVerifier();
        verifier = new ZkJwtVerifier(address(mockHonk));

        ValidatingHonkVerifier validator = new ValidatingHonkVerifier();
        validatorVerifier = new ZkJwtVerifier(address(validator));

        ProofValidatingHonkVerifier proofValidator = new ProofValidatingHonkVerifier();
        proofValidatorVerifier = new ZkJwtVerifier(address(proofValidator));
    }

    function test_constructor_setsHonkVerifier() public view {
        assertEq(address(verifier.honkVerifier()), address(mockHonk));
    }

    function test_guardianType_returns2() public view {
        assertEq(verifier.guardianType(), uint8(GuardianLib.GuardianType.ZkJWT));
        assertEq(verifier.guardianType(), 2);
    }

    function test_verify_returnsTrue_whenHonkReturnsTrue() public view {
        bytes memory proof = _buildProof();
        bool result = verifier.verify(GUARDIAN_ID, INTENT_HASH, proof);
        assertTrue(result);
    }

    function test_verify_returnsFalse_whenHonkReturnsFalse() public {
        mockHonk.setReturnValue(false);
        bytes memory proof = _buildProof();
        bool result = verifier.verify(GUARDIAN_ID, INTENT_HASH, proof);
        assertFalse(result);
    }

    function test_verify_publicInputsOrdering() public view {
        // Uses a validating mock that reverts if public inputs are wrong
        bytes32[18] memory modulusLimbs;
        for (uint256 i = 0; i < 18; i++) {
            modulusLimbs[i] = bytes32(uint256(i + 1));
        }
        bytes memory rawProof = hex"aabbccdd";
        bytes memory proof = abi.encode(rawProof, modulusLimbs);

        // If ordering is wrong, the validating mock will revert
        bool result = validatorVerifier.verify(GUARDIAN_ID, INTENT_HASH, proof);
        assertTrue(result);
    }

    function test_verify_rawProofPassthrough() public view {
        // Uses a validating mock that checks the raw proof bytes
        bytes memory rawProof = hex"deadbeefcafebabe1234567890";
        bytes32[18] memory modulusLimbs;
        bytes memory proof = abi.encode(rawProof, modulusLimbs);

        // If raw proof is wrong, the validating mock will revert
        bool result = proofValidatorVerifier.verify(GUARDIAN_ID, INTENT_HASH, proof);
        assertTrue(result);
    }

    function test_verify_reverts_whenHonkReverts() public {
        RevertingHonkVerifier reverter = new RevertingHonkVerifier();
        ZkJwtVerifier reverterVerifier = new ZkJwtVerifier(address(reverter));

        bytes memory proof = _buildProof();
        vm.expectRevert("honk verification failed");
        reverterVerifier.verify(GUARDIAN_ID, INTENT_HASH, proof);
    }

    function test_constants() public view {
        assertEq(verifier.NUM_PUBLIC_INPUTS(), 20);
        assertEq(verifier.NUM_MODULUS_LIMBS(), 18);
    }

    function _buildProof() internal pure returns (bytes memory) {
        bytes memory rawProof = hex"aabb";
        bytes32[18] memory modulusLimbs;
        return abi.encode(rawProof, modulusLimbs);
    }
}
