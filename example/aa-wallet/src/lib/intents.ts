import { createRecoveryIntent, type RecoveryIntent } from '@pse/social-recovery-sdk';
import type { Address } from 'viem';

export interface BuildIntentParams {
  wallet: Address;
  newOwner: Address;
  recoveryManager: Address;
  nonce: bigint;
  chainId: bigint;
  challengePeriodSeconds: bigint;
  deadlineSeconds: number;
}

export function buildIntent(params: BuildIntentParams): RecoveryIntent {
  return createRecoveryIntent({
    wallet: params.wallet,
    newOwner: params.newOwner,
    recoveryManager: params.recoveryManager,
    nonce: params.nonce,
    chainId: params.chainId,
    challengePeriodSeconds: params.challengePeriodSeconds,
    deadlineSeconds: params.deadlineSeconds,
  });
}
