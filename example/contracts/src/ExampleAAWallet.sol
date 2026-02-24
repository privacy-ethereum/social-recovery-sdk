// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// @title ExampleAAWallet
/// @notice Minimal wallet contract for local demos with social recovery compatibility.
/// @dev Demo-only contract, not production hardened.
contract ExampleAAWallet {
    error Unauthorized();
    error ZeroAddress();
    error CallFailed();
    error LengthMismatch();

    address public owner;
    mapping(address => bool) private _recoveryAuthorized;

    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
    event RecoveryAuthorizationUpdated(address indexed account, bool authorized);
    event Executed(address indexed target, uint256 value, bytes data, bytes result);

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
    }

    receive() external payable {}

    /// @notice Social recovery compatibility method.
    function setOwner(address newOwner) external {
        if (msg.sender != owner && !_recoveryAuthorized[msg.sender]) revert Unauthorized();
        if (newOwner == address(0)) revert ZeroAddress();

        address previousOwner = owner;
        owner = newOwner;
        emit OwnerUpdated(previousOwner, newOwner);
    }

    function authorizeRecoveryManager(address account) external {
        if (msg.sender != owner) revert Unauthorized();
        if (account == address(0)) revert ZeroAddress();

        _recoveryAuthorized[account] = true;
        emit RecoveryAuthorizationUpdated(account, true);
    }

    function revokeRecoveryManager(address account) external {
        if (msg.sender != owner) revert Unauthorized();

        delete _recoveryAuthorized[account];
        emit RecoveryAuthorizationUpdated(account, false);
    }

    /// @notice Social recovery compatibility method.
    function isRecoveryAuthorized(address account) external view returns (bool) {
        return _recoveryAuthorized[account];
    }

    function execute(address target, uint256 value, bytes calldata data) external returns (bytes memory result) {
        if (msg.sender != owner) revert Unauthorized();
        if (target == address(0)) revert ZeroAddress();

        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) revert CallFailed();

        emit Executed(target, value, data, ret);
        return ret;
    }

    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata data
    ) external returns (bytes[] memory results) {
        if (msg.sender != owner) revert Unauthorized();
        if (targets.length != values.length || targets.length != data.length) revert LengthMismatch();

        results = new bytes[](targets.length);
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) revert ZeroAddress();

            (bool ok, bytes memory ret) = targets[i].call{value: values[i]}(data[i]);
            if (!ok) revert CallFailed();
            results[i] = ret;
            emit Executed(targets[i], values[i], data[i], ret);
        }
    }
}
