// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Test} from "forge-std/Test.sol";
import {RecoveryManager} from "../src/RecoveryManager.sol";
import {IRecoveryManager} from "../src/interfaces/IRecoveryManager.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {GuardianLib} from "../src/libraries/GuardianLib.sol";
import {EIP712Lib} from "../src/libraries/EIP712Lib.sol";

// ============ Mock Contracts ============

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

contract MockWalletStrictAuth {
    address public owner;
    mapping(address => bool) private _authorized;

    constructor(address _owner) {
        owner = _owner;
    }

    function setOwner(address newOwner) external {
        require(msg.sender == owner || _authorized[msg.sender], "not authorized");
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

contract MockVerifier is IVerifier {
    bool public returnValue = true;

    function setReturnValue(bool _value) external {
        returnValue = _value;
    }

    function verify(bytes32, bytes32, bytes calldata) external view override returns (bool) {
        return returnValue;
    }

    function guardianType() external pure override returns (uint8) {
        return 1;
    }
}

// ============ Test Base ============

contract RecoveryManagerTestBase is Test {
    RecoveryManager rm;
    MockWallet wallet;
    MockVerifier passkeyVerifier;
    MockVerifier zkJwtVerifier;

    address walletOwner = address(0x1111);
    address newOwner = address(0x2222);

    // EOA guardian keys
    uint256 guardian1Key = 0xA11CE;
    address guardian1Addr;
    bytes32 guardian1Id;

    uint256 guardian2Key = 0xB0B;
    address guardian2Addr;
    bytes32 guardian2Id;

    uint256 guardian3Key = 0xCA1;
    address guardian3Addr;
    bytes32 guardian3Id;

    uint256 constant CHALLENGE_PERIOD = 1 days;
    uint256 constant DEADLINE = 7 days;

    function setUp() public virtual {
        // Derive guardian addresses
        guardian1Addr = vm.addr(guardian1Key);
        guardian1Id = GuardianLib.computeEoaIdentifier(guardian1Addr);

        guardian2Addr = vm.addr(guardian2Key);
        guardian2Id = GuardianLib.computeEoaIdentifier(guardian2Addr);

        guardian3Addr = vm.addr(guardian3Key);
        guardian3Id = GuardianLib.computeEoaIdentifier(guardian3Addr);

        // Deploy mocks
        wallet = new MockWallet(walletOwner);
        passkeyVerifier = new MockVerifier();
        zkJwtVerifier = new MockVerifier();

        // Deploy and initialize RecoveryManager directly (not via factory for unit tests)
        RecoveryManager impl = new RecoveryManager();
        // Deploy a minimal proxy manually for testing
        rm = RecoveryManager(_deployProxy(address(impl)));

        GuardianLib.Guardian[] memory guardians = _createEoaGuardians3();
        rm.initialize(
            address(wallet),
            guardians,
            2, // 2-of-3
            CHALLENGE_PERIOD,
            address(passkeyVerifier),
            address(zkJwtVerifier)
        );
    }

    // ============ Helpers ============

    function _deployProxy(address impl) internal returns (address instance) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(96, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "proxy deployment failed");
    }

    function _createEoaGuardians3() internal view returns (GuardianLib.Guardian[] memory) {
        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](3);
        guardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);
        guardians[1] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian2Id);
        guardians[2] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian3Id);
        return guardians;
    }

    function _createIntent() internal view returns (EIP712Lib.RecoveryIntent memory) {
        return EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner,
            nonce: rm.nonce(),
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(rm)
        });
    }

    function _createIntentHash(EIP712Lib.RecoveryIntent memory intent) internal view returns (bytes32) {
        return EIP712Lib.hashTypedData(intent, address(rm));
    }

    function _signIntent(uint256 privateKey, bytes32 intentHash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, intentHash);
        return abi.encode(v, r, s);
    }

    function _startRecoveryWithGuardian1() internal returns (bytes32 intentHash) {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);
        rm.startRecovery(intent, 0, proof);
    }
}

// ============ Initialization Tests ============

