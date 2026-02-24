import { useEffect, useMemo, useState } from 'react';
import { GuardianType, type RecoveryIntent } from '@pse/social-recovery-sdk';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { DEMO_ACCOUNTS, getPublicClient, getWalletClient, increaseAnvilTime, mineAnvilBlock, shortAddress } from '../lib/chain';
import { bytes32ToAddress } from '../lib/contracts';
import { buildIntent } from '../lib/intents';
import { toGuardianTypeLabel } from '../lib/policy';
import { createEoaAdapter, createRecoveryClient, loadRecoverySnapshot, type RecoverySnapshot } from '../lib/recovery';

interface RecoverPageProps {
  walletAddress: Address | '';
  setRecoveryManagerAddress: (value: Address | '') => void;
  addActivity: (input: { label: string; details?: string; txHash?: Hex }) => void;
}

export function RecoverPage(props: RecoverPageProps) {
  const [targetWalletInput, setTargetWalletInput] = useState<string>(props.walletAddress || '');
  const [newOwnerInput, setNewOwnerInput] = useState<string>(DEMO_ACCOUNTS[4].address);
  const [deadlineSeconds, setDeadlineSeconds] = useState<string>('3600');
  const [selectedGuardianIndex, setSelectedGuardianIndex] = useState<number>(0);
  const [guardianPrivateKey, setGuardianPrivateKey] = useState<Hex>(DEMO_ACCOUNTS[1].privateKey);
  const [executorPrivateKey, setExecutorPrivateKey] = useState<Hex>(DEMO_ACCOUNTS[3].privateKey);
  const [timeJumpSeconds, setTimeJumpSeconds] = useState<string>('600');
  const [latestBlockTimestamp, setLatestBlockTimestamp] = useState<bigint>(0n);
  const [timeStatus, setTimeStatus] = useState<string>('');
  const [timeError, setTimeError] = useState<string>('');
  const [status, setStatus] = useState<string>('Paste wallet address and lookup');
  const [error, setError] = useState<string>('');
  const [snapshot, setSnapshot] = useState<RecoverySnapshot | null>(null);
  const [activeIntent, setActiveIntent] = useState<RecoveryIntent | null>(null);

  const publicClient = useMemo(() => getPublicClient(), []);
  const selectedGuardian = snapshot?.policy.guardians[selectedGuardianIndex];

  async function refreshSnapshot(walletAddress: Address) {
    const nextSnapshot = await loadRecoverySnapshot({
      publicClient,
      walletAddress,
    });

    if (!nextSnapshot) {
      setSnapshot(null);
      props.setRecoveryManagerAddress('');
      setStatus('Recovery is not configured for this wallet.');
      return;
    }

    setSnapshot(nextSnapshot);
    props.setRecoveryManagerAddress(nextSnapshot.recoveryManager);
    setStatus(`Loaded recovery manager (${nextSnapshot.status})`);
  }

  async function refreshChainClock() {
    const block = await publicClient.getBlock({ blockTag: 'latest' });
    setLatestBlockTimestamp(block.timestamp);
  }

  async function refreshAfterChainChange(walletAddress?: Address) {
    await refreshChainClock();
    if (walletAddress) {
      await refreshSnapshot(walletAddress);
    }
  }

  async function handleLookupWallet() {
    setError('');
    if (!isAddress(targetWalletInput)) {
      setError('Enter a valid wallet address');
      return;
    }

    const walletAddress = getAddress(targetWalletInput);
    try {
      await refreshSnapshot(walletAddress);
      await refreshChainClock();
      setActiveIntent(null);
      setSelectedGuardianIndex(0);
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'Wallet lookup failed');
    }
  }

  async function resolveIntent(walletAddress: Address): Promise<RecoveryIntent> {
    if (!snapshot) {
      throw new Error('Recovery manager not loaded');
    }

    const chainId = BigInt(await publicClient.getChainId());
    const readClient = createRecoveryClient({
      publicClient,
      recoveryManagerAddress: snapshot.recoveryManager,
    });
    const nonce = await readClient.getNonce();

    if (snapshot.isActive) {
      if (activeIntent) {
        return activeIntent;
      }
      return {
        wallet: walletAddress,
        newOwner: snapshot.session.newOwner,
        nonce,
        deadline: snapshot.session.deadline,
        chainId,
        recoveryManager: snapshot.recoveryManager,
      };
    }

    if (!isAddress(newOwnerInput)) {
      throw new Error('New owner address is invalid');
    }

    const deadlineSecondsValue = Number(deadlineSeconds);
    if (!Number.isInteger(deadlineSecondsValue) || deadlineSecondsValue <= 0) {
      throw new Error('Deadline seconds must be a positive integer');
    }

    return buildIntent({
      wallet: walletAddress,
      newOwner: getAddress(newOwnerInput),
      recoveryManager: snapshot.recoveryManager,
      nonce,
      chainId,
      challengePeriodSeconds: snapshot.policy.challengePeriod,
      deadlineSeconds: deadlineSecondsValue,
    });
  }

  function resolveGuardianSigner(index: number) {
    if (!snapshot) {
      return;
    }
    const guardian = snapshot.policy.guardians[index];
    if (!guardian) {
      return;
    }
    const guardianAddress = bytes32ToAddress(guardian.identifier).toLowerCase();
    const match = DEMO_ACCOUNTS.find((account) => account.address.toLowerCase() === guardianAddress);
    if (match) {
      setGuardianPrivateKey(match.privateKey);
    }
  }

  async function handleStartRecovery() {
    setError('');
    if (!snapshot) {
      setError('Lookup a wallet with configured recovery first');
      return;
    }
    if (!isAddress(targetWalletInput)) {
      setError('Target wallet address is invalid');
      return;
    }
    if (!selectedGuardian) {
      setError('Select a guardian');
      return;
    }
    if (selectedGuardian.guardianType !== GuardianType.EOA) {
      setError('This demo currently supports EOA guardians only');
      return;
    }
    if (snapshot.isActive) {
      setError('Recovery already active. Use Submit proof instead.');
      return;
    }

    try {
      const walletAddress = getAddress(targetWalletInput);
      const guardianIndex = BigInt(selectedGuardianIndex);
      const guardianWalletClient = getWalletClient(guardianPrivateKey);
      const adapter = createEoaAdapter(guardianWalletClient);
      const intent = await resolveIntent(walletAddress);
      const proofResult = await adapter.generateProof(intent, selectedGuardian.identifier);
      if (!proofResult.success || !proofResult.proof) {
        throw new Error(proofResult.error || 'Could not generate guardian proof');
      }

      const guardianClient = createRecoveryClient({
        publicClient,
        walletClient: guardianWalletClient,
        recoveryManagerAddress: snapshot.recoveryManager,
      });

      setStatus('Submitting first guardian proof...');
      const hash = await guardianClient.startRecovery({
        intent,
        guardianIndex,
        proof: proofResult.proof,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      props.addActivity({
        label: 'Recovery started',
        txHash: hash,
        details: `Guardian #${selectedGuardianIndex}`,
      });

      setActiveIntent(intent);
      await refreshSnapshot(walletAddress);
      setStatus('Recovery session started');
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Failed to start recovery');
      setStatus('Start failed');
    }
  }

  async function handleSubmitProof() {
    setError('');
    if (!snapshot || !snapshot.isActive) {
      setError('No active recovery session');
      return;
    }
    if (!isAddress(targetWalletInput)) {
      setError('Target wallet address is invalid');
      return;
    }
    if (!selectedGuardian) {
      setError('Select a guardian');
      return;
    }
    if (selectedGuardian.guardianType !== GuardianType.EOA) {
      setError('This demo currently supports EOA guardians only');
      return;
    }

    try {
      const walletAddress = getAddress(targetWalletInput);
      const guardianIndex = BigInt(selectedGuardianIndex);
      const guardianWalletClient = getWalletClient(guardianPrivateKey);
      const adapter = createEoaAdapter(guardianWalletClient);
      const intent = await resolveIntent(walletAddress);
      const proofResult = await adapter.generateProof(intent, selectedGuardian.identifier);
      if (!proofResult.success || !proofResult.proof) {
        throw new Error(proofResult.error || 'Could not generate guardian proof');
      }

      const guardianClient = createRecoveryClient({
        publicClient,
        walletClient: guardianWalletClient,
        recoveryManagerAddress: snapshot.recoveryManager,
      });

      setStatus('Submitting guardian approval...');
      const hash = await guardianClient.submitProof({
        guardianIndex,
        proof: proofResult.proof,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      props.addActivity({
        label: 'Recovery proof submitted',
        txHash: hash,
        details: `Guardian #${selectedGuardianIndex}`,
      });

      setActiveIntent(intent);
      await refreshSnapshot(walletAddress);
      setStatus('Additional proof submitted');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Proof submission failed');
      setStatus('Submit failed');
    }
  }

  async function handleExecuteRecovery() {
    setError('');
    if (!snapshot || !snapshot.isActive) {
      setError('No active recovery session');
      return;
    }
    if (!isAddress(targetWalletInput)) {
      setError('Target wallet address is invalid');
      return;
    }

    try {
      const walletAddress = getAddress(targetWalletInput);
      const executorWalletClient = getWalletClient(executorPrivateKey);
      const executorClient = createRecoveryClient({
        publicClient,
        walletClient: executorWalletClient,
        recoveryManagerAddress: snapshot.recoveryManager,
      });

      setStatus('Executing recovery...');
      const hash = await executorClient.executeRecovery();
      await publicClient.waitForTransactionReceipt({ hash });

      props.addActivity({
        label: 'Recovery executed',
        txHash: hash,
        details: `Wallet ${shortAddress(walletAddress)}`,
      });
      setActiveIntent(null);
      await refreshSnapshot(walletAddress);
      setStatus('Recovery executed');
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : 'Execute failed');
      setStatus('Execute failed');
    }
  }

  async function handleAdvanceTime(secondsOverride?: number) {
    setTimeError('');
    try {
      const seconds = secondsOverride ?? Number(timeJumpSeconds);
      if (!Number.isInteger(seconds) || seconds <= 0) {
        throw new Error('Time skip must be a positive integer (seconds)');
      }

      await increaseAnvilTime(publicClient, seconds);
      const walletAddress = isAddress(targetWalletInput) ? getAddress(targetWalletInput) : undefined;
      await refreshAfterChainChange(walletAddress);
      setTimeStatus(`Advanced chain time by ${seconds} seconds`);
      props.addActivity({ label: 'Chain time advanced', details: `+${seconds}s` });
    } catch (advanceError) {
      setTimeError(advanceError instanceof Error ? advanceError.message : 'Failed to advance time');
    }
  }

  async function handleMineBlock() {
    setTimeError('');
    try {
      await mineAnvilBlock(publicClient);
      const walletAddress = isAddress(targetWalletInput) ? getAddress(targetWalletInput) : undefined;
      await refreshAfterChainChange(walletAddress);
      setTimeStatus('Mined one block');
      props.addActivity({ label: 'Block mined' });
    } catch (mineError) {
      setTimeError(mineError instanceof Error ? mineError.message : 'Failed to mine block');
    }
  }

  useEffect(() => {
    if (selectedGuardianIndex >= (snapshot?.policy.guardians.length ?? 0)) {
      setSelectedGuardianIndex(0);
    }
    resolveGuardianSigner(selectedGuardianIndex);
  }, [selectedGuardianIndex, snapshot]);

  useEffect(() => {
    if (props.walletAddress) {
      setTargetWalletInput(props.walletAddress);
    }
  }, [props.walletAddress]);

  useEffect(() => {
    void refreshChainClock();
  }, []);

  return (
    <section className="panel-grid two-col">
      <article className="panel">
        <h2>Recovery Portal</h2>
        <p className="muted">Use this flow even without owner signer. Input wallet and submit guardian proofs.</p>

        <label className="field">
          <span>1. Wallet address to recover</span>
          <div className="row gap-sm">
            <input
              value={targetWalletInput}
              onChange={(event) => setTargetWalletInput(event.target.value)}
              placeholder="0x..."
            />
            <button type="button" onClick={handleLookupWallet} title="Load wallet recovery configuration from chain">
              Lookup
            </button>
          </div>
        </label>

        <label className="field">
          <span>2. Proposed new owner</span>
          <input value={newOwnerInput} onChange={(event) => setNewOwnerInput(event.target.value)} />
        </label>

        <label className="field">
          <span>Intent deadline (seconds from now)</span>
          <input value={deadlineSeconds} onChange={(event) => setDeadlineSeconds(event.target.value)} />
        </label>

        <label className="field">
          <span>3. Guardian signer (must match selected guardian)</span>
          <select value={guardianPrivateKey} onChange={(event) => setGuardianPrivateKey(event.target.value as Hex)}>
            {DEMO_ACCOUNTS.map((account) => (
              <option key={account.address} value={account.privateKey}>
                {account.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Executor signer</span>
          <select value={executorPrivateKey} onChange={(event) => setExecutorPrivateKey(event.target.value as Hex)}>
            {DEMO_ACCOUNTS.map((account) => (
              <option key={account.address} value={account.privateKey}>
                {account.label}
              </option>
            ))}
          </select>
        </label>

        <div className="actions">
          <button
            type="button"
            onClick={handleStartRecovery}
            disabled={!snapshot || snapshot.isActive}
            title="Create the recovery session and submit the first guardian proof"
          >
            4. Start Recovery
          </button>
          <button
            type="button"
            onClick={handleSubmitProof}
            disabled={!snapshot || !snapshot.isActive}
            title="Submit another guardian proof for the same active intent"
          >
            5. Submit Additional Proof
          </button>
          <button
            type="button"
            onClick={handleExecuteRecovery}
            disabled={!snapshot || !snapshot.isActive}
            title="Execute recovery after threshold + challenge period conditions are met"
          >
            6. Execute Recovery
          </button>
        </div>

        <div className="subpanel">
          <h3>Chain Time Controls (Anvil)</h3>
          <p className="muted">Use this to simulate challenge period passing before execution.</p>
          <div className="stats one-col">
            <div>
              <span>Latest block time</span>
              <strong>
                {latestBlockTimestamp > 0n ? new Date(Number(latestBlockTimestamp) * 1000).toLocaleString() : '-'}
              </strong>
            </div>
          </div>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => void handleAdvanceTime(60)} title="Advance chain time by 60 seconds and mine one block">
              +60s
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void handleAdvanceTime(600)}
              title="Advance chain time by 10 minutes and mine one block"
            >
              +10m
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void handleAdvanceTime(3600)}
              title="Advance chain time by 1 hour and mine one block"
            >
              +1h
            </button>
          </div>
          <div className="row gap-sm">
            <input
              value={timeJumpSeconds}
              onChange={(event) => setTimeJumpSeconds(event.target.value)}
              placeholder="Custom seconds"
            />
            <button
              type="button"
              className="secondary"
              onClick={() => void handleAdvanceTime()}
              title="Advance by custom seconds and mine one block"
            >
              Skip time
            </button>
            <button type="button" className="secondary" onClick={handleMineBlock} title="Mine one block without changing time">
              Mine block
            </button>
          </div>
          {timeStatus ? <p className="muted">{timeStatus}</p> : null}
          {timeError ? <p className="error">{timeError}</p> : null}
        </div>

        <p className="muted">Status: {status}</p>
        {error ? <p className="error">{error}</p> : null}
      </article>

      <article className="panel">
        <h2>Recovered Wallet Snapshot</h2>
        {!snapshot ? <p className="muted">No recovery configuration found for this wallet yet.</p> : null}

        {snapshot ? (
          <>
            <div className="stats one-col">
              <div>
                <span>Recovery manager</span>
                <strong>{snapshot.recoveryManager}</strong>
              </div>
              <div>
                <span>Session status</span>
                <strong>{snapshot.status}</strong>
              </div>
              <div>
                <span>Approvals / threshold</span>
                <strong>
                  {snapshot.session.approvalCount.toString()} / {snapshot.policy.threshold.toString()}
                </strong>
              </div>
              <div>
                <span>Challenge period</span>
                <strong>{snapshot.policy.challengePeriod.toString()}s</strong>
              </div>
            </div>

            <h3>Guardians</h3>
            <ul className="guardian-list">
              {snapshot.policy.guardians.map((guardian, index) => (
                <li key={`${guardian.identifier}-${index}`} className={index === selectedGuardianIndex ? 'selected' : ''}>
                  <label className="guardian-radio">
                    <input
                      type="radio"
                      checked={index === selectedGuardianIndex}
                      onChange={() => setSelectedGuardianIndex(index)}
                    />
                    <span>Guardian #{index}</span>
                  </label>
                  <span>Type: {toGuardianTypeLabel(guardian.guardianType)}</span>
                  <code>{guardian.guardianType === GuardianType.EOA ? bytes32ToAddress(guardian.identifier) : guardian.identifier}</code>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </article>
    </section>
  );
}
