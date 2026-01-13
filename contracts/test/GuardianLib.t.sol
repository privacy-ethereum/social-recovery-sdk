// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "forge-std/Test.sol";
import {GuardianLib} from "../src/libraries/GuardianLib.sol";

contract GuardianLibTest is Test {
    using GuardianLib for GuardianLib.Guardian;

    function test_computePasskeyIdentifier() public pure {
        uint256 pubKeyX = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
        uint256 pubKeyY = 0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321;

        bytes32 identifier = GuardianLib.computePasskeyIdentifier(pubKeyX, pubKeyY);

        // Verify it matches the expected keccak256
        bytes32 expected = keccak256(abi.encodePacked(pubKeyX, pubKeyY));
        assertEq(identifier, expected);
    }

    function test_computePasskeyIdentifier_differentInputs() public pure {
        uint256 pubKeyX1 = 1;
        uint256 pubKeyY1 = 2;
        uint256 pubKeyX2 = 2;
        uint256 pubKeyY2 = 1;

        bytes32 identifier1 = GuardianLib.computePasskeyIdentifier(pubKeyX1, pubKeyY1);
        bytes32 identifier2 = GuardianLib.computePasskeyIdentifier(pubKeyX2, pubKeyY2);

        // Different inputs should produce different identifiers
        assertTrue(identifier1 != identifier2);
    }

    function test_computePasskeyIdentifier_zeroValues() public pure {
        uint256 pubKeyX = 0;
        uint256 pubKeyY = 0;

        bytes32 identifier = GuardianLib.computePasskeyIdentifier(pubKeyX, pubKeyY);

        // Should still compute a valid hash
        bytes32 expected = keccak256(abi.encodePacked(uint256(0), uint256(0)));
        assertEq(identifier, expected);
    }

    function test_computePasskeyIdentifier_maxValues() public pure {
        uint256 pubKeyX = type(uint256).max;
        uint256 pubKeyY = type(uint256).max;

        bytes32 identifier = GuardianLib.computePasskeyIdentifier(pubKeyX, pubKeyY);

        bytes32 expected = keccak256(abi.encodePacked(type(uint256).max, type(uint256).max));
        assertEq(identifier, expected);
    }

    function testFuzz_computePasskeyIdentifier(uint256 x, uint256 y) public pure {
        bytes32 identifier = GuardianLib.computePasskeyIdentifier(x, y);
        bytes32 expected = keccak256(abi.encodePacked(x, y));
        assertEq(identifier, expected);
    }

    function test_computeEoaIdentifier() public pure {
        address addr = 0x1234567890123456789012345678901234567890;

        bytes32 identifier = GuardianLib.computeEoaIdentifier(addr);

        // Should be the address left-padded to bytes32
        bytes32 expected = bytes32(uint256(uint160(addr)));
        assertEq(identifier, expected);
    }

    function test_computeEoaIdentifier_zeroAddress() public pure {
        address addr = address(0);

        bytes32 identifier = GuardianLib.computeEoaIdentifier(addr);

        assertEq(identifier, bytes32(0));
    }

    function testFuzz_computeEoaIdentifier(address addr) public pure {
        bytes32 identifier = GuardianLib.computeEoaIdentifier(addr);
        bytes32 expected = bytes32(uint256(uint160(addr)));
        assertEq(identifier, expected);
    }

    function test_identifierToAddress() public pure {
        address original = 0x1234567890123456789012345678901234567890;
        bytes32 identifier = GuardianLib.computeEoaIdentifier(original);

        address recovered = GuardianLib.identifierToAddress(identifier);

        assertEq(recovered, original);
    }

    function testFuzz_identifierToAddress_roundTrip(address original) public pure {
        bytes32 identifier = GuardianLib.computeEoaIdentifier(original);
        address recovered = GuardianLib.identifierToAddress(identifier);
        assertEq(recovered, original);
    }

    function test_isValidGuardian_validEoa() public pure {
        GuardianLib.Guardian memory guardian = GuardianLib.Guardian({
            guardianType: GuardianLib.GuardianType.EOA,
            identifier: GuardianLib.computeEoaIdentifier(address(1))
        });

        assertTrue(GuardianLib.isValidGuardian(guardian));
    }

    function test_isValidGuardian_validPasskey() public pure {
        GuardianLib.Guardian memory guardian = GuardianLib.Guardian({
            guardianType: GuardianLib.GuardianType.Passkey,
            identifier: GuardianLib.computePasskeyIdentifier(1, 2)
        });

        assertTrue(GuardianLib.isValidGuardian(guardian));
    }

    function test_isValidGuardian_validZkJwt() public pure {
        GuardianLib.Guardian memory guardian = GuardianLib.Guardian({
            guardianType: GuardianLib.GuardianType.ZkJWT,
            identifier: bytes32(uint256(123456)) // Poseidon hash placeholder
        });

        assertTrue(GuardianLib.isValidGuardian(guardian));
    }

    function test_isValidGuardian_zeroIdentifier() public pure {
        GuardianLib.Guardian memory guardian = GuardianLib.Guardian({
            guardianType: GuardianLib.GuardianType.EOA,
            identifier: bytes32(0)
        });

        assertFalse(GuardianLib.isValidGuardian(guardian));
    }

    function test_guardianTypeValues() public pure {
        // Verify enum values match spec
        assertEq(uint8(GuardianLib.GuardianType.EOA), 0);
        assertEq(uint8(GuardianLib.GuardianType.Passkey), 1);
        assertEq(uint8(GuardianLib.GuardianType.ZkJWT), 2);
    }
}
