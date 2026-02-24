# Social Recovery SDK — Implementation Checklist

Progress tracking for [ROADMAP.md](./ROADMAP.md).

---

## Phase 1: Foundation & Passkey ✅

**Contracts:**
- `IVerifier.sol` - Common verifier interface
- `IWallet.sol` - Wallet integration interface
- `IRecoveryManager.sol` - Full RecoveryManager interface with events/errors
- `GuardianLib.sol` - Guardian types enum and identifier computation
- `EIP712Lib.sol` - EIP-712 typed data hashing for RecoveryIntent
- `PasskeyVerifier.sol` - WebAuthn/P-256 signature verification
- Unit tests: 34 tests (GuardianLib, EIP712Lib, PasskeyVerifier)

**SDK:**
- `types.ts` - TypeScript types mirroring Solidity
- `constants.ts` - EIP-712 domain config
- `IAuthAdapter.ts` - Auth adapter interface
- `eip712.ts` - `hashRecoveryIntent()`, `createRecoveryIntent()`
- `webauthn.ts` - COSE parsing, DER signature parsing, WebAuthn API wrappers
- `PasskeyAdapter.ts` - Passkey proof generation
- Unit tests: 40 tests (eip712, webauthn, PasskeyAdapter)

**Dependencies:**
- Added `daimo-eth/p256-verifier` for P-256 verification

**Notes:**
- Uses software P-256 verification (~330k gas). RIP-7212 precompile (~3.4k gas) available on L2s but not yet integrated.
- Solidity version set to `^0.8.21` for p256-verifier compatibility.

---

## Phase 2: zkJWT & Core Contracts ✅

**Circuits:**
- `zkjwt/main.nr` - JWT signature verification + email commitment computation
- Unit tests: 3 tests (packing, commitment, multi-field uniqueness)
- Integration test with self-signed JWT ([circuits/zkjwt/scripts/](./circuits/zkjwt/scripts/)) - generates valid Prover.toml inputs
- Integration test with Google-signed JWT - fetches Google JWKS, generates Prover.toml from real OAuth `id_token`

**Contracts:**
- `HonkVerifier.sol` - Auto-generated Noir proof verifier (from bb tooling)
- `ZkJwtVerifier.sol` - Wraps HonkVerifier, implements IVerifier for zkJWT proofs
- `RecoveryManager.sol` - Core contract: policy management, session lifecycle, proof verification, execution
- `RecoveryManagerFactory.sol` - Deploys RecoveryManager proxies (EIP-1167 minimal proxy)
- Unit tests: 90 tests (RecoveryManager, RecoveryManagerFactory, ZkJwtVerifier)

**Dependencies:**
- Added `noir-jwt` v0.5.1 for RS256 JWT verification
- Added `poseidon` v0.2.0 for Poseidon2 hashing

---

## Phase 3: TypeScript SDK ✅

**SDK:**
- `EoaAdapter.ts` - EOA guardian: EIP-712 ECDSA signing, proof ABI-encoding
- `ZkJwtAdapter.ts` - zkJWT guardian: Noir proof generation, Poseidon2 commitment
- `AuthManager.ts` - Adapter registry, routes proof generation by guardian type
- `RecoveryManagerContract.ts` / `FactoryContract.ts` - Typed viem contract wrappers
- `RecoveryClient.ts` - Main orchestration: deploy, recover, execute, cancel
- `PolicyBuilder.ts` - Fluent API for guardian policies
- zkJWT utilities adapted from circuit scripts (`poseidon`, `jwt`, `rsa`, `google-jwks`, `circuit`)
- Unit tests: 91 new tests (131 total with Phase 1)

**Dependencies:**
- Added `@aztec/bb.js` for Poseidon2 hashing and UltraHonk proof generation
- Added `@noir-lang/noir_js` for Noir circuit execution

---

## Phase 4: End-to-End Testing & Deployment Readiness ✅

**E2E:**
- `sdk/test/e2e.test.ts` - End-to-end recovery tests for EOA, Passkey, and zkJWT guardians against deployed local contracts
- `sdk/scripts/test-e2e.sh` - One-command runner (build contracts, start Anvil, run SDK e2e suite)
- Added deterministic passkey proof path in e2e with WebAuthn-compatible payload format
- Added local P-256 verifier predeploy stub for Anvil e2e (`contracts/src/mocks/P256VerifierStub.sol`)

**Deployment readiness:**
- Added Foundry deploy profile in `contracts/foundry.toml` (`optimizer_runs=1`) to fit `HonkVerifier` under EIP-170 size limit
- Added `contracts/scripts/deploy.sh` to deploy + verify verifier stack, RecoveryManager implementation, and factory

**SDK/zkJWT hardening:**
- `parseP256Signature()` now canonicalizes low-`s` signatures for passkey compatibility with on-chain verifier checks
- zkJWT e2e proof generation uses circuit toolchain with EVM target (`bb prove -t evm`) and on-chain-compatible proof encoding

---

## Example App Track

### Phase 1: Standalone AA Wallet + EOA Recovery ✅

**Implemented under `example/`:**
- Standalone Foundry wallet project: `example/contracts` (`ExampleAAWallet`, `ExampleAAWalletFactory`, tests)
- Standalone React app: `example/aa-wallet` with `Wallet`, `Settings`, and `Recover` tabs
- Real local deployment stack via `local-up.sh` / `deploy-local.ts` (SDK contracts + example wallet factory)
- EOA guardian recovery flow end-to-end (start, submit, execute, cancel, clear expired)
- Recovery manager discovery by pasted wallet address in Recover tab
- Demo-focused UX improvements (state persistence, chain time controls, guardian/session visibility)

**Notes:**
- Example Phase 3 (zkJWT flow in app UI) remains pending.

### Phase 2: Passkey Recovery in Example App ✅

**Implemented under `example/aa-wallet`:**
- Local passkey enrollment (WebAuthn) with browser storage for demo credentials
- Settings support for mixed guardian policy updates (`EOA` + `Passkey`)
- Recovery flow support for passkey guardian proofs via `PasskeyAdapter`
- Passkey guardian state visibility in recovery configuration/session UI
- Updated app copy and runbook status for Phase 2 completion