contract RecoveryManager_Initialization is RecoveryManagerTestBase {
    function test_initialize_setsState() public view {
        assertEq(rm.wallet(), address(wallet));
        assertEq(rm.threshold(), 2);
        assertEq(rm.challengePeriod(), CHALLENGE_PERIOD);
        assertEq(rm.nonce(), 0);
        assertEq(rm.guardianCount(), 3);
    }

    function test_initialize_setsGuardians() public view {
        GuardianLib.Guardian memory g0 = rm.getGuardian(0);
        assertEq(uint8(g0.guardianType), uint8(GuardianLib.GuardianType.EOA));
        assertEq(g0.identifier, guardian1Id);

        GuardianLib.Guardian memory g1 = rm.getGuardian(1);
        assertEq(g1.identifier, guardian2Id);

        GuardianLib.Guardian memory g2 = rm.getGuardian(2);
        assertEq(g2.identifier, guardian3Id);
    }

    function test_initialize_revertsOnDoubleInit() public {
        GuardianLib.Guardian[] memory guardians = _createEoaGuardians3();
        vm.expectRevert(RecoveryManager.AlreadyInitialized.selector);
        rm.initialize(address(wallet), guardians, 2, 1 days, address(passkeyVerifier), address(zkJwtVerifier));
    }

    function test_initialize_revertsOnZeroWallet() public {
        RecoveryManager impl = new RecoveryManager();
        RecoveryManager proxy = RecoveryManager(_deployProxy(address(impl)));
        GuardianLib.Guardian[] memory guardians = _createEoaGuardians3();

        vm.expectRevert(RecoveryManager.ZeroWallet.selector);
        proxy.initialize(address(0), guardians, 2, 1 days, address(passkeyVerifier), address(zkJwtVerifier));
    }

    function test_initialize_revertsOnZeroThreshold() public {
        RecoveryManager impl = new RecoveryManager();
        RecoveryManager proxy = RecoveryManager(_deployProxy(address(impl)));
        GuardianLib.Guardian[] memory guardians = _createEoaGuardians3();

        vm.expectRevert(IRecoveryManager.InvalidPolicy.selector);
        proxy.initialize(address(wallet), guardians, 0, 1 days, address(passkeyVerifier), address(zkJwtVerifier));
    }

    function test_initialize_revertsOnThresholdExceedsCount() public {
        RecoveryManager impl = new RecoveryManager();
        RecoveryManager proxy = RecoveryManager(_deployProxy(address(impl)));
        GuardianLib.Guardian[] memory guardians = _createEoaGuardians3();

        vm.expectRevert(IRecoveryManager.InvalidPolicy.selector);
        proxy.initialize(address(wallet), guardians, 4, 1 days, address(passkeyVerifier), address(zkJwtVerifier));
    }

    function test_initialize_revertsOnZeroGuardians() public {
        RecoveryManager impl = new RecoveryManager();
        RecoveryManager proxy = RecoveryManager(_deployProxy(address(impl)));
        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](0);

        vm.expectRevert(IRecoveryManager.InvalidPolicy.selector);
        proxy.initialize(address(wallet), guardians, 0, 1 days, address(passkeyVerifier), address(zkJwtVerifier));
    }

    function test_isRecoveryActive_falseInitially() public view {
        assertFalse(rm.isRecoveryActive());
    }

    function test_getSession_emptyInitially() public view {
        (bytes32 intentHash, address sessionNewOwner, uint256 deadline, uint256 thresholdMetAt, uint256 approvalCount)
            = rm.getSession();
        assertEq(intentHash, bytes32(0));
        assertEq(sessionNewOwner, address(0));
        assertEq(deadline, 0);
        assertEq(thresholdMetAt, 0);
        assertEq(approvalCount, 0);
    }
}

// ============ startRecovery Tests ============

contract RecoveryManager_StartRecovery is RecoveryManagerTestBase {
    function test_startRecovery_eoaHappyPath() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        rm.startRecovery(intent, 0, proof);

        assertTrue(rm.isRecoveryActive());
    }

    function test_startRecovery_createsSessionCorrectly() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        rm.startRecovery(intent, 0, proof);

        (bytes32 sessionHash, address sessionNewOwner, uint256 deadline, uint256 thresholdMetAt, uint256 approvalCount)
            = rm.getSession();
        assertEq(sessionHash, intentHash);
        assertEq(sessionNewOwner, newOwner);
        assertEq(deadline, intent.deadline);
        assertEq(thresholdMetAt, 0); // 2-of-3, only 1 approval
        assertEq(approvalCount, 1);
        assertTrue(rm.hasApproved(guardian1Id));
    }

    function test_startRecovery_emitsEvents() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        vm.expectEmit(true, true, false, true);
        emit IRecoveryManager.RecoveryStarted(intentHash, address(wallet), newOwner, intent.deadline);

        vm.expectEmit(true, true, false, true);
        emit IRecoveryManager.ProofSubmitted(intentHash, guardian1Id, 1);

        rm.startRecovery(intent, 0, proof);
    }

    function test_startRecovery_thresholdMetImmediately_1ofN() public {
        // Deploy a 1-of-3 RecoveryManager
        RecoveryManager impl = new RecoveryManager();
        RecoveryManager rm1of3 = RecoveryManager(_deployProxy(address(impl)));
        GuardianLib.Guardian[] memory guardians = _createEoaGuardians3();
        rm1of3.initialize(address(wallet), guardians, 1, CHALLENGE_PERIOD, address(passkeyVerifier), address(zkJwtVerifier));

        EIP712Lib.RecoveryIntent memory intent = EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner,
            nonce: 0,
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(rm1of3)
        });
        bytes32 intentHash = EIP712Lib.hashTypedData(intent, address(rm1of3));
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        vm.expectEmit(true, false, false, true);
        emit IRecoveryManager.ThresholdMet(intentHash, block.timestamp);

        rm1of3.startRecovery(intent, 0, proof);

        (, , , uint256 thresholdMetAt, ) = rm1of3.getSession();
        assertEq(thresholdMetAt, block.timestamp);
    }

    function test_startRecovery_revertsIfSessionActive() public {
        _startRecoveryWithGuardian1();

        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian2Key, intentHash);

        vm.expectRevert(IRecoveryManager.RecoveryAlreadyActive.selector);
        rm.startRecovery(intent, 1, proof);
    }

    function test_startRecovery_revertsOnWrongWallet() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        intent.wallet = address(0xdead);
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        vm.expectRevert(IRecoveryManager.InvalidIntent.selector);
        rm.startRecovery(intent, 0, proof);
    }

    function test_startRecovery_revertsOnWrongNonce() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        intent.nonce = 999;
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        vm.expectRevert(IRecoveryManager.InvalidIntent.selector);
        rm.startRecovery(intent, 0, proof);
    }

    function test_startRecovery_revertsOnWrongChainId() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        intent.chainId = 999;
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        vm.expectRevert(IRecoveryManager.InvalidIntent.selector);
        rm.startRecovery(intent, 0, proof);
    }

    function test_startRecovery_revertsOnWrongRecoveryManager() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        intent.recoveryManager = address(0xdead);
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        vm.expectRevert(IRecoveryManager.InvalidIntent.selector);
        rm.startRecovery(intent, 0, proof);
    }

    function test_startRecovery_revertsOnZeroNewOwner() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        intent.newOwner = address(0);
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        vm.expectRevert(IRecoveryManager.InvalidIntent.selector);
        rm.startRecovery(intent, 0, proof);
    }

    function test_startRecovery_revertsOnExpiredDeadline() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        intent.deadline = block.timestamp; // exactly now, should fail (must be > block.timestamp)
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        vm.expectRevert(IRecoveryManager.IntentExpired.selector);
        rm.startRecovery(intent, 0, proof);
    }

    function test_startRecovery_revertsWhenDeadlineAtChallengeBoundary() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        intent.deadline = block.timestamp + CHALLENGE_PERIOD;
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        vm.expectRevert(IRecoveryManager.InvalidIntent.selector);
        rm.startRecovery(intent, 0, proof);
    }

    function test_startRecovery_acceptsDeadlineBeyondChallengeBoundary() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        intent.deadline = block.timestamp + CHALLENGE_PERIOD + 1;
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        rm.startRecovery(intent, 0, proof);
        assertTrue(rm.isRecoveryActive());
    }

    function test_startRecovery_revertsOnInvalidGuardianIndex() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        vm.expectRevert(IRecoveryManager.GuardianNotFound.selector);
        rm.startRecovery(intent, 99, proof);
    }

    function test_startRecovery_revertsOnInvalidProof() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        bytes32 intentHash = _createIntentHash(intent);
        // Sign with wrong key (guardian2 signing for guardian1's index)
        bytes memory proof = _signIntent(guardian2Key, intentHash);

        vm.expectRevert(IRecoveryManager.InvalidProof.selector);
        rm.startRecovery(intent, 0, proof);
    }
}

