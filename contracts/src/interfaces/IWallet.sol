// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title IWallet
/// @notice Interface that wallets must implement for social recovery compatibility
/// @dev Wallets integrate by implementing this interface and authorizing their RecoveryManager
interface IWallet {
    /// @notice Returns the current owner of the wallet
    /// @return The owner's address
    function owner() external view returns (address);

    /// @notice Sets a new owner for the wallet
    /// @dev Only callable by authorized entities (owner or authorized RecoveryManager)
    /// @param newOwner The address of the new owner
    function setOwner(address newOwner) external;

    /// @notice Checks if an address is authorized to execute recovery operations
    /// @param account The address to check
    /// @return True if the account is authorized for recovery
    function isRecoveryAuthorized(address account) external view returns (bool);
}
