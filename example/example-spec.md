# Example AA Wallet Spec (Local Anvil + Social Recovery)

## Status

- Phase 1 (Wallet + EOA guardian recovery): Completed
- Phase 2 (Passkey guardian flow in app): Pending
- Phase 3 (zkJWT guardian flow in app): Pending

## 1. Objective

Build a minimal but fully functional web wallet that runs on local Anvil and demonstrates social recovery end-to-end in 3 phases:

1. Wallet + EOA guardian recovery
2. Passkey guardian recovery
3. zkJWT guardian recovery

The app must be real (no mocked recovery logic), clean, and demo-ready.

## 2. Source-of-Truth Files To Reuse

Mandatory references:

- `SPEC.md`
- `ARCHITECTURE.md`
- `ROADMAP.md`
- `CHECKLIST.md`
- `contracts/README.md`
- `sdk/README.md`
- `docs/src/sdk/quickstart.md`
- `docs/src/wallet-integration.md`
- `circuits/zkjwt/README.md`
- `circuits/zkjwt/target`

Important context from these files:

1. Contracts + SDK + e2e coverage already exist.
2. Recovery manager discovery is supported through factory `getRecoveryManager(wallet)`.
3. Recovery lifecycle is already implemented (`startRecovery`, `submitProof`, `executeRecovery`, `cancelRecovery`).
4. Passkey and zkJWT verifiers/adapters are already available and should be reused.

## 3. Product Requirements

In-scope requirements:

1. Smart-contract wallet with basic wallet features.
2. Recovery configuration UI in Settings.
3. Recovery portal that works by pasted wallet address, even when owner is not signed in.
4. Real local chain integration against Anvil.
5. Launch instructions and deterministic scripts.

Out-of-scope:

1. Production security hardening/audit work.
2. Mainnet readiness polish.
3. Advanced design system work.

## 4. UX Requirements

Visual style:

1. Minimalist white/gray/black palette.
2. Clear spacing/typography/borders.
3. No gradients, no decorative visual effects.

Navigation:

1. `Wallet`
2. `Settings`
3. `Recover`

Core flows:

1. Wallet deploy + view balance + send ETH.
2. Recovery setup/update in settings.
3. Recovery execution from pasted wallet address.

## 5. Target Directory Plan

Create under `example/`:

```text
example/
  example-spec.md
  aa-wallet/
    README.md
    package.json
    .env.example
    scripts/
      local-up.sh
      local-down.sh
      deploy-local.ts
    src/
      main.tsx
      app/
        App.tsx
        routes.tsx
      pages/
        WalletPage.tsx
        SettingsPage.tsx
        RecoverPage.tsx
      components/
        layout/
        wallet/
        recovery/
      lib/
        chain.ts
        contracts.ts
        recovery.ts
        policy.ts
        intents.ts
      config/
        local-addresses.example.json
      state/
      styles/
```

Add wallet contract + tests in a standalone Foundry project under `example/contracts`:

```text
example/contracts/src/ExampleAAWallet.sol
example/contracts/src/ExampleAAWalletFactory.sol
example/contracts/test/ExampleAAWallet.t.sol
```

## 6. Contract and SDK Integration Plan

### 6.1 ExampleAAWallet contract requirements

The example wallet contract must:

1. Expose `owner()`, `setOwner(address)`, `isRecoveryAuthorized(address)`.
2. Include owner-only `authorizeRecoveryManager` and `revokeRecoveryManager`.
3. Include wallet execution methods (`execute`, optionally `executeBatch`).
4. Emit events for owner updates and manager auth changes.

Use `contracts/src/mocks/MockRecoveryWallet.sol` as the base shape and extend for wallet UX.

### 6.2 SDK APIs to use (do not re-implement)

1. `RecoveryClient`
2. `PolicyBuilder`
3. `AuthManager`
4. `createRecoveryIntent` and `hashRecoveryIntent`
5. Adapters by phase: `EoaAdapter` (phase 1), `PasskeyAdapter` (phase 2), `ZkJwtAdapter` (phase 3).

### 6.3 Recovery manager discovery

For `Recover` page:

1. Read factory `getRecoveryManager(walletAddress)`.
2. If zero address -> show "Recovery not configured".
3. If non-zero -> fetch and display policy/session data from the manager.

## 7. Local Environment and Deployment

### 7.1 Default assumptions

1. Chain: local Anvil (`http://127.0.0.1:8545`, chain id `31337`).
2. SDK contracts built from root `contracts/`.
3. Example wallet contracts built from `example/contracts/`.
4. SDK consumed from local repo (`file:../../sdk` or workspace link).

### 7.2 Deployment script behavior (`deploy-local.ts`)

`deploy-local.ts` should:

1. Read compiled artifacts from `contracts/out`.
2. Read compiled artifacts from `example/contracts/out` for the wallet factory.
3. Deploy verifier stack + recovery implementation + factory in the same order used in SDK e2e.
4. Handle local `P256_VERIFIER_ADDRESS` requirement for passkey phase (same local strategy as SDK e2e).
5. Write deployed addresses to `src/config/local-addresses.json`.

Implementation patterns should be copied from:

