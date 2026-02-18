# Security Finding: Permissionless `deployRecoveryManager()` — Permanent DOS via Front-Running

## Severity: Medium

## Affected Contract
- `RecoveryManagerFactory.sol` — `deployRecoveryManager()` (line 34)

## Root Cause

Three properties combine to create a permanent DOS vector:

1. **Permissionless function** — `deployRecoveryManager()` has no `msg.sender` check. Anyone can call it for any `_wallet` address.
2. **Write-once mapping** — `getRecoveryManager[_wallet]` is set at line 53 and there is no function to clear or reset it.
3. **AlreadyDeployed guard** — Line 43 (`if (getRecoveryManager[_wallet] != address(0)) revert AlreadyDeployed()`) permanently blocks any second deployment for the same wallet through this factory.

## Can `initialize()` Be Front-Run Directly?

**No.** The `_clone()` + `initialize()` happen atomically in the same transaction inside `deployRecoveryManager()` (lines 42-53 of the factory). An attacker cannot call `initialize()` on the proxy between deployment and initialization because both happen in a single EVM execution — there is no mempool window between them.

## Can `deployRecoveryManager()` Be Front-Run?

**Yes.** This is the actual vulnerability.

## Attack Scenario

### Reactive Attack (mempool monitoring)
1. Victim broadcasts `factory.deployRecoveryManager(wallet, legitimateGuardians, 2, 86400)`
2. Attacker sees this in the mempool
3. Attacker front-runs with `factory.deployRecoveryManager(wallet, maliciousGuardians, 1, 0)` using higher gas price
4. Attacker's tx executes first — proxy deployed with malicious guardians, `getRecoveryManager[wallet]` is set
5. Victim's tx reverts with `AlreadyDeployed()`
6. Victim retries — reverts with `AlreadyDeployed()` again. **Permanently blocked.**

### Proactive Attack (no mempool needed)
The attacker does **not** need to monitor the mempool. They can pre-emptively poison any known wallet address before the owner ever attempts to deploy:

```
attacker calls: factory.deployRecoveryManager(targetWallet, dummyGuardians, 1, 0)
```

The attacker can batch-poison hundreds of wallet addresses for the cost of gas (~100k gas per poisoning).

## Is This a Permanent DOS?

**Yes, within this factory instance.** The `getRecoveryManager` mapping is permanently poisoned with no reset mechanism.

- `_clone()` uses `CREATE` (line 67 — nonce-based addressing), so each proxy gets a **unique** address
- But the `getRecoveryManager[wallet]` mapping + `AlreadyDeployed()` check prevents any re-deployment for the same wallet
- There is **no function** to delete, overwrite, or reset the mapping entry

Once poisoned, the victim **cannot** deploy through this factory for their wallet address. Ever.

## Can the Attacker Take Over the Wallet?

**No, not directly.** The attack stops at DOS/griefing because of a second layer of defense:

- `executeRecovery()` calls `IRecovery(wallet).setOwner(newOwner)` (RecoveryManager.sol line 239)
- The wallet must independently authorize the RecoveryManager via `isRecoveryAuthorized()` (IRecovery.sol)
- Since the victim never authorized the attacker's proxy, the `setOwner()` call reverts on the wallet side

**However, severity escalates if:**
- The victim's wallet or UI naively reads `factory.getRecoveryManager(wallet)` and auto-authorizes whatever address is returned
- The victim doesn't notice the revert and manually authorizes the poisoned proxy address

## Victim Workarounds

The victim can bypass the poisoned factory, but these are not clean solutions:

1. **Deploy a new factory instance** — deploy a fresh `RecoveryManagerFactory` with a clean mapping
2. **Deploy a proxy manually** — call the EIP-1167 clone logic directly and then call `initialize()` on the proxy, bypassing the factory entirely
3. **Use a different wallet address** — only applicable if the wallet hasn't been created yet

## Impact Summary

