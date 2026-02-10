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
 * Deterministic deployment address for daimo-eth/p256-verifier used by PasskeyVerifier.sol
 */
export const P256_VERIFIER_ADDRESS: Address = '0xc2b78104907F722DABAc4C69f826a522B2754De4';

/**
 * Default challenge period in seconds (1 day)
 */
export const DEFAULT_CHALLENGE_PERIOD = 86400n;

/**
 * Minimum extra validity window beyond challengePeriod for intent defaults
 */
export const MIN_INTENT_DEADLINE_BUFFER_SECONDS = 300;

/**
 * Default recovery intent deadline.
 * Must be strictly greater than DEFAULT_CHALLENGE_PERIOD to satisfy RecoveryManager.startRecovery.
 */
export const DEFAULT_DEADLINE_SECONDS =
  Number(DEFAULT_CHALLENGE_PERIOD) + MIN_INTENT_DEADLINE_BUFFER_SECONDS;

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
