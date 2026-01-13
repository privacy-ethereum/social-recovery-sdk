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