| Aspect              | Detail                                                    |
|---------------------|-----------------------------------------------------------|
| **Vector**          | Permissionless `deployRecoveryManager()`                  |
| **Impact**          | Permanent DOS per wallet per factory instance              |
| **Root cause**      | No access control + write-once mapping with no reset       |
| **Cost to attacker**| Only gas (~100k per poisoning)                             |
| **Scalability**     | Attacker can pre-poison wallets in bulk proactively        |
| **Fund risk**       | None — wallet must authorize via `isRecoveryAuthorized()`  |
| **Reversibility**   | Irreversible within the poisoned factory                   |

## Recommended Fixes

### Option A: `msg.sender` Access Control (Simple)

Add access control to `deployRecoveryManager()` so only the wallet or its owner can deploy:

```solidity
function deployRecoveryManager(
    address _wallet,
    GuardianLib.Guardian[] calldata guardians,
    uint256 _threshold,
    uint256 _challengePeriod
) external returns (address proxy) {
+   if (msg.sender != _wallet && msg.sender != IRecovery(_wallet).owner()) revert Unauthorized();
    if (getRecoveryManager[_wallet] != address(0)) revert AlreadyDeployed();
    // ...
}
```

**Pros:** Simple, minimal code change.
**Cons:** Requires the wallet owner to submit the tx directly. Cannot be relayed by a third party (e.g., SDK backend, relayer, bundler).

---

### Option B: EIP-712 Signed Deployment Authorization (Recommended)

Require the wallet owner to sign an EIP-712 typed message that authorizes the exact deployment parameters. The factory verifies this signature on-chain. Even if an attacker front-runs with different parameters, they cannot forge the owner's signature — the tx reverts.

This approach is consistent with the existing EIP-712 pattern already used in `RecoveryManager` for `RecoveryIntent`.

#### New EIP-712 Type

```solidity
bytes32 internal constant DEPLOY_AUTHORIZATION_TYPEHASH = keccak256(
    "DeployAuthorization(address wallet,bytes32 guardiansHash,uint256 threshold,uint256 challengePeriod,uint256 nonce,uint256 chainId,address factory)"
);

struct DeployAuthorization {
    address wallet;
    bytes32 guardiansHash;   // keccak256(abi.encode(guardians))
    uint256 threshold;
    uint256 challengePeriod;
    uint256 nonce;           // per-wallet nonce to prevent replay
    uint256 chainId;         // cross-chain replay protection
    address factory;         // cross-factory replay protection
}
```

The `guardiansHash` is a hash of the full guardian array. This binds the signature to the **exact** guardian set — the attacker cannot substitute their own guardians.

#### Updated Factory

