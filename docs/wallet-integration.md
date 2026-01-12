# Wallet Integration

This guide explains how to integrate the Social Recovery SDK with smart wallets.

## Requirements

For a wallet to support social recovery, it needs:

1. **Authorization mechanism** — A way to authorize the RecoveryManager contract to execute on the wallet's behalf
2. **Ownership modification** — A function the RecoveryManager can call to set a new owner

## Integration Pattern

```
┌─────────────────┐     authorize      ┌───────────────────┐
│                 │ ─────────────────► │                   │
│     Wallet      │                    │  RecoveryManager  │
│                 │ ◄───────────────── │                   │
└─────────────────┘   setOwner(new)    └───────────────────┘
```

1. During setup, wallet owner authorizes RecoveryManager
2. During recovery, RecoveryManager calls wallet's ownership function
3. RecoveryManager remains authorized for future recoveries

## Example: AmbireWallet (EIP-7702)

AmbireWallet supports EIP-7702 account delegation, making it well-suited for social recovery integration.

### How Ambire Privileges Work

Ambire uses a privilege system where addresses can be granted specific permissions:

```solidity
// Simplified Ambire privilege model
contract AmbireAccount {
    // privilege levels: 0 = none, 1 = execute, 2 = owner
    mapping(address => uint8) public privileges;

    function setAddrPrivilege(address addr, uint8 privilege) external {
        require(privileges[msg.sender] >= 2, "Only owner");
        privileges[addr] = privilege;
    }

    function execute(Transaction[] calldata txns) external {
        require(privileges[msg.sender] >= 1, "Not authorized");
        // execute transactions...
    }
}
```

### Setup: Grant RecoveryManager Privilege

```typescript
// 1. Deploy RecoveryManager for this wallet
const recoveryManager = await factory.deploy(
  ambireWallet.address,
  guardians,
  threshold,
  challengePeriod
);

// 2. Grant execute privilege (level 1) to RecoveryManager
// This allows it to call execute() but not modify privileges directly
await ambireWallet.setAddrPrivilege(
  recoveryManager.address,
  1 // execute privilege
);
```

### RecoveryManager Implementation

The RecoveryManager needs to know how to interact with Ambire:

```solidity
contract RecoveryManager {
    // ... other state ...

    function executeRecovery() external {
        require(session.approvalCount >= threshold, "Threshold not met");
        require(
            block.timestamp >= session.thresholdMetAt + challengePeriod,
            "Challenge period active"
        );

        // For Ambire: call setAddrPrivilege to grant owner rights to newOwner
        // RecoveryManager uses its execute privilege to make this call
        bytes memory payload = abi.encodeCall(
            IAmbireAccount.setAddrPrivilege,
            (session.newOwner, 2) // Grant owner privilege
        );

        IAmbireAccount(wallet).execute(
            _singleTransaction(wallet, payload)
        );

        // Clean up session
        delete activeSession;
        nonce++;

        emit RecoveryExecuted(wallet, session.newOwner);
    }
}
```

### Why This Works

1. **EIP-7702 Compatibility**: Ambire's privilege system works whether the account is a smart contract or an EOA with delegated code

2. **Minimal Trust**: RecoveryManager only has execute privilege, not owner privilege. It can only call `setAddrPrivilege` through `execute()`, and the Ambire contract validates the call

3. **Guardian Protection**: The N-of-M threshold + challenge period protects against unauthorized privilege escalation

### Security Considerations

```solidity
// The RecoveryManager should be constrained in what it can do
// Option A: Only allow setAddrPrivilege calls for newOwner
function executeRecovery() external {
    // ... validation ...

    // Construct the exact call we want to make
    Transaction[] memory txns = new Transaction[](1);
    txns[0] = Transaction({
        to: wallet,
        value: 0,
        data: abi.encodeCall(
            IAmbireAccount.setAddrPrivilege,
            (session.newOwner, 2)
        )
    });

    IAmbireAccount(wallet).execute(txns);
}
```

### Full Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        SETUP PHASE                                │
├──────────────────────────────────────────────────────────────────┤
│  1. Owner deploys RecoveryManager with guardians                 │
│  2. Owner calls: ambireWallet.setAddrPrivilege(recoveryMgr, 1)   │
│  3. RecoveryManager now authorized to call execute()             │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                       RECOVERY PHASE                              │
├──────────────────────────────────────────────────────────────────┤
│  1. Guardian calls: recoveryMgr.startRecovery(newOwner, ...)     │
│  2. Other guardians: recoveryMgr.submitProof(...)                │
│  3. Threshold met → Challenge period starts                       │
│  4. After challenge: recoveryMgr.executeRecovery()               │
│     └─► Calls: ambireWallet.execute([setAddrPrivilege(new, 2)])  │
│  5. newOwner now has owner privilege on AmbireWallet             │
└──────────────────────────────────────────────────────────────────┘
```

## Generic Wallet Interface

For wallets without Ambire's privilege system, implement this interface:

```solidity
interface IRecoverableWallet {
    /// @notice Set a new owner for the wallet
    /// @dev Only callable by authorized recovery contracts
    function setOwner(address newOwner) external;

    /// @notice Check if an address is authorized for recovery
    function isRecoveryAuthorized(address addr) external view returns (bool);
}
```

## Post-Recovery UX

After `executeRecovery()` completes:

| Responsibility | Owner |
|----------------|-------|
| On-chain ownership transfer | SDK (RecoveryManager) |
| Key import into wallet UI | Wallet application |
| Old key revocation (optional) | Wallet application |
| Asset migration (if needed) | User |

The SDK handles the on-chain part. Wallet UIs must:
1. Detect when a new key has authority
2. Allow users to import/access with new key
3. Optionally guide users to revoke old keys
