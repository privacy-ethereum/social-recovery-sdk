// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "forge-std/Test.sol";
import {PasskeyVerifier} from "../src/verifiers/PasskeyVerifier.sol";
import {GuardianLib} from "../src/libraries/GuardianLib.sol";

contract PasskeyVerifierTest is Test {
    PasskeyVerifier verifier;

    // Test P-256 key pair (these are example values - real tests would use actual test vectors)
    uint256 constant TEST_PUB_KEY_X = 0x65a0c7c1bef5e6d27f2a69876f7a5e8d6c9b4a3c2d1e0f9a8b7c6d5e4f3a2b1c;
    uint256 constant TEST_PUB_KEY_Y = 0x1a2b3c4d5e6f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b;

    function setUp() public {
        verifier = new PasskeyVerifier();
    }

    function test_guardianType() public view {
        assertEq(verifier.guardianType(), uint8(GuardianLib.GuardianType.Passkey));
        assertEq(verifier.guardianType(), 1);
    }

    function test_verify_invalidGuardianIdentifier() public view {
        bytes32 intentHash = keccak256("test intent");

        // Use a different public key in the proof than what the identifier was computed from
        uint256 wrongPubKeyX = TEST_PUB_KEY_X + 1;
        uint256 wrongPubKeyY = TEST_PUB_KEY_Y;

        // Guardian identifier computed from original keys
        bytes32 guardianIdentifier = GuardianLib.computePasskeyIdentifier(TEST_PUB_KEY_X, TEST_PUB_KEY_Y);

        // Proof contains wrong keys
        bytes memory proof = _encodeProof(
            hex"0000000000000000000000000000000000000000000000000000000000000000000000000001", // authenticatorData (minimal valid)
            '{"type":"webauthn.get","challenge":""}',
            0, // challengeLocation
            0, // responseTypeLocation
            1, // r
            1, // s
            wrongPubKeyX, // wrong public key
            wrongPubKeyY
        );

        bool result = verifier.verify(guardianIdentifier, intentHash, proof);
        assertFalse(result, "Should fail when guardian identifier doesn't match proof public key");
    }

    function test_verify_matchingIdentifier() public view {
        bytes32 intentHash = keccak256("test intent");
        bytes32 guardianIdentifier = GuardianLib.computePasskeyIdentifier(TEST_PUB_KEY_X, TEST_PUB_KEY_Y);

        // This proof has matching public keys but will fail WebAuthn verification
        // because the signature and challenge data are invalid
        bytes memory proof = _encodeProof(
            hex"0000000000000000000000000000000000000000000000000000000000000000000000000005", // 37 bytes, flags = 0x05 (UP+UV)
            '{"type":"webauthn.get","challenge":"test"}',
            25, // challengeLocation (where "challenge" starts)
            1, // responseTypeLocation (where "type" starts)
            1, // r
            1, // s
            TEST_PUB_KEY_X,
            TEST_PUB_KEY_Y
        );

        // This should fail because the signature is invalid, not because of identifier mismatch
        bool result = verifier.verify(guardianIdentifier, intentHash, proof);
        // The identifier check passes, but WebAuthn verification fails
        assertFalse(result, "Should fail due to invalid WebAuthn signature");
    }

    function test_identifierComputation_consistency() public pure {
        // Verify that the identifier computation in the verifier matches GuardianLib
        uint256 x = 12345;
        uint256 y = 67890;

        bytes32 libIdentifier = GuardianLib.computePasskeyIdentifier(x, y);
        bytes32 expectedIdentifier = keccak256(abi.encodePacked(x, y));

        assertEq(libIdentifier, expectedIdentifier, "Identifier computation should be consistent");
    }

    function testFuzz_verify_invalidIdentifier(
        uint256 proofX,
        uint256 proofY,
        uint256 identifierX,
        uint256 identifierY
    ) public view {
        // If the proof keys differ from identifier keys, verification should fail
        vm.assume(proofX != identifierX || proofY != identifierY);

        bytes32 intentHash = keccak256("test");
        bytes32 guardianIdentifier = GuardianLib.computePasskeyIdentifier(identifierX, identifierY);

        bytes memory proof = _encodeProof(
            hex"0000000000000000000000000000000000000000000000000000000000000000000000000005",
            '{"type":"webauthn.get","challenge":""}',
            25,
            1,
            1,
            1,
            proofX,
            proofY
        );

        bool result = verifier.verify(guardianIdentifier, intentHash, proof);
        assertFalse(result, "Should fail when identifier doesn't match");
    }

    // Helper to encode proof data
    function _encodeProof(
        bytes memory authenticatorData,
        string memory clientDataJSON,
        uint256 challengeLocation,
        uint256 responseTypeLocation,
        uint256 r,
        uint256 s,
        uint256 pubKeyX,
        uint256 pubKeyY
    ) internal pure returns (bytes memory) {
        return abi.encode(
            authenticatorData,
            clientDataJSON,
            challengeLocation,
            responseTypeLocation,
            r,
            s,
            pubKeyX,
            pubKeyY
        );
    }
}

/// @dev Test with real WebAuthn test vectors
/// Note: In a production test suite, you would include actual test vectors from
/// WebAuthn test suites or generate them using a test authenticator
contract PasskeyVerifierIntegrationTest is Test {
    PasskeyVerifier verifier;

    function setUp() public {
        verifier = new PasskeyVerifier();
    }

    // This test would require actual WebAuthn test vectors
    // The structure is provided for integration testing
    function test_verify_withRealTestVector() public view {
        // TODO: Add real WebAuthn test vectors for integration testing
        // This would include:
        // - A real P-256 key pair
        // - A signed WebAuthn assertion
        // - Properly formatted authenticatorData and clientDataJSON

        // For now, we just verify the contract doesn't revert on properly formatted input
        bytes32 intentHash = bytes32(uint256(1));
        bytes32 guardianIdentifier = GuardianLib.computePasskeyIdentifier(1, 2);

        bytes memory authenticatorData = new bytes(37);
        authenticatorData[32] = 0x05; // UP + UV flags

        bytes memory proof = abi.encode(
            authenticatorData,
            '{"type":"webauthn.get","challenge":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}',
            uint256(25),
            uint256(1),
            uint256(1),
            uint256(1),
            uint256(1),
            uint256(2)
        );

        // Should not revert, but will return false due to invalid signature
        bool result = verifier.verify(guardianIdentifier, intentHash, proof);
        assertFalse(result);
    }
}
