import type { Address } from 'viem';

/**
 * EIP-712 domain parameters
 * Must match contracts/src/libraries/EIP712Lib.sol
 */
export const EIP712_DOMAIN = {
  name: 'SocialRecovery',
  version: '1',
} as const;

/**
 * RecoveryIntent EIP-712 type definition
 * Used with viem's hashTypedData
 */
export const RECOVERY_INTENT_TYPES = {
  RecoveryIntent: [
    { name: 'wallet', type: 'address' },
    { name: 'newOwner', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'chainId', type: 'uint256' },
    { name: 'recoveryManager', type: 'address' },
  ],
} as const;

/**
 * RIP-7212 P256 precompile address
 * Available on some chains for efficient P-256 verification
 */
export const P256_PRECOMPILE_ADDRESS: Address = '0x0000000000000000000000000000000000000100';

/**
 * Default challenge period in seconds (1 day)
 */
export const DEFAULT_CHALLENGE_PERIOD = 86400n;

/**
 * Default recovery intent deadline (24 hours from now)
 */
export const DEFAULT_DEADLINE_SECONDS = 86400;

/**
 * Deployed verifier addresses per chain
 * Populated after deployment
 */
export const VERIFIER_ADDRESSES: Record<
  number,
  {
    passkey: Address;
    zkJwt: Address;
  }
> = {
  // Mainnet (1)
  // 1: {
  //   passkey: '0x...',
  //   zkJwt: '0x...',
  // },

  // Sepolia (11155111)
  // 11155111: {
  //   passkey: '0x...',
  //   zkJwt: '0x...',
  // },
};

/**
 * Factory addresses per chain
 * Populated after deployment
 */
export const FACTORY_ADDRESSES: Record<number, Address> = {
  // Mainnet (1)
  // 1: '0x...',

  // Sepolia (11155111)
  // 11155111: '0x...',
};
