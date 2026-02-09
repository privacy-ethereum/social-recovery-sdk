// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "forge-std/Test.sol";
import {PasskeyVerifier} from "../src/verifiers/PasskeyVerifier.sol";
import {GuardianLib} from "../src/libraries/GuardianLib.sol";
import {P256} from "p256-verifier/P256.sol";
import {P256VerifierStub} from "../src/mocks/P256VerifierStub.sol";

contract PasskeyVerifierTest is Test {
    PasskeyVerifier verifier;

    // Test P-256 key pair (these are example values - real tests would use actual test vectors)
    uint256 constant TEST_PUB_KEY_X = 0x65a0c7c1bef5e6d27f2a69876f7a5e8d6c9b4a3c2d1e0f9a8b7c6d5e4f3a2b1c;
    uint256 constant TEST_PUB_KEY_Y = 0x1a2b3c4d5e6f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b;

    function setUp() public {
        vm.etch(P256.VERIFIER, type(P256VerifierStub).runtimeCode);
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
contract PasskeyVerifierIntegrationTest is Test {
    PasskeyVerifier verifier;

    bytes32 constant INTENT_HASH =
        0x11223344556677889900aabbccddeeff00112233445566778899aabbccddeeff;
    uint256 constant PUB_KEY_X =
        0xed80cb7f5bc2eb592bd5cd4f91f179fb20cc79303998f4adf029198b1a7a77ed;
    uint256 constant PUB_KEY_Y =
        0xbbdf2b41926016b8a7e93a7ab44da08d4f4b5e3753687eac5b8dddcf5517e872;
    uint256 constant R =
        0xaa1ece6f14eb737890608332acf4a21b33cc70e1007d011512e5737b9e714c13;
    uint256 constant S =
        0x18733351c40e8ea9045915d0924f30524479f22676721a424bb103052a15aa93;

    bytes constant AUTHENTICATOR_DATA =
        hex"a379a6f6eeafb9a55e378c118034e2751e682fab9f2d30ab13d2125586ce19470500000000";
    string constant CLIENT_DATA_JSON =
        '{"type":"webauthn.get","challenge":"ESIzRFVmd4iZAKq7zN3u_wARIjNEVWZ3iJmqu8zd7v8","origin":"https://example.com"}';
    uint256 constant CHALLENGE_LOCATION = 23;
    uint256 constant RESPONSE_TYPE_LOCATION = 1;

    function setUp() public {
        vm.etch(P256.VERIFIER, type(P256VerifierStub).runtimeCode);
        verifier = new PasskeyVerifier();
    }

    function test_verify_withStaticValidVector() public view {
        bytes32 guardianIdentifier = GuardianLib.computePasskeyIdentifier(PUB_KEY_X, PUB_KEY_Y);
        bytes memory proof = abi.encode(
            AUTHENTICATOR_DATA,
            CLIENT_DATA_JSON,
            CHALLENGE_LOCATION,
            RESPONSE_TYPE_LOCATION,
            R,
            S,
            PUB_KEY_X,
            PUB_KEY_Y
        );

        bool result = verifier.verify(guardianIdentifier, INTENT_HASH, proof);
        assertTrue(result);
    }

    function test_verify_withStaticTamperedVector() public view {
        bytes32 guardianIdentifier = GuardianLib.computePasskeyIdentifier(PUB_KEY_X, PUB_KEY_Y);
        bytes memory proof = abi.encode(
            AUTHENTICATOR_DATA,
            CLIENT_DATA_JSON,
            CHALLENGE_LOCATION + 1, // tampered location; challenge string no longer matches
            RESPONSE_TYPE_LOCATION,
            R,
            S,
            PUB_KEY_X,
            PUB_KEY_Y
        );

        bool result = verifier.verify(guardianIdentifier, INTENT_HASH, proof);
        assertFalse(result);
    }
}
