import { parseAbi, getAddress, type Address, type Hex } from 'viem';
import localAddresses from '../config/local-addresses.json';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export interface LocalAddressConfig {
  chainId: number;
  rpcUrl: string;
  deployer: Address;
  generatedAt: string;
  contracts: {
    passkeyVerifier: Address;
    honkVerifier: Address;
    zkJwtVerifier: Address;
    recoveryManagerImplementation: Address;
    recoveryManagerFactory: Address;
    exampleWalletFactory: Address;
  };
}

export const DEPLOYMENT = localAddresses as LocalAddressConfig;

export function isConfiguredAddress(address: Address): boolean {
  return address.toLowerCase() !== ZERO_ADDRESS;
}

export const ExampleAAWalletAbi = parseAbi([
  'function owner() view returns (address)',
  'function setOwner(address newOwner)',
  'function authorizeRecoveryManager(address account)',
  'function revokeRecoveryManager(address account)',
  'function isRecoveryAuthorized(address account) view returns (bool)',
  'function execute(address target, uint256 value, bytes data) returns (bytes)',
  'function executeBatch(address[] targets, uint256[] values, bytes[] data) returns (bytes[])',
  'event OwnerUpdated(address indexed previousOwner, address indexed newOwner)',
  'event RecoveryAuthorizationUpdated(address indexed account, bool authorized)',
  'event Executed(address indexed target, uint256 value, bytes data, bytes result)',
]);

export const ExampleAAWalletFactoryAbi = parseAbi([
  'function createWallet(address initialOwner) returns (address wallet)',
  'function removeWallet(address wallet)',
  'function getWallets(address owner) view returns (address[] wallets)',
  'event WalletDeployed(address indexed owner, address indexed wallet)',
  'event WalletRemoved(address indexed owner, address indexed wallet)',
]);

export function bytes32ToAddress(bytes32: Hex): Address {
  return getAddress(`0x${bytes32.slice(-40)}`);
}
