import { GuardianType, PolicyBuilder } from '@pse/social-recovery-sdk';
import { getAddress, type Address } from 'viem';

export type GuardianKind = 'eoa' | 'passkey' | 'zkjwt';

export interface EoaPolicyInput {
  wallet: Address;
  guardians: Address[];
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

export function buildEoaPolicy(input: EoaPolicyInput) {
  const builder = new PolicyBuilder()
    .setWallet(input.wallet)
    .setThreshold(input.threshold)
    .setChallengePeriod(input.challengePeriod);

  for (const guardian of input.guardians) {
    builder.addEoaGuardian(guardian);
  }

  return builder.build();
}
