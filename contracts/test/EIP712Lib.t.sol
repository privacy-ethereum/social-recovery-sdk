// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "forge-std/Test.sol";
import {EIP712Lib} from "../src/libraries/EIP712Lib.sol";

contract EIP712LibTest is Test {
    // Test contract that uses EIP712Lib
    EIP712LibHarness harness;

    function setUp() public {
        harness = new EIP712LibHarness();
    }

    function test_domainConstants() public pure {
        // Verify domain constants match spec
        assertEq(EIP712Lib.NAME, "SocialRecovery");
        assertEq(EIP712Lib.VERSION, "1");
    }

    function test_domainTypehash() public pure {
        bytes32 expected = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        assertEq(EIP712Lib.DOMAIN_TYPEHASH, expected);
    }

    function test_recoveryIntentTypehash() public pure {
        bytes32 expected = keccak256(
            "RecoveryIntent(address wallet,address newOwner,uint256 nonce,uint256 deadline,uint256 chainId,address recoveryManager)"
        );
        assertEq(EIP712Lib.RECOVERY_INTENT_TYPEHASH, expected);
    }

    function test_domainSeparator() public view {
        bytes32 domainSep = harness.domainSeparator(address(harness));

        bytes32 expected = keccak256(
            abi.encode(
                EIP712Lib.DOMAIN_TYPEHASH,
                keccak256(bytes("SocialRecovery")),
                keccak256(bytes("1")),
                block.chainid,
                address(harness)
            )
        );

        assertEq(domainSep, expected);
    }

    function test_domainSeparator_differentContracts() public view {
        bytes32 domainSep1 = harness.domainSeparator(address(1));
        bytes32 domainSep2 = harness.domainSeparator(address(2));

        assertTrue(domainSep1 != domainSep2);
    }

    function test_hashStruct() public view {
        EIP712Lib.RecoveryIntent memory intent = _createTestIntent();

        bytes32 structHash = harness.hashStruct(intent);

        bytes32 expected = keccak256(
            abi.encode(
                EIP712Lib.RECOVERY_INTENT_TYPEHASH,
                intent.wallet,
                intent.newOwner,
                intent.nonce,
                intent.deadline,
                intent.chainId,
                intent.recoveryManager
            )
        );

        assertEq(structHash, expected);
    }

    function test_hashTypedData() public view {
        EIP712Lib.RecoveryIntent memory intent = _createTestIntent();

        bytes32 typedDataHash = harness.hashTypedData(intent, address(harness));

        bytes32 domainSep = harness.domainSeparator(address(harness));
        bytes32 structHash = harness.hashStruct(intent);
        bytes32 expected = keccak256(
            abi.encodePacked("\x19\x01", domainSep, structHash)
        );

        assertEq(typedDataHash, expected);
    }

    function test_hashTypedData_differentNonces() public view {
        EIP712Lib.RecoveryIntent memory intent1 = _createTestIntent();
        intent1.nonce = 0;

        EIP712Lib.RecoveryIntent memory intent2 = _createTestIntent();
        intent2.nonce = 1;

        bytes32 hash1 = harness.hashTypedData(intent1, address(harness));
        bytes32 hash2 = harness.hashTypedData(intent2, address(harness));

        assertTrue(hash1 != hash2, "Different nonces should produce different hashes");
    }

    function test_hashTypedData_differentChains() public {
        EIP712Lib.RecoveryIntent memory intent1 = _createTestIntent();
        intent1.chainId = 1;

        EIP712Lib.RecoveryIntent memory intent2 = _createTestIntent();
        intent2.chainId = 137;

        bytes32 hash1 = harness.hashStruct(intent1);
        bytes32 hash2 = harness.hashStruct(intent2);

        assertTrue(hash1 != hash2, "Different chainIds should produce different struct hashes");
    }

    function test_hashTypedData_differentRecoveryManagers() public view {
        EIP712Lib.RecoveryIntent memory intent1 = _createTestIntent();
        intent1.recoveryManager = address(1);

        EIP712Lib.RecoveryIntent memory intent2 = _createTestIntent();
        intent2.recoveryManager = address(2);

        bytes32 hash1 = harness.hashTypedData(intent1, address(1));
        bytes32 hash2 = harness.hashTypedData(intent2, address(2));

        assertTrue(hash1 != hash2, "Different recoveryManagers should produce different hashes");
    }

    function test_hashTypedData_differentDeadlines() public view {
        EIP712Lib.RecoveryIntent memory intent1 = _createTestIntent();
        intent1.deadline = 1000;

        EIP712Lib.RecoveryIntent memory intent2 = _createTestIntent();
        intent2.deadline = 2000;

        bytes32 hash1 = harness.hashTypedData(intent1, address(harness));
        bytes32 hash2 = harness.hashTypedData(intent2, address(harness));

        assertTrue(hash1 != hash2, "Different deadlines should produce different hashes");
    }

    function test_hashTypedData_differentNewOwners() public view {
        EIP712Lib.RecoveryIntent memory intent1 = _createTestIntent();
        intent1.newOwner = address(100);

        EIP712Lib.RecoveryIntent memory intent2 = _createTestIntent();
        intent2.newOwner = address(200);

        bytes32 hash1 = harness.hashTypedData(intent1, address(harness));
        bytes32 hash2 = harness.hashTypedData(intent2, address(harness));

        assertTrue(hash1 != hash2, "Different newOwners should produce different hashes");
    }

    function testFuzz_hashTypedData(
        address wallet,
        address newOwner,
        uint256 nonce,
        uint256 deadline,
        uint256 chainId,
        address recoveryManager
    ) public view {
        EIP712Lib.RecoveryIntent memory intent = EIP712Lib.RecoveryIntent({
            wallet: wallet,
            newOwner: newOwner,
            nonce: nonce,
            deadline: deadline,
            chainId: chainId,
            recoveryManager: recoveryManager
        });

        // Should not revert
        bytes32 hash = harness.hashTypedData(intent, recoveryManager);
        assertTrue(hash != bytes32(0) || (wallet == address(0) && newOwner == address(0)));
    }

    function _createTestIntent() internal view returns (EIP712Lib.RecoveryIntent memory) {
        return EIP712Lib.RecoveryIntent({
            wallet: address(0x1111111111111111111111111111111111111111),
            newOwner: address(0x2222222222222222222222222222222222222222),
            nonce: 0,
            deadline: block.timestamp + 1 days,
            chainId: block.chainid,
            recoveryManager: address(harness)
        });
    }
}

/// @dev Test harness to expose internal library functions
contract EIP712LibHarness {
    function domainSeparator(address verifyingContract) external view returns (bytes32) {
        return EIP712Lib.domainSeparator(verifyingContract);
    }

    function hashStruct(EIP712Lib.RecoveryIntent memory intent) external pure returns (bytes32) {
        return EIP712Lib.hashStruct(intent);
    }

    function hashTypedData(
        EIP712Lib.RecoveryIntent memory intent,
        address verifyingContract
    ) external view returns (bytes32) {
        return EIP712Lib.hashTypedData(intent, verifyingContract);
    }
}