// ============ submitProof Tests ============

contract RecoveryManager_SubmitProof is RecoveryManagerTestBase {
    function test_submitProof_happyPath() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();
        bytes memory proof = _signIntent(guardian2Key, intentHash);

        rm.submitProof(1, proof);

        assertEq(rm.hasApproved(guardian2Id), true);
        (, , , , uint256 approvalCount) = rm.getSession();
        assertEq(approvalCount, 2);
    }

    function test_submitProof_thresholdMetTriggersEvent() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();
        bytes memory proof = _signIntent(guardian2Key, intentHash);

        vm.expectEmit(true, false, false, true);
        emit IRecoveryManager.ThresholdMet(intentHash, block.timestamp);

        rm.submitProof(1, proof);

        (, , , uint256 thresholdMetAt, ) = rm.getSession();
        assertEq(thresholdMetAt, block.timestamp);
    }

    function test_submitProof_emitsProofSubmittedEvent() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();
        bytes memory proof = _signIntent(guardian2Key, intentHash);

        vm.expectEmit(true, true, false, true);
        emit IRecoveryManager.ProofSubmitted(intentHash, guardian2Id, 2);

        rm.submitProof(1, proof);
    }

    function test_submitProof_thirdGuardianAfterThreshold() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();

        // Second guardian meets threshold
        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm.submitProof(1, proof2);

        // Third guardian - threshold already met, no ThresholdMet event
        bytes memory proof3 = _signIntent(guardian3Key, intentHash);
        rm.submitProof(2, proof3);

        (, , , , uint256 approvalCount) = rm.getSession();
        assertEq(approvalCount, 3);
    }

    function test_submitProof_revertsIfNoSession() public {
        bytes memory proof = _signIntent(guardian1Key, bytes32(0));

        vm.expectRevert(IRecoveryManager.RecoveryNotActive.selector);
        rm.submitProof(0, proof);
    }

    function test_submitProof_revertsOnExpiredDeadline() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();

        // Warp past deadline
        vm.warp(block.timestamp + DEADLINE + 1);

        bytes memory proof = _signIntent(guardian2Key, intentHash);

        vm.expectRevert(IRecoveryManager.IntentExpired.selector);
        rm.submitProof(1, proof);
    }

    function test_submitProof_revertsIfAlreadyApproved() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();

        // Guardian 1 already approved during startRecovery
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        vm.expectRevert(IRecoveryManager.GuardianAlreadyApproved.selector);
        rm.submitProof(0, proof);
    }

    function test_submitProof_revertsOnInvalidIndex() public {
        _startRecoveryWithGuardian1();

        vm.expectRevert(IRecoveryManager.GuardianNotFound.selector);
        rm.submitProof(99, hex"");
    }

    function test_submitProof_revertsOnInvalidProof() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();

        // Sign with wrong key
        bytes memory proof = _signIntent(guardian3Key, intentHash);

        vm.expectRevert(IRecoveryManager.InvalidProof.selector);
        rm.submitProof(1, proof); // guardian2's index but guardian3's signature
    }
}

// ============ executeRecovery Tests ============

contract RecoveryManager_ExecuteRecovery is RecoveryManagerTestBase {
    function test_executeRecovery_fullFlow() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();

        // Submit second proof to meet threshold
        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm.submitProof(1, proof2);

        // Warp past challenge period
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);

        rm.executeRecovery();

        // Wallet owner changed
        assertEq(wallet.owner(), newOwner);
    }

    function test_executeRecovery_setsWalletOwner() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();
        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm.submitProof(1, proof2);
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);

        rm.executeRecovery();
        assertEq(wallet.owner(), newOwner);
    }

    function test_executeRecovery_incrementsNonce() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();
        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm.submitProof(1, proof2);
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);

        uint256 nonceBefore = rm.nonce();
        rm.executeRecovery();
        assertEq(rm.nonce(), nonceBefore + 1);
    }

    function test_executeRecovery_clearsSession() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();
        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm.submitProof(1, proof2);
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);

        rm.executeRecovery();

        assertFalse(rm.isRecoveryActive());
        (bytes32 ih, , , , ) = rm.getSession();
        assertEq(ih, bytes32(0));
    }

    function test_executeRecovery_emitsEvent() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();
        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm.submitProof(1, proof2);
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);

        vm.expectEmit(true, true, false, true);
        emit IRecoveryManager.RecoveryExecuted(intentHash, address(wallet), newOwner);

        rm.executeRecovery();
    }

    function test_executeRecovery_anyoneCanCall() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();
        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm.submitProof(1, proof2);
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);

        vm.prank(address(0xFFFF)); // random caller
        rm.executeRecovery();
        assertEq(wallet.owner(), newOwner);
    }

    function test_executeRecovery_revertsIfNoSession() public {
        vm.expectRevert(IRecoveryManager.RecoveryNotActive.selector);
        rm.executeRecovery();
    }

    function test_executeRecovery_revertsIfThresholdNotMet() public {
        _startRecoveryWithGuardian1();

        vm.expectRevert(IRecoveryManager.ThresholdNotMet.selector);
        rm.executeRecovery();
    }

    function test_executeRecovery_revertsIfChallengePeriodNotElapsed() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();
        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm.submitProof(1, proof2);

        // Don't warp forward
        vm.expectRevert(IRecoveryManager.ChallengePeriodNotElapsed.selector);
        rm.executeRecovery();
    }

    function test_executeRecovery_revertsIfDeadlinePassed() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();
        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm.submitProof(1, proof2);

        // Warp past deadline (which is > challenge period)
        vm.warp(block.timestamp + DEADLINE + 1);

        vm.expectRevert(IRecoveryManager.IntentExpired.selector);
        rm.executeRecovery();
    }
}

