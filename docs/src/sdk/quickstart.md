# SDK Quickstart

## 1. Install and import

```ts
import {
  RecoveryClient,
  PolicyBuilder,
  EoaAdapter,
  createRecoveryIntent,
} from '@pse/social-recovery-sdk';
```

## 2. Deploy per-wallet RecoveryManager

```ts
const ownerClient = new RecoveryClient({
  publicClient,
  walletClient: ownerWalletClient,
  factoryAddress,
});

const policy = new PolicyBuilder()
  .setWallet(walletAddress)
  .addEoaGuardian(guardian1Address)
  .addEoaGuardian(guardian2Address)
  .setThreshold(2)
  .setChallengePeriod(600)
  .build();

const recoveryManagerAddress = await ownerClient.deployRecoveryManager(policy);
```

## 3. Authorize RecoveryManager in wallet

Your wallet contract must authorize this recovery manager to call `setOwner`.

## 4. Create intent from live chain state

```ts
const guardianClient = new RecoveryClient({
  publicClient,
  walletClient: guardianWalletClient,
  recoveryManagerAddress,
});

const nonce = await guardianClient.getNonce();
const chainId = BigInt(await publicClient.getChainId());
const challengePeriod = (await guardianClient.getPolicy()).challengePeriod;

const intent = createRecoveryIntent({
  wallet: walletAddress,
  newOwner: proposedOwner,
  recoveryManager: recoveryManagerAddress,
  nonce,
  chainId,
  challengePeriodSeconds: challengePeriod,
});
```

`challengePeriodSeconds` keeps deadline generation compatible with on-chain `startRecovery` validation.

## 5. Start recovery with guardian proof

```ts
const adapter = new EoaAdapter({ walletClient: guardianWalletClient });
const guardianIdentifier = adapter.computeIdentifier(guardianWalletClient.account!.address);
const proofResult = await adapter.generateProof(intent, guardianIdentifier);
if (!proofResult.success) throw new Error(proofResult.error);

await guardianClient.startRecovery({
  intent,
  guardianIndex: 0n,
  proof: proofResult.proof!,
});
```

## 6. Submit more proofs and execute

- Additional guardians call `submitProof`.
- After threshold + challenge period, call `executeRecovery`.

```ts
const ready = await guardianClient.isReadyToExecute();
if (ready) {
  await guardianClient.executeRecovery();
}
```
