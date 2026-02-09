// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IWallet} from "../interfaces/IWallet.sol";

/// @notice Minimal wallet used for SDK-to-contract end-to-end testing.
/// @dev Supports owner-managed authorization for RecoveryManager instances.
contract MockRecoveryWallet is IWallet {
    error Unauthorized();
    error ZeroOwner();

    address public override owner;
    mapping(address => bool) private _recoveryAuthorized;

    event RecoveryAuthorizationUpdated(address indexed account, bool authorized);

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroOwner();
        owner = initialOwner;
    }

    function setOwner(address newOwner) external override {
        if (msg.sender != owner && !_recoveryAuthorized[msg.sender]) revert Unauthorized();
        if (newOwner == address(0)) revert ZeroOwner();
        owner = newOwner;
    }

    function authorizeRecoveryManager(address account) external {
        if (msg.sender != owner) revert Unauthorized();
        _recoveryAuthorized[account] = true;
        emit RecoveryAuthorizationUpdated(account, true);
    }

    function revokeRecoveryManager(address account) external {
        if (msg.sender != owner) revert Unauthorized();
        delete _recoveryAuthorized[account];
        emit RecoveryAuthorizationUpdated(account, false);
    }

    function isRecoveryAuthorized(address account) external view override returns (bool) {
        return _recoveryAuthorized[account];
    }
}