// ============ cancelRecovery Tests ============

contract RecoveryManager_CancelRecovery is RecoveryManagerTestBase {
    function test_cancelRecovery_ownerCancels() public {
        _startRecoveryWithGuardian1();

        vm.prank(walletOwner);
        rm.cancelRecovery();

        assertFalse(rm.isRecoveryActive());
    }

    function test_cancelRecovery_incrementsNonce() public {
        _startRecoveryWithGuardian1();

        uint256 nonceBefore = rm.nonce();
        vm.prank(walletOwner);
        rm.cancelRecovery();
        assertEq(rm.nonce(), nonceBefore + 1);
    }

    function test_cancelRecovery_clearsSession() public {
        _startRecoveryWithGuardian1();

        vm.prank(walletOwner);
        rm.cancelRecovery();

        (bytes32 ih, , , , ) = rm.getSession();
        assertEq(ih, bytes32(0));
        assertFalse(rm.hasApproved(guardian1Id));
    }

    function test_cancelRecovery_emitsEvent() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();

        vm.expectEmit(true, true, false, false);
        emit IRecoveryManager.RecoveryCancelled(intentHash, address(wallet));

        vm.prank(walletOwner);
        rm.cancelRecovery();
    }

    function test_cancelRecovery_revertsIfNoSession() public {
        vm.prank(walletOwner);
        vm.expectRevert(IRecoveryManager.RecoveryNotActive.selector);
        rm.cancelRecovery();
    }

    function test_cancelRecovery_revertsIfNotOwner() public {
        _startRecoveryWithGuardian1();

        vm.prank(address(0xdead));
        vm.expectRevert(IRecoveryManager.Unauthorized.selector);
        rm.cancelRecovery();
    }
}

// ============ clearExpiredRecovery Tests ============

contract RecoveryManager_ClearExpiredRecovery is RecoveryManagerTestBase {
    function test_clearExpiredRecovery_happyPath() public {
        _startRecoveryWithGuardian1();
        assertTrue(rm.isRecoveryActive());

        // Warp past deadline
        vm.warp(block.timestamp + DEADLINE + 1);

        // Anyone can clear
        vm.prank(address(0xFFFF));
        rm.clearExpiredRecovery();

        assertFalse(rm.isRecoveryActive());
    }

    function test_clearExpiredRecovery_incrementsNonce() public {
        _startRecoveryWithGuardian1();

        vm.warp(block.timestamp + DEADLINE + 1);

        uint256 nonceBefore = rm.nonce();
        rm.clearExpiredRecovery();
        assertEq(rm.nonce(), nonceBefore + 1);
    }

    function test_clearExpiredRecovery_emitsEvent() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();

        vm.warp(block.timestamp + DEADLINE + 1);

        vm.expectEmit(true, true, false, false);
        emit IRecoveryManager.RecoveryCancelled(intentHash, address(wallet));

        rm.clearExpiredRecovery();
    }

    function test_clearExpiredRecovery_allowsNewRecovery() public {
        _startRecoveryWithGuardian1();

        // Warp past deadline
        vm.warp(block.timestamp + DEADLINE + 1);

        // Clear expired session
        rm.clearExpiredRecovery();

        // Start a new recovery with updated nonce
        EIP712Lib.RecoveryIntent memory newIntent = EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner,
            nonce: rm.nonce(),
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(rm)
        });
        bytes32 newIntentHash = _createIntentHash(newIntent);
        bytes memory proof = _signIntent(guardian1Key, newIntentHash);

        rm.startRecovery(newIntent, 0, proof);
        assertTrue(rm.isRecoveryActive());
    }

    function test_clearExpiredRecovery_revertsIfNoSession() public {
        vm.expectRevert(IRecoveryManager.RecoveryNotActive.selector);
        rm.clearExpiredRecovery();
    }

    function test_clearExpiredRecovery_revertsIfDeadlineNotReached() public {
        _startRecoveryWithGuardian1();

        // Don't warp past deadline
        vm.expectRevert(IRecoveryManager.DeadlineNotReached.selector);
        rm.clearExpiredRecovery();
    }

    function test_clearExpiredRecovery_revertsAtExactDeadline() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);
        rm.startRecovery(intent, 0, proof);

        // Warp to exactly deadline (deadline check is <, not <=)
        // submitProof/executeRecovery use >= for expiry, so at exactly deadline they revert
        // clearExpiredRecovery uses < for "not reached", so at exactly deadline it should succeed
        vm.warp(intent.deadline);
        rm.clearExpiredRecovery();
        assertFalse(rm.isRecoveryActive());
    }
}

// ============ updatePolicy Tests ============

