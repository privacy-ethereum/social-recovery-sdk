// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Test} from "forge-std/Test.sol";
import {RecoveryManager} from "../src/RecoveryManager.sol";
import {RecoveryManagerFactory} from "../src/RecoveryManagerFactory.sol";
import {GuardianLib} from "../src/libraries/GuardianLib.sol";

/// @dev Minimal mock verifier for factory tests
contract MockVerifier {
    function verify(bytes32, bytes32, bytes calldata) external pure returns (bool) {
        return true;
    }
    function guardianType() external pure returns (uint8) {
        return 1;
    }
}

/// @dev Mock wallet for factory tests
contract MockWallet {
    address public owner;
    mapping(address => bool) private _authorized;

    constructor(address _owner) {
        owner = _owner;
    }

    function setOwner(address newOwner) external {
        owner = newOwner;
    }

    function isRecoveryAuthorized(address account) external view returns (bool) {
        return _authorized[account];
    }

    function authorize(address account) external {
        _authorized[account] = true;
    }
}

contract RecoveryManagerFactoryTest is Test {
    RecoveryManager implementation;
    RecoveryManagerFactory factory;
    MockVerifier passkeyVerifier;
    MockVerifier zkJwtVerifier;
    MockWallet wallet;

    address walletOwner = address(0x1111);

    function setUp() public {
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

    function test_constructor_state() public view {
        assertEq(factory.implementation(), address(implementation));
        assertEq(factory.passkeyVerifier(), address(passkeyVerifier));
        assertEq(factory.zkJwtVerifier(), address(zkJwtVerifier));
    }

    function test_deployRecoveryManager_deploysProxy() public {
        GuardianLib.Guardian[] memory guardians = _createGuardians(2);
        address proxy = factory.deployRecoveryManager(address(wallet), guardians, 1, 1 days);
        assertTrue(proxy != address(0));
        assertTrue(proxy != address(implementation));
    }

    function test_deployRecoveryManager_initializesProxy() public {
        GuardianLib.Guardian[] memory guardians = _createGuardians(2);
        address proxy = factory.deployRecoveryManager(address(wallet), guardians, 2, 1 days);

        RecoveryManager rm = RecoveryManager(proxy);
        assertEq(rm.wallet(), address(wallet));
        assertEq(rm.threshold(), 2);
        assertEq(rm.challengePeriod(), 1 days);
        assertEq(rm.guardianCount(), 2);
        assertEq(rm.nonce(), 0);
    }

    function test_deployRecoveryManager_recordsMapping() public {
        GuardianLib.Guardian[] memory guardians = _createGuardians(1);
        address proxy = factory.deployRecoveryManager(address(wallet), guardians, 1, 1 days);
        assertEq(factory.getRecoveryManager(address(wallet)), proxy);
    }

    function test_deployRecoveryManager_emitsEvent() public {
        GuardianLib.Guardian[] memory guardians = _createGuardians(1);

        vm.expectEmit(true, false, false, false);
        emit RecoveryManagerFactory.RecoveryManagerDeployed(address(wallet), address(0));

        factory.deployRecoveryManager(address(wallet), guardians, 1, 1 days);
    }

    function test_deployRecoveryManager_proxyDelegatesToImplementation() public {
        GuardianLib.Guardian[] memory guardians = _createGuardians(1);
        address proxy = factory.deployRecoveryManager(address(wallet), guardians, 1, 1 days);

        // Proxy should respond to RecoveryManager interface
        RecoveryManager rm = RecoveryManager(proxy);
        assertEq(rm.wallet(), address(wallet));
        assertFalse(rm.isRecoveryActive());
    }

    function test_deployRecoveryManager_differentWalletsDifferentProxies() public {
        MockWallet wallet2 = new MockWallet(walletOwner);

        GuardianLib.Guardian[] memory guardians = _createGuardians(1);
        address proxy1 = factory.deployRecoveryManager(address(wallet), guardians, 1, 1 days);
        address proxy2 = factory.deployRecoveryManager(address(wallet2), guardians, 1, 1 days);

        assertTrue(proxy1 != proxy2);
        assertEq(factory.getRecoveryManager(address(wallet)), proxy1);
        assertEq(factory.getRecoveryManager(address(wallet2)), proxy2);
    }

    function test_deployRecoveryManager_revertsOnDuplicate() public {
        GuardianLib.Guardian[] memory guardians = _createGuardians(1);
        factory.deployRecoveryManager(address(wallet), guardians, 1, 1 days);

        vm.expectRevert(RecoveryManagerFactory.AlreadyDeployed.selector);
        factory.deployRecoveryManager(address(wallet), guardians, 1, 1 days);
    }

    function test_implementation_cannotBeReinitialized() public {
        GuardianLib.Guardian[] memory guardians = _createGuardians(1);

        vm.expectRevert(RecoveryManager.AlreadyInitialized.selector);
        implementation.initialize(
            address(wallet),
            guardians,
            1,
            1 days,
            address(passkeyVerifier),
            address(zkJwtVerifier)
        );
    }

    function test_proxy_cannotBeReinitialized() public {
        GuardianLib.Guardian[] memory guardians = _createGuardians(1);
        address proxy = factory.deployRecoveryManager(address(wallet), guardians, 1, 1 days);

        vm.expectRevert(RecoveryManager.AlreadyInitialized.selector);
        RecoveryManager(proxy).initialize(
            address(wallet),
            guardians,
            1,
            1 days,
            address(passkeyVerifier),
            address(zkJwtVerifier)
        );
    }

    function test_deployRecoveryManager_guardianDataCorrect() public {
        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](2);
        guardians[0] = GuardianLib.Guardian({
            guardianType: GuardianLib.GuardianType.EOA,
            identifier: bytes32(uint256(uint160(address(0xAAAA))))
        });
        guardians[1] = GuardianLib.Guardian({
            guardianType: GuardianLib.GuardianType.Passkey,
            identifier: bytes32(uint256(0xBBBB))
        });

        address proxy = factory.deployRecoveryManager(address(wallet), guardians, 2, 1 days);
        RecoveryManager rm = RecoveryManager(proxy);

        GuardianLib.Guardian memory g0 = rm.getGuardian(0);
        assertEq(uint8(g0.guardianType), uint8(GuardianLib.GuardianType.EOA));
        assertEq(g0.identifier, bytes32(uint256(uint160(address(0xAAAA)))));

        GuardianLib.Guardian memory g1 = rm.getGuardian(1);
        assertEq(uint8(g1.guardianType), uint8(GuardianLib.GuardianType.Passkey));
        assertEq(g1.identifier, bytes32(uint256(0xBBBB)));
    }

    // ============ Helpers ============

    function _createGuardians(uint256 count) internal pure returns (GuardianLib.Guardian[] memory) {
        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](count);
        for (uint256 i = 0; i < count; i++) {
            guardians[i] = GuardianLib.Guardian({
                guardianType: GuardianLib.GuardianType.EOA,
                identifier: bytes32(uint256(uint160(address(uint160(i + 1)))))
            });
        }
        return guardians;
    }
}
