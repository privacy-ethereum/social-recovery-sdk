# Authentication Methods

The system supports three guardian authentication modes.

| Type | Identifier on-chain | Proof source | Privacy |
|---|---|---|---|
| EOA | Padded address | EIP-712 signature | Address revealed |
| Passkey | `keccak256(pubKeyX || pubKeyY)` | WebAuthn assertion | Pubkey revealed in proof |
| zkJWT | `Poseidon2(email_hash, salt)` | Noir proof from JWT | Email hidden |

All methods are bound to the same `RecoveryIntent` to prevent replay.

## Choosing a mix

- EOA: easiest operationally, lowest complexity.
- Passkey: strong UX for non-crypto users, browser/WebAuthn requirements.
- zkJWT: strongest privacy, highest proving/tooling complexity.

Most production policies use mixed guardian types for resilience.
