// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {GuardianLib} from "../libraries/GuardianLib.sol";
import {EIP712Lib} from "../libraries/EIP712Lib.sol";

/// @title IRecoveryManager
/// @notice Interface for the RecoveryManager contract
/// @dev One RecoveryManager is deployed per wallet via the factory
interface IRecoveryManager {
    // ============ Events ============

    /// @notice Emitted when a recovery session is started
    /// @param intentHash The EIP-712 hash of the recovery intent
    /// @param wallet The wallet being recovered
    /// @param newOwner The proposed new owner
    /// @param deadline The deadline for the recovery
    event RecoveryStarted(
        bytes32 indexed intentHash,
        address indexed wallet,
        address newOwner,
        uint256 deadline
    );

    /// @notice Emitted when a guardian submits a valid proof
    /// @param intentHash The recovery intent hash
    /// @param guardianIdentifier The guardian who approved
    /// @param approvalCount The total number of approvals after this submission
    event ProofSubmitted(
        bytes32 indexed intentHash,
        bytes32 indexed guardianIdentifier,
        uint256 approvalCount
    );

    /// @notice Emitted when the threshold is met
    /// @param intentHash The recovery intent hash
    /// @param thresholdMetAt The timestamp when threshold was met
    event ThresholdMet(bytes32 indexed intentHash, uint256 thresholdMetAt);

    /// @notice Emitted when recovery is executed successfully
    /// @param intentHash The recovery intent hash
    /// @param wallet The wallet that was recovered
    /// @param newOwner The new owner that was set
    event RecoveryExecuted(
        bytes32 indexed intentHash,
        address indexed wallet,
        address newOwner
    );

    /// @notice Emitted when recovery is cancelled by the owner
    /// @param intentHash The recovery intent hash
    /// @param wallet The wallet
    event RecoveryCancelled(bytes32 indexed intentHash, address indexed wallet);

    /// @notice Emitted when the policy is updated
    /// @param wallet The wallet whose policy was updated
    event PolicyUpdated(address indexed wallet);

    // ============ Errors ============

    /// @notice The recovery intent is invalid (wrong wallet, expired, etc.)
    error InvalidIntent();

    /// @notice No recovery session is currently active
    error RecoveryNotActive();

    /// @notice A recovery session is already active
    error RecoveryAlreadyActive();

    /// @notice The recovery intent has expired
    error IntentExpired();

    /// @notice The challenge period has not elapsed yet
    error ChallengePeriodNotElapsed();

    /// @notice The guardian has already approved this recovery
    error GuardianAlreadyApproved();

    /// @notice The proof is invalid
    error InvalidProof();

    /// @notice The threshold has not been met yet
    error ThresholdNotMet();

    /// @notice The caller is not authorized for this operation
    error Unauthorized();

    /// @notice The policy configuration is invalid
    error InvalidPolicy();

    /// @notice The guardian is not in the policy
    error GuardianNotFound();

    // ============ View Functions ============

    /// @notice Returns the wallet this RecoveryManager protects
    function wallet() external view returns (address);

    /// @notice Returns the current threshold (N in N-of-M)
    function threshold() external view returns (uint256);

    /// @notice Returns the challenge period in seconds
    function challengePeriod() external view returns (uint256);

    /// @notice Returns the current nonce (increments on session completion/cancellation)
    function nonce() external view returns (uint256);

    /// @notice Returns the number of guardians
    function guardianCount() external view returns (uint256);

    /// @notice Returns a guardian by index
    /// @param index The index of the guardian
    /// @return The guardian configuration
    function getGuardian(uint256 index) external view returns (GuardianLib.Guardian memory);

    /// @notice Returns whether a recovery session is currently active
    function isRecoveryActive() external view returns (bool);

    /// @notice Returns the active session state
    /// @return intentHash The EIP-712 hash of the recovery intent
    /// @return newOwner The proposed new owner
    /// @return deadline The deadline for the recovery
    /// @return thresholdMetAt Timestamp when threshold was met (0 if not yet)
    /// @return approvalCount Number of guardian approvals
    function getSession()
        external
        view
        returns (
            bytes32 intentHash,
            address newOwner,
            uint256 deadline,
            uint256 thresholdMetAt,
            uint256 approvalCount
        );

    /// @notice Checks if a guardian has approved the current recovery
    /// @param guardianIdentifier The guardian's identifier
    /// @return True if the guardian has approved
    function hasApproved(bytes32 guardianIdentifier) external view returns (bool);

    // ============ Recovery Functions ============

    /// @notice Starts a new recovery session with the first guardian proof
    /// @dev Only callable when no session is active. The caller must provide a valid proof.
    /// @param intent The recovery intent
    /// @param guardianIndex The index of the guardian in the policy
    /// @param proof The encoded proof (format depends on guardian type)
    function startRecovery(
        EIP712Lib.RecoveryIntent calldata intent,
        uint256 guardianIndex,
        bytes calldata proof
    ) external;

    /// @notice Submits a guardian proof for the active recovery
    /// @dev The proof must be for the active session's intent hash
    /// @param guardianIndex The index of the guardian in the policy
    /// @param proof The encoded proof
    function submitProof(uint256 guardianIndex, bytes calldata proof) external;

    /// @notice Executes the recovery after the challenge period
    /// @dev Anyone can call this once threshold is met and challenge period elapsed
    function executeRecovery() external;

    /// @notice Cancels the active recovery session
    /// @dev Only callable by the wallet owner while a session is active
    function cancelRecovery() external;

    // ============ Policy Functions ============

    /// @notice Updates the recovery policy
    /// @dev Only callable by the wallet owner. Invalidates any active session.
    /// @param newGuardians The new list of guardians
    /// @param newThreshold The new threshold (must be <= guardian count)
    /// @param newChallengePeriod The new challenge period in seconds
    function updatePolicy(
        GuardianLib.Guardian[] calldata newGuardians,
        uint256 newThreshold,
        uint256 newChallengePeriod
    ) external;
}
