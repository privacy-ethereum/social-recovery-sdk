import type { Address, Hex } from 'viem';

/**
 * Guardian authentication types (mirrors Solidity enum)
 * @see contracts/src/libraries/GuardianLib.sol
 */
export enum GuardianType {
  EOA = 0,
  Passkey = 1,
  ZkJWT = 2,
}

/**
 * Guardian configuration stored on-chain
 */
export interface Guardian {
  guardianType: GuardianType;
  /** bytes32 identifier - encoding depends on guardianType */
  identifier: Hex;
}

/**
 * Recovery intent structure (EIP-712 typed data)
 * All guardian proofs are bound to this structure for replay protection
 */
export interface RecoveryIntent {
  /** The wallet being recovered */
  wallet: Address;
  /** The proposed new owner address */
  newOwner: Address;
  /** The current nonce of the RecoveryManager (prevents replay) */
  nonce: bigint;
  /** Unix timestamp after which the intent expires */
  deadline: bigint;
  /** The chain ID (prevents cross-chain replay) */
  chainId: bigint;
  /** The RecoveryManager contract address (prevents cross-contract replay) */
  recoveryManager: Address;
}

/**
 * P-256 public key coordinates
 */
export interface P256PublicKey {
  x: bigint;
  y: bigint;
}

/**
 * WebAuthn credential for passkey guardians
 */
export interface PasskeyCredential {
  /** The credential ID returned by WebAuthn registration */
  credentialId: Hex;
  /** The P-256 public key */
  publicKey: P256PublicKey;
}

/**
 * Passkey proof structure for contract submission
 * @see contracts/src/verifiers/PasskeyVerifier.sol
 */
export interface PasskeyProof {
  /** WebAuthn authenticator data */
  authenticatorData: Hex;
  /** WebAuthn client data JSON string */
  clientDataJSON: string;
  /** Index where "challenge" property starts in clientDataJSON */
  challengeIndex: bigint;
  /** Index where "type" property starts in clientDataJSON */
  typeIndex: bigint;
  /** P-256 signature r component */
  r: bigint;
  /** P-256 signature s component */
  s: bigint;
  /** P-256 public key X coordinate */
  pubKeyX: bigint;
  /** P-256 public key Y coordinate */
  pubKeyY: bigint;
}

/**
 * Generic proof wrapper for contract submission
 */
export interface GuardianProof {
  /** The guardian's identifier */
  guardianIdentifier: Hex;
  /** The guardian's authentication type */
  guardianType: GuardianType;
  /** ABI-encoded proof data */
  proof: Hex;
}

/**
 * Recovery session state from the contract
 */
export interface RecoverySession {
  /** The EIP-712 hash of the recovery intent */
  intentHash: Hex;
  /** The proposed new owner */
  newOwner: Address;
  /** The deadline for the recovery */
  deadline: bigint;
  /** Timestamp when threshold was met (0 if not yet) */
  thresholdMetAt: bigint;
  /** Number of guardian approvals */
  approvalCount: bigint;
}

/**
 * Recovery policy configuration
 */
export interface RecoveryPolicy {
  /** The wallet being protected */
  wallet: Address;
  /** Number of guardian approvals required */
  threshold: bigint;
  /** Seconds after threshold is met before execution allowed */
  challengePeriod: bigint;
  /** List of guardians */
  guardians: Guardian[];
}
