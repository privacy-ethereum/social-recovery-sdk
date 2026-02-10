# FAQ

## Does recovery move assets?

No. Recovery changes wallet ownership/authority only.

## Can anyone execute recovery?

Yes, but only after threshold is met and challenge period elapsed, and before deadline.

## Can owner stop a malicious recovery?

Yes. Owner can call `cancelRecovery()` while session is active.

## What happens if a session expires?

Anyone can call `clearExpiredRecovery()` to remove stale session and allow new attempts.

## Are zkJWT guardian emails revealed on-chain?

No. Only commitment and zero-knowledge proof verification data are used.

## Is passkey support plug-and-play on every chain?

Not automatically. The deterministic `p256-verifier` dependency must exist on the target network.