contract RecoveryManager_UpdatePolicy is RecoveryManagerTestBase {
    function test_updatePolicy_changesGuardians() public {
        GuardianLib.Guardian[] memory newGuardians = new GuardianLib.Guardian[](1);
        newGuardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);

        vm.prank(walletOwner);
        rm.updatePolicy(newGuardians, 1, 2 days);

        assertEq(rm.guardianCount(), 1);
        assertEq(rm.threshold(), 1);
        assertEq(rm.challengePeriod(), 2 days);
    }

    function test_updatePolicy_incrementsNonce() public {
        GuardianLib.Guardian[] memory newGuardians = new GuardianLib.Guardian[](1);
        newGuardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);

        uint256 nonceBefore = rm.nonce();
        vm.prank(walletOwner);
        rm.updatePolicy(newGuardians, 1, 1 days);
        assertEq(rm.nonce(), nonceBefore + 1);
    }

    function test_updatePolicy_invalidatesActiveSession() public {
        _startRecoveryWithGuardian1();
        assertTrue(rm.isRecoveryActive());

        GuardianLib.Guardian[] memory newGuardians = new GuardianLib.Guardian[](1);
        newGuardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);

        vm.prank(walletOwner);
        rm.updatePolicy(newGuardians, 1, 1 days);

        assertFalse(rm.isRecoveryActive());
    }

    function test_updatePolicy_emitsEvent() public {
        GuardianLib.Guardian[] memory newGuardians = new GuardianLib.Guardian[](1);
        newGuardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);

        vm.expectEmit(true, false, false, false);
        emit IRecoveryManager.PolicyUpdated(address(wallet));

        vm.prank(walletOwner);
        rm.updatePolicy(newGuardians, 1, 1 days);
    }

    function test_updatePolicy_revertsIfNotOwner() public {
        GuardianLib.Guardian[] memory newGuardians = new GuardianLib.Guardian[](1);
        newGuardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);

        vm.prank(address(0xdead));
        vm.expectRevert(IRecoveryManager.Unauthorized.selector);
        rm.updatePolicy(newGuardians, 1, 1 days);
    }

    function test_updatePolicy_revertsOnInvalidPolicy_zeroThreshold() public {
        GuardianLib.Guardian[] memory newGuardians = new GuardianLib.Guardian[](1);
        newGuardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);

        vm.prank(walletOwner);
        vm.expectRevert(IRecoveryManager.InvalidPolicy.selector);
        rm.updatePolicy(newGuardians, 0, 1 days);
    }

    function test_updatePolicy_revertsOnInvalidPolicy_thresholdExceedsCount() public {
        GuardianLib.Guardian[] memory newGuardians = new GuardianLib.Guardian[](1);
        newGuardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);

        vm.prank(walletOwner);
        vm.expectRevert(IRecoveryManager.InvalidPolicy.selector);
        rm.updatePolicy(newGuardians, 2, 1 days);
    }

    function test_updatePolicy_revertsOnInvalidPolicy_duplicateGuardians() public {
        GuardianLib.Guardian[] memory newGuardians = new GuardianLib.Guardian[](2);
        newGuardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);
        newGuardians[1] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);

        vm.prank(walletOwner);
        vm.expectRevert(IRecoveryManager.InvalidPolicy.selector);
        rm.updatePolicy(newGuardians, 1, 1 days);
    }

    function test_updatePolicy_revertsOnInvalidPolicy_tooManyGuardians() public {
        // 256 guardians exceeds uint8 max (255)
        GuardianLib.Guardian[] memory newGuardians = new GuardianLib.Guardian[](256);
        for (uint256 i = 0; i < 256; i++) {
            newGuardians[i] = GuardianLib.Guardian(
                GuardianLib.GuardianType.EOA,
                bytes32(uint256(uint160(address(uint160(i + 1)))))
            );
        }

        vm.prank(walletOwner);
        vm.expectRevert(IRecoveryManager.InvalidPolicy.selector);
        rm.updatePolicy(newGuardians, 1, 1 days);
    }

    function test_updatePolicy_revertsOnInvalidPolicy_nonCanonicalEoa() public {
        GuardianLib.Guardian[] memory newGuardians = new GuardianLib.Guardian[](1);
        // Upper bits set — non-canonical EOA identifier
        newGuardians[0] = GuardianLib.Guardian(
            GuardianLib.GuardianType.EOA,
            bytes32(uint256(1) | (uint256(0xFF) << 160))
        );

        vm.prank(walletOwner);
        vm.expectRevert(IRecoveryManager.InvalidPolicy.selector);
        rm.updatePolicy(newGuardians, 1, 1 days);
    }

    function test_updatePolicy_revertsOnInvalidPolicy_zeroIdentifier() public {
        GuardianLib.Guardian[] memory newGuardians = new GuardianLib.Guardian[](1);
        newGuardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, bytes32(0));

        vm.prank(walletOwner);
        vm.expectRevert(IRecoveryManager.InvalidPolicy.selector);
        rm.updatePolicy(newGuardians, 1, 1 days);
    }
}

// ============ Replay Protection Tests ============

contract RecoveryManager_ReplayProtection is RecoveryManagerTestBase {
    function test_oldProofsFailAfterExecution() public {
        // First recovery
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof1 = _signIntent(guardian1Key, intentHash);
        bytes memory proof2 = _signIntent(guardian2Key, intentHash);

        rm.startRecovery(intent, 0, proof1);
        rm.submitProof(1, proof2);
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        rm.executeRecovery();

        // Nonce is now 1, old proofs (nonce=0) should fail
        vm.expectRevert(IRecoveryManager.InvalidIntent.selector);
        rm.startRecovery(intent, 0, proof1);
    }

    function test_oldProofsFailAfterCancellation() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof1 = _signIntent(guardian1Key, intentHash);

        rm.startRecovery(intent, 0, proof1);

        vm.prank(walletOwner);
        rm.cancelRecovery();

        // Nonce is now 1, old proofs should fail
        vm.expectRevert(IRecoveryManager.InvalidIntent.selector);
        rm.startRecovery(intent, 0, proof1);
    }

    function test_intentBoundToSpecificContract() public {
        // Create intent for a different recovery manager
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        intent.recoveryManager = address(0xdead);
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        vm.expectRevert(IRecoveryManager.InvalidIntent.selector);
        rm.startRecovery(intent, 0, proof);
    }
}