- `sdk/test/e2e.test.ts`
- `sdk/scripts/test-e2e.sh`

### 7.3 Runtime scripts

`local-up.sh`:

1. Start Anvil.
2. Build contracts.
3. Run `deploy-local.ts`.
4. Start web app.

`local-down.sh`:

1. Stop Anvil/dev processes.
2. Keep deployed address artifact for next session unless `--clean` is passed.

## 8. App Flow Spec (must be implemented exactly)

### 8.1 Wallet tab

1. Connect owner signer.
2. Deploy `ExampleAAWallet`.
3. Show wallet address, owner, ETH balance, recovery manager status.
4. Send ETH from wallet via wallet execute action.
5. Show recent tx/recovery events list.

### 8.2 Settings tab

1. Guardian policy form with guardian entries, threshold, and challenge period.
2. Deploy manager if missing via `RecoveryClient.deployRecoveryManager`.
3. Authorize manager on wallet.
4. Push policy updates to chain.
5. Read-back and render current policy after each write.

Phase behavior in settings:

1. Phase 1: only EOA guardian inputs enabled.
2. Phase 2: add passkey enrollment + passkey guardian rows.
3. Phase 3: add zkJWT guardian rows (email + salt + computed commitment preview).

### 8.3 Recover tab (wallet-address-first flow)

1. User pastes wallet address.
2. App resolves recovery manager through factory.
3. App reads current policy and displays guardians.
4. User enters proposed new owner and deadline.
5. App builds intent using `createRecoveryIntent`.
6. App collects first guardian proof and calls `startRecovery`.
7. App collects additional guardian proofs and calls `submitProof`.
8. App shows challenge countdown and session status.
9. When executable, app calls `executeRecovery`.
10. App verifies and displays new owner.

This flow must work without owner wallet being connected.

## 9. Recovery Session State Handling

Represent and render these states:

1. `not-configured` (no recovery manager for wallet)
2. `ready` (configured, no active session)
3. `collecting-approvals` (active session, threshold not reached)
4. `challenge-period` (threshold reached, waiting)
5. `executable` (challenge elapsed)
6. `executed`
7. `cancelled`
8. `expired`

UI must surface:

1. approvals collected vs threshold
2. challenge end timestamp
3. allowed next actions

## 10. Phase-by-Phase Delivery Plan

### 10.1 Phase 1 (ship first): EOA only

Deliverables:

1. Wallet contract + tests
2. Working Wallet/Settings/Recover tabs
3. EOA-only policy setup and recovery execution
4. Local scripts + README runbook
5. E2E test proving full owner recovery

Acceptance criteria:

1. Pasted wallet address discovery works.
2. EOA guardians can complete full recovery cycle.
3. Owner changes on-chain after execution.
4. No mocked recovery paths.

### 10.2 Phase 2: Passkey

Deliverables:

1. Passkey guardian setup and proof flow
2. Runtime verifier dependency checks
3. E2E passkey recovery test
4. Updated README docs

Acceptance criteria:

1. Passkey guardian can be added and used for approval.
2. Recovery succeeds with passkey proof.
3. Missing verifier dependency gives explicit blocking error.

### 10.3 Phase 3: zkJWT

Deliverables:

1. zkJWT guardian setup flow
2. Real intent-bound proof generation via `ZkJwtAdapter`
3. E2E zkJWT recovery test
4. Updated README docs including Noir/BB prerequisites

Acceptance criteria:

1. zkJWT guardian configuration is readable and deterministic.
2. Recovery succeeds with generated zk proof.
3. Proof for different intent hash fails as expected.

## 11. Test Plan

Contract tests:

1. wallet owner authorization rules
2. recovery manager authorization boundaries
3. wallet execute safety checks

App integration/e2e tests (against local Anvil):

1. Phase 1 EOA recovery happy path
2. Phase 1 invalid guardian proof path
3. Phase 2 passkey happy path
4. Phase 2 missing verifier path
5. Phase 3 zkJWT happy path
6. Phase 3 invalid JWT/intent path

## 12. README Runbook Requirements

`example/README.md` (and optionally `example/aa-wallet/README.md`) must contain:

1. Prerequisites (Node/npm, Foundry, jq/cast, Noir/BB for phase 3).
2. Exact commands to install, run local stack, open app, run tests.
3. Reset instructions for clean local redeploy.
4. Troubleshooting for passkey verifier + zk proof generation.

## 13. Guardrails for the Implementing Codex Session

1. Reuse SDK and contracts; do not duplicate core recovery logic.
2. Keep code scoped to `example/aa-wallet` and `example/contracts`.
3. Preserve phase boundaries: phase 1 must stay shippable while phases 2/3 are additive.
4. Keep UI plain and clear (monochrome, no gradient styling).
5. Every phase must run end-to-end on local Anvil with documented commands.

## 14. Final Definition of Done (after phase 3)

1. Example app demonstrates complete wallet + recovery lifecycle locally.
2. Recovery can be initiated by wallet address lookup, without owner sign-in.
3. EOA, passkey, and zkJWT guardians all work through real proofs/signatures.
4. Fresh-machine setup is reproducible from README commands.
