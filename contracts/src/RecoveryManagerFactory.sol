// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {RecoveryManager} from "./RecoveryManager.sol";
import {GuardianLib} from "./libraries/GuardianLib.sol";

/// @title RecoveryManagerFactory
/// @notice Deploys RecoveryManager proxies using EIP-1167 minimal proxy pattern
/// @dev Shared singleton verifier addresses are passed to each proxy on initialization
contract RecoveryManagerFactory {
    address public immutable implementation;
    address public immutable passkeyVerifier;
    address public immutable zkJwtVerifier;

    mapping(address => address) public getRecoveryManager;

    event RecoveryManagerDeployed(address indexed wallet, address indexed recoveryManager);

    error DeploymentFailed();
    error AlreadyDeployed();

    constructor(address _implementation, address _passkeyVerifier, address _zkJwtVerifier) {
        implementation = _implementation;
        passkeyVerifier = _passkeyVerifier;
        zkJwtVerifier = _zkJwtVerifier;
    }

    /// @notice Deploys a new RecoveryManager proxy for a wallet
    /// @param _wallet The wallet to protect
    /// @param guardians The initial guardian list
    /// @param _threshold The initial threshold (N-of-M)
    /// @param _challengePeriod The initial challenge period in seconds
    /// @return proxy The address of the deployed proxy
    function deployRecoveryManager(
        address _wallet,
        GuardianLib.Guardian[] calldata guardians,
        uint256 _threshold,
        uint256 _challengePeriod
    ) external returns (address proxy) {
        if (getRecoveryManager[_wallet] != address(0)) revert AlreadyDeployed();

        // Deploy EIP-1167 minimal proxy
        proxy = _clone(implementation);

        // Initialize the proxy
        RecoveryManager(proxy).initialize(
            _wallet,
            guardians,
            _threshold,
            _challengePeriod,
            passkeyVerifier,
            zkJwtVerifier
        );

        // Record mapping
        getRecoveryManager[_wallet] = proxy;

        emit RecoveryManagerDeployed(_wallet, proxy);
    }

    /// @dev Deploys an EIP-1167 minimal proxy (45-byte runtime bytecode)
    function _clone(address impl) internal returns (address instance) {
        assembly ("memory-safe") {
            // Store the 45-byte creation code in memory:
            // 3d602d80600a3d3981f3363d3d373d3d3d363d73<impl>5af43d82803e903d91602b57fd5bf3
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(96, impl))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        if (instance == address(0)) revert DeploymentFailed();
    }
}
