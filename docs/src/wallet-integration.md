# Wallet Integration

This chapter describes the minimum contract and product integration surface for wallets.

## Contract requirements

Your wallet must support:

1. Owner state (`owner()`)
2. Authorized owner mutation (`setOwner(newOwner)`)
3. Authorization check (`isRecoveryAuthorized(account)`)

In practice, wallets also expose owner-only methods to authorize/revoke recovery managers.

## Minimal Solidity shape

```solidity
interface IWallet {
    function owner() external view returns (address);
    function setOwner(address newOwner) external;
    function isRecoveryAuthorized(address account) external view returns (bool);
}

contract WalletLike is IWallet {
    address public owner;
    mapping(address => bool) private recoveryAuthorized;

    function setOwner(address newOwner) external {
        require(msg.sender == owner || recoveryAuthorized[msg.sender], "not authorized");
        require(newOwner != address(0), "zero owner");
        owner = newOwner;
    }

    function authorizeRecoveryManager(address rm) external {
        require(msg.sender == owner, "only owner");
        recoveryAuthorized[rm] = true;
    }

    function revokeRecoveryManager(address rm) external {
        require(msg.sender == owner, "only owner");
        delete recoveryAuthorized[rm];
    }

    function isRecoveryAuthorized(address account) external view returns (bool) {
        return recoveryAuthorized[account];
    }
}
```

## Minimal integration pattern

1. Deploy wallet contract.
2. Deploy wallet-specific RecoveryManager via factory.
3. Authorize that RecoveryManager in wallet state.
4. Expose UX for guardian setup, policy updates, and recovery monitoring.

## Execution semantics

`RecoveryManager` does not need to be `msg.sender == owner`; it only needs wallet-level authorization to call `setOwner`.

## Recommended UX surfaces

- Recovery setup wizard (guardian list + threshold + challenge period)
- Event monitoring (show active sessions and countdown)
- Owner cancellation action while session is active
- Post-recovery key import flow for new owner

## Integration checklist

- [ ] Wallet implements `IWallet` compatibility
- [ ] RecoveryManager authorization path exists
- [ ] Challenge period and deadline displayed clearly in UI
- [ ] Owner notification path on `RecoveryStarted`
- [ ] Cancel flow tested end-to-end
- [ ] Passkey dependency present if passkey guardians enabled
