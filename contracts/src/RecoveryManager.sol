// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IRecoveryManager} from "./interfaces/IRecoveryManager.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";
import {IWallet} from "./interfaces/IWallet.sol";
import {GuardianLib} from "./libraries/GuardianLib.sol";
import {EIP712Lib} from "./libraries/EIP712Lib.sol";

/// @title RecoveryManager
/// @notice One instance per wallet, manages recovery sessions and proof verification
/// @dev Deployed as EIP-1167 proxies via RecoveryManagerFactory
contract RecoveryManager is IRecoveryManager {
    // ============ Storage ============

    bool private _initialized;

    address public override wallet;
    uint256 public override threshold;
    uint256 public override challengePeriod;
    uint256 public override nonce;

    GuardianLib.Guardian[] private _guardians;

    IVerifier public passkeyVerifier;
    IVerifier public zkJwtVerifier;

    // Session state (flattened — structs can't contain mappings)
    bytes32 private _sessionIntentHash;
    address private _sessionNewOwner;
    uint64 private _sessionDeadline;
    uint64 private _sessionThresholdMetAt;
    uint8 private _sessionApprovalCount;
    mapping(bytes32 => bool) private _sessionApprovals;

    // ============ Constructor ============

    /// @dev Prevents the implementation contract from being used directly
    constructor() {
        _initialized = true;
    }

    // ============ Initialization ============

    /// @notice Initializes the proxy instance
    /// @dev Called once by the factory after proxy deployment
    function initialize(
        address _wallet,
        GuardianLib.Guardian[] calldata guardians,
        uint256 _threshold,
        uint256 _challengePeriod,
        address _passkeyVerifier,
        address _zkJwtVerifier
    ) external {
        require(!_initialized, "already initialized");
        require(_wallet != address(0), "zero wallet");
        _initialized = true;

        wallet = _wallet;
        passkeyVerifier = IVerifier(_passkeyVerifier);
        zkJwtVerifier = IVerifier(_zkJwtVerifier);

        _setPolicy(guardians, _threshold, _challengePeriod);
    }

    // ============ View Functions ============

    /// @inheritdoc IRecoveryManager
    function guardianCount() external view override returns (uint256) {
        return _guardians.length;
    }

    /// @inheritdoc IRecoveryManager
    function getGuardian(uint256 index) external view override returns (GuardianLib.Guardian memory) {
        require(index < _guardians.length, "index out of bounds");
        return _guardians[index];
    }

    /// @inheritdoc IRecoveryManager
    function isRecoveryActive() external view override returns (bool) {
        return _sessionIntentHash != bytes32(0);
    }

    /// @inheritdoc IRecoveryManager
    function getSession()
        external
        view
        override
        returns (
            bytes32 intentHash,
            address newOwner,
            uint256 deadline,
            uint256 thresholdMetAt,
            uint256 approvalCount
        )
    {
        return (
            _sessionIntentHash,
            _sessionNewOwner,
            uint256(_sessionDeadline),
            uint256(_sessionThresholdMetAt),
            uint256(_sessionApprovalCount)
        );
    }

    /// @inheritdoc IRecoveryManager
    function hasApproved(bytes32 guardianIdentifier) external view override returns (bool) {
        return _sessionApprovals[guardianIdentifier];
    }

    // ============ Recovery Functions ============

    /// @inheritdoc IRecoveryManager
    function startRecovery(
        EIP712Lib.RecoveryIntent calldata intent,
        uint256 guardianIndex,
        bytes calldata proof
    ) external override {
        // No active session allowed
        if (_sessionIntentHash != bytes32(0)) revert RecoveryAlreadyActive();

        // Validate intent fields
        if (intent.wallet != wallet) revert InvalidIntent();
        if (intent.newOwner == address(0)) revert InvalidIntent();
        if (intent.nonce != nonce) revert InvalidIntent();
        if (intent.chainId != block.chainid) revert InvalidIntent();
        if (intent.recoveryManager != address(this)) revert InvalidIntent();
        if (intent.deadline <= block.timestamp) revert IntentExpired();

        // Compute intent hash
        bytes32 intentHash = EIP712Lib.hashTypedData(intent, address(this));

        // Validate guardian
        if (guardianIndex >= _guardians.length) revert GuardianNotFound();
        GuardianLib.Guardian memory guardian = _guardians[guardianIndex];

        // Verify proof
        _verifyProof(guardian, intentHash, proof);

        // Create session
        _sessionIntentHash = intentHash;
        _sessionNewOwner = intent.newOwner;
        _sessionDeadline = uint64(intent.deadline);
        _sessionApprovalCount = 1;
        _sessionApprovals[guardian.identifier] = true;

        emit RecoveryStarted(intentHash, wallet, intent.newOwner, intent.deadline);
        emit ProofSubmitted(intentHash, guardian.identifier, 1);

        // Check if threshold met immediately (1-of-N case)
        if (uint256(_sessionApprovalCount) >= threshold) {
            _sessionThresholdMetAt = uint64(block.timestamp);
            emit ThresholdMet(intentHash, block.timestamp);
        }
    }

    /// @inheritdoc IRecoveryManager
    function submitProof(uint256 guardianIndex, bytes calldata proof) external override {
        // Must have active session
        if (_sessionIntentHash == bytes32(0)) revert RecoveryNotActive();

        // Check deadline
        if (block.timestamp >= uint256(_sessionDeadline)) revert IntentExpired();

        // Validate guardian
        if (guardianIndex >= _guardians.length) revert GuardianNotFound();
        GuardianLib.Guardian memory guardian = _guardians[guardianIndex];

        // Check not already approved
        if (_sessionApprovals[guardian.identifier]) revert GuardianAlreadyApproved();

        // Verify proof against active session intent hash
        _verifyProof(guardian, _sessionIntentHash, proof);

        // Record approval
        _sessionApprovals[guardian.identifier] = true;
        _sessionApprovalCount++;

        emit ProofSubmitted(_sessionIntentHash, guardian.identifier, uint256(_sessionApprovalCount));

        // Check if threshold newly met
        if (_sessionThresholdMetAt == 0 && uint256(_sessionApprovalCount) >= threshold) {
            _sessionThresholdMetAt = uint64(block.timestamp);
            emit ThresholdMet(_sessionIntentHash, block.timestamp);
        }
    }

    /// @inheritdoc IRecoveryManager
    function executeRecovery() external override {
        // Must have active session
        if (_sessionIntentHash == bytes32(0)) revert RecoveryNotActive();

        // Threshold must be met
        if (_sessionThresholdMetAt == 0) revert ThresholdNotMet();

        // Challenge period must have elapsed
        if (block.timestamp < uint256(_sessionThresholdMetAt) + challengePeriod) {
            revert ChallengePeriodNotElapsed();
        }

        // Deadline must not have passed
        if (block.timestamp >= uint256(_sessionDeadline)) revert IntentExpired();

        // Cache values before clearing (checks-effects-interactions)
        bytes32 intentHash = _sessionIntentHash;
        address newOwner = _sessionNewOwner;

        // Clear session and increment nonce
        _clearSession();
        nonce++;

        // Execute ownership transfer
        IWallet(wallet).setOwner(newOwner);

        emit RecoveryExecuted(intentHash, wallet, newOwner);
    }

    /// @inheritdoc IRecoveryManager
    function cancelRecovery() external override {
        // Must have active session
        if (_sessionIntentHash == bytes32(0)) revert RecoveryNotActive();

        // Only wallet owner can cancel
        if (msg.sender != IWallet(wallet).owner()) revert Unauthorized();

        bytes32 intentHash = _sessionIntentHash;

        // Clear session and increment nonce
        _clearSession();
        nonce++;

        emit RecoveryCancelled(intentHash, wallet);
    }

    // ============ Policy Functions ============

    /// @inheritdoc IRecoveryManager
    function updatePolicy(
        GuardianLib.Guardian[] calldata newGuardians,
        uint256 newThreshold,
        uint256 newChallengePeriod
    ) external override {
        // Only wallet owner
        if (msg.sender != IWallet(wallet).owner()) revert Unauthorized();

        // Increment nonce to invalidate active session + existing proofs
        nonce++;

        _setPolicy(newGuardians, newThreshold, newChallengePeriod);

        emit PolicyUpdated(wallet);
    }

    // ============ Internal Functions ============

    /// @dev Verifies a proof based on guardian type
    function _verifyProof(
        GuardianLib.Guardian memory guardian,
        bytes32 intentHash,
        bytes calldata proof
    ) internal view {
        bool valid;

        if (guardian.guardianType == GuardianLib.GuardianType.EOA) {
            valid = _verifyEoaProof(guardian.identifier, intentHash, proof);
        } else if (guardian.guardianType == GuardianLib.GuardianType.Passkey) {
            valid = passkeyVerifier.verify(guardian.identifier, intentHash, proof);
        } else if (guardian.guardianType == GuardianLib.GuardianType.ZkJWT) {
            valid = zkJwtVerifier.verify(guardian.identifier, intentHash, proof);
        }

        if (!valid) revert InvalidProof();
    }

    /// @dev Verifies an EOA ECDSA signature over the intent hash
    function _verifyEoaProof(
        bytes32 guardianIdentifier,
        bytes32 intentHash,
        bytes calldata proof
    ) internal pure returns (bool) {
        (uint8 v, bytes32 r, bytes32 s) = abi.decode(proof, (uint8, bytes32, bytes32));
        address signer = ecrecover(intentHash, v, r, s);
        return signer != address(0) && signer == GuardianLib.identifierToAddress(guardianIdentifier);
    }

    /// @dev Validates and sets the guardian policy
    function _setPolicy(
        GuardianLib.Guardian[] calldata newGuardians,
        uint256 newThreshold,
        uint256 newChallengePeriod
    ) internal {
        // Validate policy
        if (newGuardians.length == 0 || newGuardians.length > type(uint8).max) revert InvalidPolicy();
        if (newThreshold == 0 || newThreshold > newGuardians.length) revert InvalidPolicy();

        // Validate each guardian and check for duplicates (O(n^2), acceptable for small n)
        for (uint256 i = 0; i < newGuardians.length; i++) {
            if (!GuardianLib.isValidGuardian(newGuardians[i])) revert InvalidPolicy();

            for (uint256 j = 0; j < i; j++) {
                if (newGuardians[i].identifier == newGuardians[j].identifier) revert InvalidPolicy();
            }
        }

        // Clear any active session before replacing guardians
        if (_sessionIntentHash != bytes32(0)) {
            _clearSession();
        }

        // Replace guardians array
        delete _guardians;
        for (uint256 i = 0; i < newGuardians.length; i++) {
            _guardians.push(newGuardians[i]);
        }

        threshold = newThreshold;
        challengePeriod = newChallengePeriod;
    }

    /// @dev Clears the active session state
    function _clearSession() internal {
        // Clear approval mappings for all guardians
        for (uint256 i = 0; i < _guardians.length; i++) {
            delete _sessionApprovals[_guardians[i].identifier];
        }

        // Zero out session fields
        _sessionIntentHash = bytes32(0);
        _sessionNewOwner = address(0);
        _sessionDeadline = 0;
        _sessionThresholdMetAt = 0;
        _sessionApprovalCount = 0;
    }
}