```solidity
contract RecoveryManagerFactory {
    // ... existing storage ...

+   string internal constant NAME = "RecoveryManagerFactory";
+   string internal constant VERSION = "1";
+
+   bytes32 internal constant DOMAIN_TYPEHASH =
+       keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
+
+   bytes32 internal constant DEPLOY_AUTHORIZATION_TYPEHASH = keccak256(
+       "DeployAuthorization(address wallet,bytes32 guardiansHash,uint256 threshold,uint256 challengePeriod,uint256 nonce,uint256 chainId,address factory)"
+   );
+
+   mapping(address => uint256) public deployNonces;
+
+   error InvalidSignature();

    function deployRecoveryManager(
        address _wallet,
        GuardianLib.Guardian[] calldata guardians,
        uint256 _threshold,
        uint256 _challengePeriod,
+       bytes calldata ownerSignature    // EIP-712 signature from wallet owner
    ) external returns (address proxy) {
        if (getRecoveryManager[_wallet] != address(0)) revert AlreadyDeployed();

+       // Verify the wallet owner authorized this exact deployment
+       _verifyDeployAuthorization(
+           _wallet, guardians, _threshold, _challengePeriod, ownerSignature
+       );

        proxy = _clone(implementation);
        RecoveryManager(proxy).initialize(
            _wallet, guardians, _threshold, _challengePeriod, passkeyVerifier, zkJwtVerifier
        );
        getRecoveryManager[_wallet] = proxy;
+       deployNonces[_wallet]++;

        emit RecoveryManagerDeployed(_wallet, proxy);
    }

+   function _verifyDeployAuthorization(
+       address _wallet,
+       GuardianLib.Guardian[] calldata guardians,
+       uint256 _threshold,
+       uint256 _challengePeriod,
+       bytes calldata signature
+   ) internal view {
+       bytes32 guardiansHash = keccak256(abi.encode(guardians));
+
+       bytes32 structHash = keccak256(abi.encode(
+           DEPLOY_AUTHORIZATION_TYPEHASH,
+           _wallet,
+           guardiansHash,
+           _threshold,
+           _challengePeriod,
+           deployNonces[_wallet],
+           block.chainid,
+           address(this)
+       ));
+
+       bytes32 domainSep = keccak256(abi.encode(
+           DOMAIN_TYPEHASH,
+           keccak256(bytes(NAME)),
+           keccak256(bytes(VERSION)),
+           block.chainid,
+           address(this)
+       ));
+
+       bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
+
+       (uint8 v, bytes32 r, bytes32 s) = abi.decode(signature, (uint8, bytes32, bytes32));
+       address signer = ecrecover(digest, v, r, s);
+
+       if (signer == address(0) || signer != IRecovery(_wallet).owner()) {
+           revert InvalidSignature();
+       }
+   }
}
```

#### Why This Works Against Front-Running

| Attacker Action | Result |
|----------------|--------|
| Replays victim's exact tx (same calldata) | Same guardians/threshold/period are deployed — no harm, victim gets the correct proxy |
| Substitutes different guardians | `guardiansHash` mismatch — signature verification fails, reverts with `InvalidSignature()` |
| Substitutes different threshold or challenge period | Struct hash mismatch — signature verification fails, reverts with `InvalidSignature()` |
| Uses signature on a different chain | `chainId` mismatch — reverts |
| Uses signature on a different factory | `factory` address mismatch — reverts |
| Replays signature after a failed attempt | `nonce` mismatch after increment — reverts |

The key insight: even if the attacker copies the victim's entire calldata and front-runs, the **same correct proxy** gets deployed because all parameters are bound to the signature. The attacker cannot change any parameter without invalidating the signature.

#### SDK-Side Flow

```
1. Wallet owner constructs deployment params (guardians, threshold, challengePeriod)
2. SDK builds EIP-712 DeployAuthorization struct
3. Owner signs via wallet (eth_signTypedData_v4)
4. SDK/relayer submits factory.deployRecoveryManager(..., signature)
5. Factory verifies signature on-chain → deploys proxy
```

**Pros:**
- Front-run resistant — parameters are cryptographically bound to the owner's signature
- Relayer-compatible — any EOA can submit the tx (the owner doesn't need ETH for gas)
- Consistent with existing EIP-712 pattern used for `RecoveryIntent`
- Replay-protected via nonce, chainId, and factory address

**Cons:**
- More code than Option A
- Requires wallet owner to have an EOA key for signing (not applicable for contract wallets without EIP-1271 support — would need `isValidSignature()` extension)

## POC Test

See: `test/POC/FrontRunDeployRecoveryManager.t.sol`

The POC contains three test cases:

1. **`test_POC_attackerFrontRunsPoisonsMapping`** — Full front-running flow: attacker deploys first, victim's tx reverts, mapping permanently poisoned
2. **`test_POC_attackerPreEmptivelyPoisonsWallet`** — Attacker proactively poisons a wallet address before the victim ever tries
3. **`test_POC_attackerCannotTakeOverWallet`** — Proves the attacker cannot take control of the wallet despite controlling the proxy's guardians (wallet authorization prevents it)
