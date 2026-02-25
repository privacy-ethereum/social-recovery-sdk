import {
  EoaAdapter,
  PasskeyAdapter,
  RecoveryClient,
  RecoveryManagerFactoryAbi,
  ZkJwtAdapter,
  type P256PublicKey,
  type RecoveryPolicy,
  type RecoverySession,
} from '@pse/social-recovery-sdk';
import { isAddress, type Address } from 'viem';
import { getPublicClient, getWalletClient } from './chain';
import { DEPLOYMENT, ZERO_ADDRESS } from './contracts';

export type RecoveryPortalState =
  | 'not-configured'
  | 'ready'
  | 'collecting-approvals'
  | 'challenge-period'
  | 'executable'
  | 'executed'
  | 'cancelled'
  | 'expired';

export interface RecoverySnapshot {
  recoveryManager: Address;
  policy: RecoveryPolicy;
  session: RecoverySession;
  isActive: boolean;
  isReadyToExecute: boolean;
  status: RecoveryPortalState;
}

export type AppPublicClient = ReturnType<typeof getPublicClient>;
export type AppWalletClient = ReturnType<typeof getWalletClient>;

export function createRecoveryClient(params: {
  publicClient: AppPublicClient;
  walletClient?: AppWalletClient;
  recoveryManagerAddress?: Address;
}) {
  return new RecoveryClient({
    publicClient: params.publicClient as never,
    walletClient: params.walletClient as never,
    factoryAddress: DEPLOYMENT.contracts.recoveryManagerFactory,
    recoveryManagerAddress: params.recoveryManagerAddress,
  });
}

export function createEoaAdapter(walletClient: AppWalletClient) {
  return new EoaAdapter({ walletClient: walletClient as never });
}

export function createPasskeyAdapter(config: {
  rpId: string;
  credentialId: `0x${string}`;
  publicKey: P256PublicKey;
}) {
  return new PasskeyAdapter({
    rpId: config.rpId,
    credentialId: config.credentialId,
    publicKey: config.publicKey,
  });
}

export function createZkJwtAdapter(config: { jwt: string; salt: bigint }) {
  return new ZkJwtAdapter({
    jwt: config.jwt,
    salt: config.salt,
  });
}

export async function lookupRecoveryManager(publicClient: AppPublicClient, walletAddress: Address): Promise<Address> {
  if (!isAddress(walletAddress)) {
    throw new Error('Invalid wallet address');
  }

  return publicClient.readContract({
    address: DEPLOYMENT.contracts.recoveryManagerFactory,
    abi: RecoveryManagerFactoryAbi,
    functionName: 'getRecoveryManager',
    args: [walletAddress],
  });
}

export async function loadRecoverySnapshot(params: {
  publicClient: AppPublicClient;
  walletAddress: Address;
  recoveryManagerAddress?: Address;
}): Promise<RecoverySnapshot | null> {
  const recoveryManager =
    params.recoveryManagerAddress ?? (await lookupRecoveryManager(params.publicClient, params.walletAddress));

  if (recoveryManager.toLowerCase() === ZERO_ADDRESS) {
    return null;
  }

  const client = createRecoveryClient({
    publicClient: params.publicClient,
    recoveryManagerAddress: recoveryManager,
  });

  const [policy, session, isActive, isReadyToExecute, block] = await Promise.all([
    client.getPolicy(),
    client.getSession(),
    client.isRecoveryActive(),
    client.isReadyToExecute(),
    params.publicClient.getBlock({ blockTag: 'latest' }),
  ]);

  let status: RecoveryPortalState = 'ready';

  if (!isActive) {
    if (session.intentHash !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      status = 'executed';
    } else {
      status = 'ready';
    }
  } else {
    if (block.timestamp >= session.deadline) {
      status = 'expired';
    } else if (isReadyToExecute) {
      status = 'executable';
    } else if (session.thresholdMetAt > 0n) {
      status = 'challenge-period';
    } else {
      status = 'collecting-approvals';
    }
  }

  return {
    recoveryManager,
    policy,
    session,
    isActive,
    isReadyToExecute,
    status,
  };
}
