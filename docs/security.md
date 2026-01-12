# Security Model

## Trust Assumptions

| Component | Trust Level | Notes |
|-----------|-------------|-------|
| Guardians | Trusted | N-of-M can recover wallet; choose carefully |
| RecoveryManager | Audited code | Has recovery control over wallet |
| Verifiers | Audited code | Bugs could allow fake proofs |
| OAuth Provider | Trusted (zkJWT) | Google signs JWTs; SDK trusts their signatures |
| Wallet | Audited code | Must correctly implement authorization |

## Threat Model

### Threats and Mitigations

| Threat | Attack Vector | Mitigation |
|--------|---------------|------------|
| **Guardian collusion** | N guardians conspire to steal wallet | Choose trusted guardians across different contexts (family, friends, institutions); use appropriate threshold |
| **Single guardian compromise** | Attacker gains one guardian's keys | Requires N guardians; single compromise insufficient |
| **Replay attacks** | Reuse proof on different chain/contract | Intent includes nonce, deadline, chainId, recoveryManager address |
| **Front-running** | Attacker substitutes different newOwner | Proof cryptographically bound to specific newOwner |
| **Griefing (spam sessions)** | Attacker floods with fake recovery attempts | Only guardians can start recovery sessions |
| **Malicious guardian** | Guardian starts unauthorized recovery | Challenge period allows owner to cancel |
| **Verifier bugs** | Exploit allows forged proofs | Formal verification, audits, bug bounties |

### What We Don't Protect Against

- **N+ guardians compromised**: If threshold guardians collude or are compromised, recovery succeeds
- **Owner offline during challenge**: If owner can't cancel within challenge period, recovery proceeds
- **Smart contract bugs**: Audit mitigates but doesn't eliminate risk

## Challenge Period

The challenge period is the primary defense against unauthorized recovery.

### How It Works

```
Threshold met → Challenge starts → [Owner can cancel] → Challenge ends → Execute allowed
                     │                                         │
                     └────────── challengePeriod ──────────────┘
```

### Recommendations

| Wallet Value | Recommended Period | Rationale |
|--------------|-------------------|-----------|
| Testing | 0 seconds | Fast iteration |
| Low value | 1 day | Quick recovery, some protection |
| Medium value | 3 days | Balance of security and UX |
| High value | 7 days | Maximum protection |

### Owner Responsibilities

Owners should:
1. Monitor for `RecoveryStarted` events (or use a monitoring service)
2. Have backup access to cancel if needed
3. Inform guardians of the challenge period length

## Privacy Model

### Data Exposure by Auth Method

| Method | At Rest (On-Chain) | During Recovery |
|--------|--------------------|-----------------|
| EOA | Ethereum address visible | Address revealed via ecrecover |
| Passkey | Public key hash visible | Full public key revealed in proof |
| zkJWT | Only Poseidon commitment | Email **never** revealed |

### zkJWT Privacy Details

**What's hidden:**
- Guardian's email address
- JWT token contents
- Relationship between guardian and wallet

**What's revealed:**
- That *someone* with a valid Google account authorized recovery
- The commitment (but not what it commits to)
- Timing of the authorization

**Salt management:**
- Owner generates salt during setup
- Salt shared with guardian out-of-band
- If salt leaks + email known → commitment can be verified (but not forged)
- Guardian must securely store salt for recovery

## Security Best Practices

### For Wallet Owners

1. **Diverse guardians**: Choose guardians from different contexts (not all coworkers, not all family)
2. **Appropriate threshold**: Higher threshold = more security, harder recovery
3. **Meaningful challenge period**: Long enough to notice and react
4. **Monitor events**: Set up alerts for `RecoveryStarted`
5. **Test recovery**: Do a dry run with guardians before you need it

### For Guardians

1. **Secure your auth method**:
   - EOA: Hardware wallet recommended
   - Passkey: Use device with secure enclave
   - zkJWT: Use account with 2FA
2. **Verify recovery requests**: Confirm with wallet owner through secondary channel
3. **Store credentials safely**: Especially zkJWT salt

### For Integrators

1. **Audit contracts**: Before mainnet deployment
2. **Use deterministic deployment**: Same addresses across chains
3. **Implement monitoring**: Alert owners to recovery attempts
4. **Provide cancellation UI**: Make it easy for owners to cancel unauthorized recovery

## Incident Response

### If Unauthorized Recovery Started

```
1. Owner detects RecoveryStarted event
2. Owner calls cancelRecovery() before challenge period ends
3. Session cleared, nonce incremented
4. Consider updating guardian set if compromise suspected
```

### If Guardian Compromised

```
1. Owner calls updateGuardians() with new set
2. Nonce increments, invalidating any proofs
3. Inform other guardians of the change
```

### If Recovery Executed Maliciously

```
1. New owner has wallet control
2. Original owner must coordinate with new guardians (if policy unchanged)
3. Or accept loss if attacker changed policy
4. Prevention: appropriate challenge period + monitoring
```
