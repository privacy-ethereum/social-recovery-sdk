// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Test} from "forge-std/Test.sol";
import {ExampleAAWallet} from "../src/ExampleAAWallet.sol";
import {ExampleAAWalletFactory} from "../src/ExampleAAWalletFactory.sol";

contract ExampleAAWalletTest is Test {
    ExampleAAWallet internal wallet;
    ExampleAAWalletFactory internal factory;

    address internal owner = address(0x1001);
    address internal recoveryManager = address(0x2002);
    address internal recipient = address(0x3003);
    address internal attacker = address(0x4004);

    function setUp() public {
        wallet = new ExampleAAWallet(owner);
        factory = new ExampleAAWalletFactory();
    }

    function test_ownerCanAuthorizeAndRevokeRecoveryManager() public {
        vm.prank(owner);
        wallet.authorizeRecoveryManager(recoveryManager);
        assertTrue(wallet.isRecoveryAuthorized(recoveryManager));

        vm.prank(owner);
        wallet.revokeRecoveryManager(recoveryManager);
        assertFalse(wallet.isRecoveryAuthorized(recoveryManager));
    }

    function test_nonOwnerCannotAuthorizeRecoveryManager() public {
        vm.expectRevert(ExampleAAWallet.Unauthorized.selector);
        vm.prank(attacker);
        wallet.authorizeRecoveryManager(recoveryManager);
    }

    function test_recoveryManagerCanSetOwnerWhenAuthorized() public {
        vm.prank(owner);
        wallet.authorizeRecoveryManager(recoveryManager);

        address newOwner = address(0x5555);
        vm.prank(recoveryManager);
        wallet.setOwner(newOwner);

        assertEq(wallet.owner(), newOwner);
    }

    function test_unauthorizedCannotSetOwner() public {
        vm.expectRevert(ExampleAAWallet.Unauthorized.selector);
        vm.prank(attacker);
        wallet.setOwner(address(0x9999));
    }

    function test_ownerCanExecuteEthTransfer() public {
        vm.deal(address(wallet), 1 ether);
        vm.prank(owner);
        wallet.execute(recipient, 0.25 ether, "");

        assertEq(recipient.balance, 0.25 ether);
        assertEq(address(wallet).balance, 0.75 ether);
    }

    function test_nonOwnerCannotExecute() public {
        vm.expectRevert(ExampleAAWallet.Unauthorized.selector);
        vm.prank(attacker);
        wallet.execute(recipient, 0, "");
    }

    function test_factoryCreatesWalletAndTracksOwner() public {
        address walletAddress = factory.createWallet(owner);
        ExampleAAWallet deployed = ExampleAAWallet(payable(walletAddress));

        assertEq(deployed.owner(), owner);
        address[] memory wallets = factory.getWallets(owner);
        assertEq(wallets.length, 1);
        assertEq(wallets[0], walletAddress);
    }

    function test_ownerCanRemoveWalletFromFactoryIndex() public {
        address walletAddress = factory.createWallet(owner);
        address secondWalletAddress = factory.createWallet(owner);

        vm.prank(owner);
        factory.removeWallet(walletAddress);

        address[] memory wallets = factory.getWallets(owner);
        assertEq(wallets.length, 1);
        assertEq(wallets[0], secondWalletAddress);
    }

    function test_removeWalletRevertsWhenWalletMissing() public {
        vm.prank(owner);
        vm.expectRevert(ExampleAAWalletFactory.WalletNotFound.selector);
        factory.removeWallet(address(0x9999));
    }
}