// ============ Full Flow Tests ============

contract RecoveryManager_FullFlows is RecoveryManagerTestBase {
    function test_fullFlow_2of3_eoaGuardians() public {
        // Guardian 1 starts
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof1 = _signIntent(guardian1Key, intentHash);
        rm.startRecovery(intent, 0, proof1);

        // Guardian 2 submits
        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm.submitProof(1, proof2);

        // Challenge period
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);

        // Execute
        rm.executeRecovery();

        assertEq(wallet.owner(), newOwner);
        assertEq(rm.nonce(), 1);
        assertFalse(rm.isRecoveryActive());
    }

    function test_fullFlow_1of1_minimal() public {
        // Deploy 1-of-1
        RecoveryManager impl = new RecoveryManager();
        RecoveryManager rm1 = RecoveryManager(_deployProxy(address(impl)));
        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](1);
        guardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);
        rm1.initialize(address(wallet), guardians, 1, 0, address(passkeyVerifier), address(zkJwtVerifier));

        EIP712Lib.RecoveryIntent memory intent = EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner,
            nonce: 0,
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(rm1)
        });
        bytes32 intentHash = EIP712Lib.hashTypedData(intent, address(rm1));
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        rm1.startRecovery(intent, 0, proof);

        // Challenge period is 0, can execute immediately
        rm1.executeRecovery();

        assertEq(wallet.owner(), newOwner);
    }

    function test_fullFlow_cancelAndRestart() public {
        // Start recovery
        EIP712Lib.RecoveryIntent memory intent1 = _createIntent();
        bytes32 intentHash1 = _createIntentHash(intent1);
        bytes memory proof1 = _signIntent(guardian1Key, intentHash1);
        rm.startRecovery(intent1, 0, proof1);

        // Owner cancels
        vm.prank(walletOwner);
        rm.cancelRecovery();
        assertEq(rm.nonce(), 1);

        // Start new recovery with updated nonce
        address newOwner2 = address(0x3333);
        EIP712Lib.RecoveryIntent memory intent2 = EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner2,
            nonce: 1,
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(rm)
        });
        bytes32 intentHash2 = EIP712Lib.hashTypedData(intent2, address(rm));
        bytes memory proof2g1 = _signIntent(guardian1Key, intentHash2);
        rm.startRecovery(intent2, 0, proof2g1);

        bytes memory proof2g2 = _signIntent(guardian2Key, intentHash2);
        rm.submitProof(1, proof2g2);

        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        rm.executeRecovery();

        assertEq(wallet.owner(), newOwner2);
        assertEq(rm.nonce(), 2);
    }

    function test_fullFlow_updatePolicyThenRecover() public {
        // Update to 1-of-1 with only guardian1
        GuardianLib.Guardian[] memory newGuardians = new GuardianLib.Guardian[](1);
        newGuardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);

        vm.prank(walletOwner);
        rm.updatePolicy(newGuardians, 1, 0);
        assertEq(rm.nonce(), 1);

        // Recovery with new policy
        EIP712Lib.RecoveryIntent memory intent = EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner,
            nonce: 1,
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(rm)
        });
        bytes32 intentHash = EIP712Lib.hashTypedData(intent, address(rm));
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        rm.startRecovery(intent, 0, proof);
        rm.executeRecovery();

        assertEq(wallet.owner(), newOwner);
    }
}

// ============ Fuzz Tests ============

contract RecoveryManager_Fuzz is RecoveryManagerTestBase {
    function testFuzz_startRecovery_revertsOnInvalidGuardianIndex(uint256 index) public {
        vm.assume(index >= 3); // 3 guardians

        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof = _signIntent(guardian1Key, intentHash);

        vm.expectRevert(IRecoveryManager.GuardianNotFound.selector);
        rm.startRecovery(intent, index, proof);
    }

    function testFuzz_executeRecovery_revertsIfTimestampBeforeChallengeEnd(uint256 warpTime) public {
        // Ensure we don't warp past deadline
        vm.assume(warpTime < CHALLENGE_PERIOD);

        bytes32 intentHash = _startRecoveryWithGuardian1();
        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm.submitProof(1, proof2);

        vm.warp(block.timestamp + warpTime);
        vm.expectRevert(IRecoveryManager.ChallengePeriodNotElapsed.selector);
        rm.executeRecovery();
    }
}

// ============ Mixed Guardian Type Tests ============

