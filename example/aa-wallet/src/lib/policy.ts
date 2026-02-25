import { GuardianType, PolicyBuilder, type P256PublicKey } from '@pse/social-recovery-sdk';
import { getAddress, type Address } from 'viem';

export type GuardianKind = 'eoa' | 'passkey' | 'zkjwt';

export interface GuardianPolicyEntry {
  type: GuardianKind;
  address?: string;
  passkeyPublicKey?: P256PublicKey;
  zkjwtCommitment?: `0x${string}`;
}

export interface GuardianPolicyInput {
  wallet: Address;
  guardians: GuardianPolicyEntry[];
  threshold: bigint;
  challengePeriod: bigint;
}

export function normalizeGuardianAddresses(addresses: string[]): Address[] {
  const unique = new Set<string>();
  const guardians: Address[] = [];
  for (const raw of addresses) {
    if (!raw.trim()) {
      continue;
    }
    const normalized = getAddress(raw);
    if (unique.has(normalized.toLowerCase())) {
      continue;
    }
    unique.add(normalized.toLowerCase());
    guardians.push(normalized);
  }

  return guardians;
}

export function toGuardianTypeLabel(guardianType: number): string {
  if (guardianType === GuardianType.EOA) {
    return 'EOA';
  }
  if (guardianType === GuardianType.Passkey) {
    return 'Passkey';
  }
  if (guardianType === GuardianType.ZkJWT) {
    return 'ZK JWT';
  }
  return `Unknown (${guardianType})`;
}

export function buildGuardianPolicy(input: GuardianPolicyInput) {
  const builder = new PolicyBuilder()
    .setWallet(input.wallet)
    .setThreshold(input.threshold)
    .setChallengePeriod(input.challengePeriod);

  for (const guardian of input.guardians) {
    if (guardian.type === 'eoa') {
      if (!guardian.address || !guardian.address.trim()) {
        continue;
      }
      builder.addEoaGuardian(getAddress(guardian.address));
      continue;
    }

    if (guardian.type === 'passkey') {
      if (!guardian.passkeyPublicKey) {
        continue;
      }
      builder.addPasskeyGuardian(guardian.passkeyPublicKey);
      continue;
    }

    if (guardian.type === 'zkjwt') {
      if (!guardian.zkjwtCommitment) {
        continue;
      }
      builder.addZkJwtGuardian(guardian.zkjwtCommitment);
    }
  }

  return builder.build();
}
