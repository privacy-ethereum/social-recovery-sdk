import { pad, encodePacked, keccak256 } from 'viem';
import type { Address, Hex } from 'viem';
import { GuardianType, type Guardian, type RecoveryPolicy, type P256PublicKey } from '../types';
import { DEFAULT_CHALLENGE_PERIOD } from '../constants';

export class PolicyBuilder {
  private _wallet: Address | null = null;
  private _threshold: bigint = 0n;
  private _challengePeriod: bigint = DEFAULT_CHALLENGE_PERIOD;
  private _guardians: Guardian[] = [];

  setWallet(wallet: Address): this {
    this._wallet = wallet;
    return this;
  }

  setThreshold(threshold: number | bigint): this {
    this._threshold = BigInt(threshold);
    return this;
  }

  setChallengePeriod(seconds: number | bigint): this {
    this._challengePeriod = BigInt(seconds);
    return this;
  }

  addEoaGuardian(address: Address): this {
    this._guardians.push({
      guardianType: GuardianType.EOA,
      identifier: pad(address, { size: 32 }) as Hex,
    });
    return this;
  }

  addPasskeyGuardian(publicKey: P256PublicKey): this {
    this._guardians.push({
      guardianType: GuardianType.Passkey,
      identifier: keccak256(encodePacked(['uint256', 'uint256'], [publicKey.x, publicKey.y])),
    });
    return this;
  }

  addZkJwtGuardian(commitment: Hex): this {
    this._guardians.push({
      guardianType: GuardianType.ZkJWT,
      identifier: commitment,
    });
    return this;
  }

  build(): RecoveryPolicy {
    if (!this._wallet) {
      throw new Error('Wallet address is required');
    }
    if (this._guardians.length === 0) {
      throw new Error('At least one guardian is required');
    }
    if (this._threshold === 0n) {
      throw new Error('Threshold must be greater than 0');
    }
    if (this._threshold > BigInt(this._guardians.length)) {
      throw new Error('Threshold cannot exceed number of guardians');
    }

    const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
    for (let i = 0; i < this._guardians.length; i++) {
      if (this._guardians[i].identifier === ZERO_BYTES32) {
        throw new Error(`Guardian at index ${i} has a zero identifier`);
      }
      for (let j = 0; j < i; j++) {
        if (this._guardians[i].identifier === this._guardians[j].identifier) {
          throw new Error(`Duplicate guardian identifier at indices ${j} and ${i}`);
        }
      }
    }

    return {
      wallet: this._wallet,
      threshold: this._threshold,
      challengePeriod: this._challengePeriod,
      guardians: [...this._guardians],
    };
  }
}