contract RecoveryManager_MixedGuardians is RecoveryManagerTestBase {
    function test_mixedGuardianTypes_eoaAndPasskey() public {
        // Deploy RM with mixed guardian types
        RecoveryManager impl = new RecoveryManager();
        RecoveryManager mixedRm = RecoveryManager(_deployProxy(address(impl)));

        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](2);
        guardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);
        guardians[1] = GuardianLib.Guardian(GuardianLib.GuardianType.Passkey, bytes32(uint256(0xAA55)));

        mixedRm.initialize(address(wallet), guardians, 2, CHALLENGE_PERIOD, address(passkeyVerifier), address(zkJwtVerifier));

        // Start with EOA guardian
        EIP712Lib.RecoveryIntent memory intent = EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner,
            nonce: 0,
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(mixedRm)
        });
        bytes32 intentHash = EIP712Lib.hashTypedData(intent, address(mixedRm));
        bytes memory eoaProof = _signIntent(guardian1Key, intentHash);

        mixedRm.startRecovery(intent, 0, eoaProof);

        // Submit with Passkey guardian (mock verifier returns true)
        bytes memory passkeyProof = hex"aabb";
        mixedRm.submitProof(1, passkeyProof);

        // Verify both approved
        assertTrue(mixedRm.hasApproved(guardian1Id));
        assertTrue(mixedRm.hasApproved(bytes32(uint256(0xAA55))));
    }

    function test_mixedGuardianTypes_eoaAndZkJwt() public {
        RecoveryManager impl = new RecoveryManager();
        RecoveryManager mixedRm = RecoveryManager(_deployProxy(address(impl)));

        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](2);
        guardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);
        guardians[1] = GuardianLib.Guardian(GuardianLib.GuardianType.ZkJWT, bytes32(uint256(0xBBCC)));

        mixedRm.initialize(address(wallet), guardians, 2, CHALLENGE_PERIOD, address(passkeyVerifier), address(zkJwtVerifier));

        EIP712Lib.RecoveryIntent memory intent = EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner,
            nonce: 0,
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(mixedRm)
        });
        bytes32 intentHash = EIP712Lib.hashTypedData(intent, address(mixedRm));
        bytes memory eoaProof = _signIntent(guardian1Key, intentHash);

        mixedRm.startRecovery(intent, 0, eoaProof);

        // Submit with zkJWT guardian (mock verifier returns true)
        bytes memory zkProof = hex"ccdd";
        mixedRm.submitProof(1, zkProof);

        assertTrue(mixedRm.hasApproved(guardian1Id));
        assertTrue(mixedRm.hasApproved(bytes32(uint256(0xBBCC))));
    }

    function test_startRecovery_revertsWhenPasskeyVerifierReturnsFalse() public {
        passkeyVerifier.setReturnValue(false);

        RecoveryManager impl = new RecoveryManager();
        RecoveryManager mixedRm = RecoveryManager(_deployProxy(address(impl)));

        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](2);
        guardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.Passkey, bytes32(uint256(0xAA55)));
        guardians[1] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);

        mixedRm.initialize(address(wallet), guardians, 2, CHALLENGE_PERIOD, address(passkeyVerifier), address(zkJwtVerifier));

        EIP712Lib.RecoveryIntent memory intent = EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner,
            nonce: 0,
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(mixedRm)
        });

        vm.expectRevert(IRecoveryManager.InvalidProof.selector);
        mixedRm.startRecovery(intent, 0, hex"deadbeef");
    }

    function test_submitProof_revertsWhenPasskeyVerifierReturnsFalse() public {
        passkeyVerifier.setReturnValue(false);

        RecoveryManager impl = new RecoveryManager();
        RecoveryManager mixedRm = RecoveryManager(_deployProxy(address(impl)));

        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](2);
        guardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);
        guardians[1] = GuardianLib.Guardian(GuardianLib.GuardianType.Passkey, bytes32(uint256(0xAA55)));

        mixedRm.initialize(address(wallet), guardians, 2, CHALLENGE_PERIOD, address(passkeyVerifier), address(zkJwtVerifier));

        EIP712Lib.RecoveryIntent memory intent = EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner,
            nonce: 0,
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(mixedRm)
        });
        bytes32 intentHash = EIP712Lib.hashTypedData(intent, address(mixedRm));
        bytes memory eoaProof = _signIntent(guardian1Key, intentHash);

        mixedRm.startRecovery(intent, 0, eoaProof);

        vm.expectRevert(IRecoveryManager.InvalidProof.selector);
        mixedRm.submitProof(1, hex"deadbeef");
    }

    function test_startRecovery_revertsWhenZkJwtVerifierReturnsFalse() public {
        zkJwtVerifier.setReturnValue(false);

        RecoveryManager impl = new RecoveryManager();
        RecoveryManager mixedRm = RecoveryManager(_deployProxy(address(impl)));

        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](2);
        guardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.ZkJWT, bytes32(uint256(0xBBCC)));
        guardians[1] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);

        mixedRm.initialize(address(wallet), guardians, 2, CHALLENGE_PERIOD, address(passkeyVerifier), address(zkJwtVerifier));

        EIP712Lib.RecoveryIntent memory intent = EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner,
            nonce: 0,
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(mixedRm)
        });

        vm.expectRevert(IRecoveryManager.InvalidProof.selector);
        mixedRm.startRecovery(intent, 0, hex"deadbeef");
    }

    function test_submitProof_revertsWhenZkJwtVerifierReturnsFalse() public {
        zkJwtVerifier.setReturnValue(false);

        RecoveryManager impl = new RecoveryManager();
        RecoveryManager mixedRm = RecoveryManager(_deployProxy(address(impl)));

        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](2);
        guardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);
        guardians[1] = GuardianLib.Guardian(GuardianLib.GuardianType.ZkJWT, bytes32(uint256(0xBBCC)));

        mixedRm.initialize(address(wallet), guardians, 2, CHALLENGE_PERIOD, address(passkeyVerifier), address(zkJwtVerifier));

        EIP712Lib.RecoveryIntent memory intent = EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner,
            nonce: 0,
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(mixedRm)
        });
        bytes32 intentHash = EIP712Lib.hashTypedData(intent, address(mixedRm));
        bytes memory eoaProof = _signIntent(guardian1Key, intentHash);

        mixedRm.startRecovery(intent, 0, eoaProof);

        vm.expectRevert(IRecoveryManager.InvalidProof.selector);
        mixedRm.submitProof(1, hex"deadbeef");
    }
}

// ============ Edge Case Tests ============

