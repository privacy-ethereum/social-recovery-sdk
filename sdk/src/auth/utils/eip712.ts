import { hashTypedData } from 'viem';
import type { Address, Hex } from 'viem';
import type { RecoveryIntent } from '../../types';
import {
  EIP712_DOMAIN,
  RECOVERY_INTENT_TYPES,
  DEFAULT_DEADLINE_SECONDS,
  MIN_INTENT_DEADLINE_BUFFER_SECONDS,
} from '../../constants';

function parseNonNegativeSafeInteger(value: number | bigint, fieldName: string): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${fieldName} must be a non-negative safe integer`);
    }
    return value;
  }

  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${fieldName} must fit in a non-negative safe integer`);
  }
  return Number(value);
}

function parseValidationSeconds(value: number | bigint): bigint | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      return null;
    }
    return BigInt(value);
  }

  if (value < 0n) {
    return null;
  }
  return value;
}

/**
 * Computes the EIP-712 typed data hash for a RecoveryIntent
 * This hash is what guardians sign/prove over
 *
 * @param intent The recovery intent
 * @returns The typed data hash (bytes32)
 */
export function hashRecoveryIntent(intent: RecoveryIntent): Hex {
  return hashTypedData({
    domain: {
      name: EIP712_DOMAIN.name,
      version: EIP712_DOMAIN.version,
      chainId: intent.chainId,
      verifyingContract: intent.recoveryManager,
    },
    types: RECOVERY_INTENT_TYPES,
    primaryType: 'RecoveryIntent',
    message: {
      wallet: intent.wallet,
      newOwner: intent.newOwner,
      nonce: intent.nonce,
      deadline: intent.deadline,
      chainId: intent.chainId,
      recoveryManager: intent.recoveryManager,
    },
  });
}

/**
 * Parameters for creating a recovery intent
 */
export interface CreateRecoveryIntentParams {
  /** The wallet being recovered */
  wallet: Address;
  /** The proposed new owner */
  newOwner: Address;
  /** The RecoveryManager contract address */
  recoveryManager: Address;
  /** The current nonce from the RecoveryManager */
  nonce: bigint;
  /** The chain ID */
  chainId: bigint;
  /** Deadline in seconds from now (defaults to safe SDK default) */
  deadlineSeconds?: number;
  /** Optional challenge period in seconds used to enforce a safe deadline */
  challengePeriodSeconds?: number | bigint;
}

export interface IntentValidationOptions {
  /**
   * Optional current timestamp in seconds.
   * If omitted, local system time is used.
   */
  nowSeconds?: bigint;
  /**
   * Optional expected RecoveryManager address.
   * If set, the intent must target this exact contract.
   */
  expectedRecoveryManager?: Address;
  /**
   * Optional challenge period in seconds.
   * If set, requires deadline > now + challengePeriod.
   */
  challengePeriodSeconds?: number | bigint;
}

/**
 * Creates a RecoveryIntent with common defaults
 *
 * @param params Partial intent parameters
 * @returns Complete RecoveryIntent ready for signing
 */
export function createRecoveryIntent(params: CreateRecoveryIntentParams): RecoveryIntent {
  const challengePeriodSeconds =
    params.challengePeriodSeconds === undefined
      ? undefined
      : parseNonNegativeSafeInteger(params.challengePeriodSeconds, 'challengePeriodSeconds');

  const minSafeDeadlineSeconds =
    challengePeriodSeconds === undefined
      ? 0
      : challengePeriodSeconds + MIN_INTENT_DEADLINE_BUFFER_SECONDS;
  const deadlineSeconds = params.deadlineSeconds ?? Math.max(DEFAULT_DEADLINE_SECONDS, minSafeDeadlineSeconds);

  if (!Number.isSafeInteger(deadlineSeconds) || deadlineSeconds <= 0) {
    throw new Error('deadlineSeconds must be a positive safe integer');
  }

  if (challengePeriodSeconds !== undefined && deadlineSeconds <= challengePeriodSeconds) {
    throw new Error('deadlineSeconds must be greater than challengePeriodSeconds');
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

  return {
    wallet: params.wallet,
    newOwner: params.newOwner,
    nonce: params.nonce,
    deadline,
    chainId: params.chainId,
    recoveryManager: params.recoveryManager,
  };
}

/**
 * Validates a recovery intent
 *
 * @param intent The intent to validate
 * @returns True if the intent is valid
 */
export function isValidIntent(intent: RecoveryIntent, options: IntentValidationOptions = {}): boolean {
  // Check addresses are not zero
  if (intent.wallet === '0x0000000000000000000000000000000000000000') {
    return false;
  }
  if (intent.newOwner === '0x0000000000000000000000000000000000000000') {
    return false;
  }
  if (intent.recoveryManager === '0x0000000000000000000000000000000000000000') {
    return false;
  }
  if (
    options.expectedRecoveryManager &&
    intent.recoveryManager.toLowerCase() !== options.expectedRecoveryManager.toLowerCase()
  ) {
    return false;
  }

  // Check deadline is in the future
  const now = options.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  if (intent.deadline <= now) {
    return false;
  }
  if (options.challengePeriodSeconds !== undefined) {
    const challengePeriod = parseValidationSeconds(options.challengePeriodSeconds);
    if (challengePeriod === null) {
      return false;
    }
    if (intent.deadline <= now + challengePeriod) {
      return false;
    }
  }

  // Check chain ID is valid
  if (intent.chainId === 0n) {
    return false;
  }

  return true;
}
