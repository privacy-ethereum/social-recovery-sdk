// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {ExampleAAWallet} from "./ExampleAAWallet.sol";

/// @title ExampleAAWalletFactory
/// @notice Deploys ExampleAAWallet instances for local demo UX.
contract ExampleAAWalletFactory {
    error ZeroAddress();
    error WalletNotFound();

    mapping(address => address[]) private _walletsByOwner;

    event WalletDeployed(address indexed owner, address indexed wallet);
    event WalletRemoved(address indexed owner, address indexed wallet);

    function createWallet(address initialOwner) external returns (address wallet) {
        if (initialOwner == address(0)) revert ZeroAddress();

        wallet = address(new ExampleAAWallet(initialOwner));
        _walletsByOwner[initialOwner].push(wallet);

        emit WalletDeployed(initialOwner, wallet);
    }

    function getWallets(address owner) external view returns (address[] memory) {
        return _walletsByOwner[owner];
    }

    /// @notice Removes a wallet from the sender's tracked list.
    /// @dev This only updates factory indexing metadata. It does not destroy the wallet contract.
    function removeWallet(address wallet) external {
        address[] storage wallets = _walletsByOwner[msg.sender];
        uint256 length = wallets.length;

        for (uint256 i = 0; i < length; i++) {
            if (wallets[i] == wallet) {
                wallets[i] = wallets[length - 1];
                wallets.pop();
                emit WalletRemoved(msg.sender, wallet);
                return;
            }
        }

        revert WalletNotFound();
    }
}