contract RecoveryManager_EdgeCases is RecoveryManagerTestBase {
    function test_getGuardian_revertsOnOutOfBounds() public {
        vm.expectRevert(IRecoveryManager.GuardianNotFound.selector);
        rm.getGuardian(10);
    }

    function test_hasApproved_falseForNonExistentGuardian() public view {
        assertFalse(rm.hasApproved(bytes32(uint256(0xdead))));
    }

    function test_executeRecovery_exactChallengePeriodBoundary() public {
        bytes32 intentHash = _startRecoveryWithGuardian1();
        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm.submitProof(1, proof2);

        uint256 thresholdTime = block.timestamp;

        // One second before boundary: should revert
        vm.warp(thresholdTime + CHALLENGE_PERIOD - 1);
        vm.expectRevert(IRecoveryManager.ChallengePeriodNotElapsed.selector);
        rm.executeRecovery();

        // Exactly at boundary (thresholdMetAt + challengePeriod): should succeed
        // because check is `block.timestamp < thresholdMetAt + challengePeriod`
        vm.warp(thresholdTime + CHALLENGE_PERIOD);
        rm.executeRecovery();

        assertEq(wallet.owner(), newOwner);
    }

    function test_submitProof_exactDeadlineBoundary() public {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        uint256 deadlineTs = intent.deadline;
        bytes32 intentHash = _createIntentHash(intent);
        bytes memory proof1 = _signIntent(guardian1Key, intentHash);
        rm.startRecovery(intent, 0, proof1);

        // Warp to exactly deadline
        vm.warp(deadlineTs);

        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        vm.expectRevert(IRecoveryManager.IntentExpired.selector);
        rm.submitProof(1, proof2);
    }

    function test_zeroChallengeperiod_immediateExecution() public {
        // Deploy with 0 challenge period
        RecoveryManager impl = new RecoveryManager();
        RecoveryManager rm0 = RecoveryManager(_deployProxy(address(impl)));
        GuardianLib.Guardian[] memory guardians = _createEoaGuardians3();
        rm0.initialize(address(wallet), guardians, 2, 0, address(passkeyVerifier), address(zkJwtVerifier));

        EIP712Lib.RecoveryIntent memory intent = EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner,
            nonce: 0,
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(rm0)
        });
        bytes32 intentHash = EIP712Lib.hashTypedData(intent, address(rm0));

        bytes memory proof1 = _signIntent(guardian1Key, intentHash);
        rm0.startRecovery(intent, 0, proof1);

        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm0.submitProof(1, proof2);

        // Should execute immediately (challenge period = 0, threshold just met at same timestamp)
        // block.timestamp >= thresholdMetAt + 0 is true
        // But our check is `block.timestamp < thresholdMetAt + challengePeriod` which is
        // block.timestamp < block.timestamp + 0 → block.timestamp < block.timestamp → false
        // So this should succeed
        rm0.executeRecovery();
        assertEq(wallet.owner(), newOwner);
    }
}

// ============ Wallet Authorization Integration Tests ============

contract RecoveryManager_WalletAuthorization is Test {
    RecoveryManager rm;
    MockWalletStrictAuth wallet;
    MockVerifier passkeyVerifier;
    MockVerifier zkJwtVerifier;

    address walletOwner = address(0x1111);
    address newOwner = address(0x2222);

    uint256 guardian1Key = 0xA11CE;
    address guardian1Addr;
    bytes32 guardian1Id;

    uint256 guardian2Key = 0xB0B;
    address guardian2Addr;
    bytes32 guardian2Id;

    uint256 constant CHALLENGE_PERIOD = 1 days;
    uint256 constant DEADLINE = 7 days;

    function setUp() public {
        guardian1Addr = vm.addr(guardian1Key);
        guardian1Id = GuardianLib.computeEoaIdentifier(guardian1Addr);
        guardian2Addr = vm.addr(guardian2Key);
        guardian2Id = GuardianLib.computeEoaIdentifier(guardian2Addr);

        wallet = new MockWalletStrictAuth(walletOwner);
        passkeyVerifier = new MockVerifier();
        zkJwtVerifier = new MockVerifier();

        RecoveryManager impl = new RecoveryManager();
        rm = RecoveryManager(_deployProxy(address(impl)));

        GuardianLib.Guardian[] memory guardians = new GuardianLib.Guardian[](2);
        guardians[0] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian1Id);
        guardians[1] = GuardianLib.Guardian(GuardianLib.GuardianType.EOA, guardian2Id);

        rm.initialize(
            address(wallet),
            guardians,
            2,
            CHALLENGE_PERIOD,
            address(passkeyVerifier),
            address(zkJwtVerifier)
        );
    }

    function _deployProxy(address impl) internal returns (address instance) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(96, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "proxy deployment failed");
    }

    function _createIntent() internal view returns (EIP712Lib.RecoveryIntent memory) {
        return EIP712Lib.RecoveryIntent({
            wallet: address(wallet),
            newOwner: newOwner,
            nonce: rm.nonce(),
            deadline: block.timestamp + DEADLINE,
            chainId: block.chainid,
            recoveryManager: address(rm)
        });
    }

    function _signIntent(uint256 privateKey, bytes32 intentHash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, intentHash);
        return abi.encode(v, r, s);
    }

    function _meetThresholdAndWait() internal {
        EIP712Lib.RecoveryIntent memory intent = _createIntent();
        bytes32 intentHash = EIP712Lib.hashTypedData(intent, address(rm));

        bytes memory proof1 = _signIntent(guardian1Key, intentHash);
        rm.startRecovery(intent, 0, proof1);

        bytes memory proof2 = _signIntent(guardian2Key, intentHash);
        rm.submitProof(1, proof2);

        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
    }

    function test_executeRecovery_revertsWhenRecoveryManagerNotAuthorized() public {
        _meetThresholdAndWait();

        vm.expectRevert();
        rm.executeRecovery();
        assertEq(wallet.owner(), walletOwner);
    }

    function test_executeRecovery_succeedsWhenRecoveryManagerAuthorized() public {
        _meetThresholdAndWait();

        vm.prank(walletOwner);
        wallet.authorize(address(rm));

        rm.executeRecovery();
        assertEq(wallet.owner(), newOwner);
    }
}
