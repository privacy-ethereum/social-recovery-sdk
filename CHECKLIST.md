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
