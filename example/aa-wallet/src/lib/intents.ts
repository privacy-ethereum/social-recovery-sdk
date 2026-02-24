import type { RecoveryIntent } from '@pse/social-recovery-sdk';
import type { Address } from 'viem';

export interface BuildIntentParams {
  wallet: Address;
  newOwner: Address;
  recoveryManager: Address;
  nonce: bigint;
  chainId: bigint;
  challengePeriodSeconds: bigint;
  deadlineSeconds: number;
  nowSeconds?: bigint;
}

export function buildIntent(params: BuildIntentParams): RecoveryIntent {
  if (!Number.isInteger(params.deadlineSeconds) || params.deadlineSeconds <= 0) {
    throw new Error('Deadline seconds must be a positive integer');
  }

  const deadlineWindow = BigInt(params.deadlineSeconds);
  if (deadlineWindow <= params.challengePeriodSeconds) {
    throw new Error('Deadline seconds must be greater than challenge period');
  }

  const baseNowSeconds = params.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  const deadline = baseNowSeconds + deadlineWindow;

  return {
    wallet: params.wallet,
    newOwner: params.newOwner,
    recoveryManager: params.recoveryManager,
    nonce: params.nonce,
    chainId: params.chainId,
    deadline,
  };
}
