import { useEffect, useMemo, useState } from 'react';
import { GuardianType, type RecoveryIntent } from '@pse/social-recovery-sdk';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { DEMO_ACCOUNTS, getPublicClient, getWalletClient, increaseAnvilTime, shortAddress } from '../lib/chain';
import { ExampleAAWalletAbi, RecoveryManagerViewAbi, bytes32ToAddress } from '../lib/contracts';
import { buildIntent } from '../lib/intents';
import { toGuardianTypeLabel } from '../lib/policy';
import { createEoaAdapter, createRecoveryClient, loadRecoverySnapshot, type RecoverySnapshot } from '../lib/recovery';

interface RecoverPageProps {
  walletAddress: Address | '';
  setRecoveryManagerAddress: (value: Address | '') => void;
  addActivity: (input: { label: string; details?: string; txHash?: Hex }) => void;
}

const RECOVER_STORAGE_KEY = 'aa-wallet-demo-recover-state-v1';

interface PersistedRecoverState {
  targetWalletInput: string;
  newOwnerInput: string;
  deadlineSeconds: string;
  selectedGuardianIndex: number;
  guardianPrivateKey: Hex;
  executorPrivateKey: Hex;
  cancelOwnerPrivateKey: Hex;
}

const KNOWN_PRIVATE_KEYS = new Set<Hex>(DEMO_ACCOUNTS.map((account) => account.privateKey));

function normalizePrivateKey(value: unknown, fallback: Hex): Hex {
  if (typeof value !== 'string') {
    return fallback;
  }
  return KNOWN_PRIVATE_KEYS.has(value as Hex) ? (value as Hex) : fallback;
}

function loadPersistedRecoverState(): PersistedRecoverState {
  if (typeof window === 'undefined') {
    return {
      targetWalletInput: '',
      newOwnerInput: DEMO_ACCOUNTS[4].address,
      deadlineSeconds: '3600',
      selectedGuardianIndex: 0,
      guardianPrivateKey: DEMO_ACCOUNTS[1].privateKey,
      executorPrivateKey: DEMO_ACCOUNTS[3].privateKey,
      cancelOwnerPrivateKey: DEMO_ACCOUNTS[0].privateKey,
    };
  }

  try {
    const raw = window.localStorage.getItem(RECOVER_STORAGE_KEY);
    if (!raw) {
      return {
        targetWalletInput: '',
        newOwnerInput: DEMO_ACCOUNTS[4].address,
        deadlineSeconds: '3600',
        selectedGuardianIndex: 0,
        guardianPrivateKey: DEMO_ACCOUNTS[1].privateKey,
        executorPrivateKey: DEMO_ACCOUNTS[3].privateKey,
        cancelOwnerPrivateKey: DEMO_ACCOUNTS[0].privateKey,
      };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedRecoverState>;

    return {
      targetWalletInput: typeof parsed.targetWalletInput === 'string' ? parsed.targetWalletInput : '',
      newOwnerInput:
        typeof parsed.newOwnerInput === 'string' && isAddress(parsed.newOwnerInput)
          ? getAddress(parsed.newOwnerInput)
          : DEMO_ACCOUNTS[4].address,
      deadlineSeconds:
        typeof parsed.deadlineSeconds === 'string' && parsed.deadlineSeconds.length > 0 ? parsed.deadlineSeconds : '3600',
      selectedGuardianIndex:
        typeof parsed.selectedGuardianIndex === 'number' && parsed.selectedGuardianIndex >= 0
          ? parsed.selectedGuardianIndex
          : 0,
      guardianPrivateKey: normalizePrivateKey(parsed.guardianPrivateKey, DEMO_ACCOUNTS[1].privateKey),
      executorPrivateKey: normalizePrivateKey(parsed.executorPrivateKey, DEMO_ACCOUNTS[3].privateKey),
      cancelOwnerPrivateKey: normalizePrivateKey(parsed.cancelOwnerPrivateKey, DEMO_ACCOUNTS[0].privateKey),
    };
  } catch {
    return {
      targetWalletInput: '',
      newOwnerInput: DEMO_ACCOUNTS[4].address,
      deadlineSeconds: '3600',
      selectedGuardianIndex: 0,
      guardianPrivateKey: DEMO_ACCOUNTS[1].privateKey,
      executorPrivateKey: DEMO_ACCOUNTS[3].privateKey,
      cancelOwnerPrivateKey: DEMO_ACCOUNTS[0].privateKey,
    };
  }
}

function formatDuration(totalSeconds: bigint): string {
  if (totalSeconds <= 0n) {
    return '0s';
  }

  const days = totalSeconds / 86400n;
  const hours = (totalSeconds % 86400n) / 3600n;
  const minutes = (totalSeconds % 3600n) / 60n;
  const seconds = totalSeconds % 60n;

  const parts: string[] = [];
  if (days > 0n) {
    parts.push(`${days.toString()}d`);
  }
  if (hours > 0n || parts.length > 0) {
    parts.push(`${hours.toString()}h`);
  }
  if (minutes > 0n || parts.length > 0) {
    parts.push(`${minutes.toString()}m`);
  }
  parts.push(`${seconds.toString()}s`);
  return parts.join(' ');
}

function formatRecoverError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message || fallback;
  if (message.includes('GuardianAlreadyApproved')) {
    return 'This guardian already approved the active recovery session.';
  }
  if (message.includes('RecoveryAlreadyActive')) {
    return 'A recovery session is already active for this wallet.';
  }
  if (message.includes('ThresholdNotMet')) {
    return 'Threshold is not met yet. Submit enough guardian approvals first.';
  }
  if (message.includes('ChallengePeriodNotElapsed')) {
    return 'Challenge period has not elapsed yet.';
  }
  if (message.includes('IntentExpired')) {
    return 'Recovery intent is expired.';
  }
  if (message.includes('Unauthorized')) {
    return 'Unauthorized action for current signer.';
  }
  if (message.includes('RecoveryNotActive')) {
    return 'No active recovery session for this wallet.';
  }

  const firstLine = message.split('\n')[0].trim();
  if (firstLine.length === 0) {
    return fallback;
  }
  return firstLine.length > 220 ? `${firstLine.slice(0, 220)}...` : firstLine;
}

export function RecoverPage(props: RecoverPageProps) {
  const initialState = useMemo(() => loadPersistedRecoverState(), []);
  const [targetWalletInput, setTargetWalletInput] = useState<string>(props.walletAddress || initialState.targetWalletInput);
  const [newOwnerInput, setNewOwnerInput] = useState<string>(initialState.newOwnerInput);
  const [deadlineSeconds, setDeadlineSeconds] = useState<string>(initialState.deadlineSeconds);
  const [selectedGuardianIndex, setSelectedGuardianIndex] = useState<number>(initialState.selectedGuardianIndex);
  const [guardianPrivateKey, setGuardianPrivateKey] = useState<Hex>(initialState.guardianPrivateKey);
  const [executorPrivateKey, setExecutorPrivateKey] = useState<Hex>(initialState.executorPrivateKey);
  const [cancelOwnerPrivateKey, setCancelOwnerPrivateKey] = useState<Hex>(initialState.cancelOwnerPrivateKey);
  const [status, setStatus] = useState<string>('Paste wallet address and lookup');
  const [error, setError] = useState<string>('');
  const [snapshot, setSnapshot] = useState<RecoverySnapshot | null>(null);
  const [guardianApprovals, setGuardianApprovals] = useState<boolean[]>([]);
  const [activeIntent, setActiveIntent] = useState<RecoveryIntent | null>(null);
  const [walletOwner, setWalletOwner] = useState<Address | ''>('');
  const [loadedWalletAddress, setLoadedWalletAddress] = useState<Address | ''>('');
  const [timeJumpSeconds, setTimeJumpSeconds] = useState<string>('600');
  const [latestBlockTimestamp, setLatestBlockTimestamp] = useState<bigint>(0n);
  const [timeStatus, setTimeStatus] = useState<string>('');
  const [timeError, setTimeError] = useState<string>('');

  const publicClient = useMemo(() => getPublicClient(), []);
  const selectedGuardian = snapshot?.policy.guardians[selectedGuardianIndex];
  const activeSession = Boolean(snapshot?.isActive);

  const secondsUntilDeadline =
    snapshot && latestBlockTimestamp > 0n && snapshot.session.deadline > latestBlockTimestamp
      ? snapshot.session.deadline - latestBlockTimestamp
      : 0n;
  const challengeReadyAt =
    snapshot && snapshot.session.thresholdMetAt > 0n
      ? snapshot.session.thresholdMetAt + snapshot.policy.challengePeriod
      : 0n;
  const secondsUntilChallengeReady =
    challengeReadyAt > 0n && challengeReadyAt > latestBlockTimestamp ? challengeReadyAt - latestBlockTimestamp : 0n;
  const selectedGuardianAlreadyApproved = Boolean(activeSession && guardianApprovals[selectedGuardianIndex]);

  async function refreshChainClock() {
    const block = await publicClient.getBlock({ blockTag: 'latest' });
    setLatestBlockTimestamp(block.timestamp);
  }

  async function readWalletOwner(walletAddress: Address): Promise<Address | ''> {
    try {
      return await publicClient.readContract({
        address: walletAddress,
        abi: ExampleAAWalletAbi,
        functionName: 'owner',
      });
    } catch {
      return '';
    }
  }

  async function refreshSnapshot(walletAddress: Address) {
    const [nextSnapshot, nextWalletOwner] = await Promise.all([
      loadRecoverySnapshot({
        publicClient,
        walletAddress,
      }),
      readWalletOwner(walletAddress),
    ]);

    setWalletOwner(nextWalletOwner);
    setLoadedWalletAddress(walletAddress);

    if (!nextSnapshot) {
      setSnapshot(null);
      setGuardianApprovals([]);
      props.setRecoveryManagerAddress('');
      setStatus('Recovery is not configured for this wallet.');
      return;
    }

    setSnapshot(nextSnapshot);
    props.setRecoveryManagerAddress(nextSnapshot.recoveryManager);
    setStatus(`Loaded recovery manager (${nextSnapshot.status})`);

    if (nextSnapshot.isActive) {
      const approvals = await Promise.all(
        nextSnapshot.policy.guardians.map((guardian) =>
          publicClient.readContract({
            address: nextSnapshot.recoveryManager,
            abi: RecoveryManagerViewAbi,
            functionName: 'hasApproved',
            args: [guardian.identifier],
          }),
        ),
      );
      setGuardianApprovals(approvals);
    } else {
      setGuardianApprovals(new Array(nextSnapshot.policy.guardians.length).fill(false));
    }
  }

  async function lookupWallet(walletAddress: Address, silent = false) {
    setError('');
    if (!silent) {
      setStatus('Looking up recovery configuration...');
    }

    try {
      await refreshSnapshot(walletAddress);
      await refreshChainClock();
      setTargetWalletInput(walletAddress);
      setActiveIntent(null);
    } catch (lookupError) {
      setSnapshot(null);
      setGuardianApprovals([]);
      setWalletOwner('');
      setLoadedWalletAddress('');
      props.setRecoveryManagerAddress('');
      setError(formatRecoverError(lookupError, 'Wallet lookup failed'));
      setStatus('Lookup failed');
    }
  }

  async function handleLookupWallet() {
    if (!isAddress(targetWalletInput)) {
      setError('Enter a valid wallet address');
      return;
    }
    await lookupWallet(getAddress(targetWalletInput));
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
    if (!guardian || guardian.guardianType !== GuardianType.EOA) {
      return;
    }
    const guardianAddress = bytes32ToAddress(guardian.identifier).toLowerCase();
    const match = DEMO_ACCOUNTS.find((account) => account.address.toLowerCase() === guardianAddress);
    if (match) {
      setGuardianPrivateKey(match.privateKey);
    }
  }

  function resolveOwnerSigner(ownerAddress: Address | '') {
    if (!ownerAddress) {
      return;
    }
    const match = DEMO_ACCOUNTS.find((account) => account.address.toLowerCase() === ownerAddress.toLowerCase());
    if (match) {
      setCancelOwnerPrivateKey(match.privateKey);
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
      setError('Recovery already active. Use active session actions instead.');
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
      await lookupWallet(walletAddress, true);
      setStatus('Recovery session started');
    } catch (startError) {
      setError(formatRecoverError(startError, 'Failed to start recovery'));
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
    if (selectedGuardianAlreadyApproved) {
      setError('This guardian already approved the active recovery session. Choose another guardian.');
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
      await lookupWallet(walletAddress, true);
      setStatus('Additional proof submitted');
    } catch (submitError) {
      setError(formatRecoverError(submitError, 'Proof submission failed'));
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
      await lookupWallet(walletAddress, true);
      setStatus('Recovery executed. No active recovery session now.');
    } catch (executeError) {
      setError(formatRecoverError(executeError, 'Execute failed'));
      setStatus('Execute failed');
    }
  }

  async function handleCancelRecovery() {
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
      const ownerWalletClient = getWalletClient(cancelOwnerPrivateKey);
      const ownerClient = createRecoveryClient({
        publicClient,
        walletClient: ownerWalletClient,
        recoveryManagerAddress: snapshot.recoveryManager,
      });

      setStatus('Cancelling active recovery...');
      const hash = await ownerClient.cancelRecovery();
      await publicClient.waitForTransactionReceipt({ hash });
      props.addActivity({
        label: 'Recovery cancelled by owner',
        txHash: hash,
        details: `Wallet ${shortAddress(walletAddress)}`,
      });

      setActiveIntent(null);
      await lookupWallet(walletAddress, true);
      setStatus('Recovery cancelled. No active recovery session now.');
    } catch (cancelError) {
      setError(formatRecoverError(cancelError, 'Cancel failed'));
      setStatus('Cancel failed');
    }
  }

  async function handleClearExpiredRecovery() {
    setError('');
    if (!snapshot || !snapshot.isActive) {
      setError('No active recovery session');
      return;
    }
    if (snapshot.status !== 'expired') {
      setError('Recovery session is not expired yet');
      return;
    }
    if (!isAddress(targetWalletInput)) {
      setError('Target wallet address is invalid');
      return;
    }

    try {
      const walletAddress = getAddress(targetWalletInput);
      const helperWalletClient = getWalletClient(executorPrivateKey);
      const helperClient = createRecoveryClient({
        publicClient,
        walletClient: helperWalletClient,
        recoveryManagerAddress: snapshot.recoveryManager,
      });

      setStatus('Clearing expired recovery...');
      const hash = await helperClient.clearExpiredRecovery();
      await publicClient.waitForTransactionReceipt({ hash });
      props.addActivity({
        label: 'Expired recovery cleared',
        txHash: hash,
        details: `Wallet ${shortAddress(walletAddress)}`,
      });

      setActiveIntent(null);
      await lookupWallet(walletAddress, true);
      setStatus('Expired recovery cleared. No active recovery session now.');
    } catch (clearError) {
      setError(formatRecoverError(clearError, 'Clear expired recovery failed'));
      setStatus('Clear failed');
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
      if (isAddress(targetWalletInput)) {
        await lookupWallet(getAddress(targetWalletInput), true);
      } else {
        await refreshChainClock();
      }

      setTimeStatus(`Advanced chain time by ${seconds} seconds`);
      props.addActivity({ label: 'Chain time advanced', details: `+${seconds}s` });
    } catch (advanceError) {
      setTimeError(formatRecoverError(advanceError, 'Failed to advance time'));
    }
  }

  async function handleAdvanceToChallengeUnlock() {
    setTimeError('');
    if (!snapshot || !snapshot.isActive) {
      setTimeError('No active session');
      return;
    }
    if (snapshot.session.thresholdMetAt === 0n) {
      setTimeError('Threshold is not met yet.');
      return;
    }
    if (secondsUntilChallengeReady <= 0n) {
      setTimeStatus('Challenge period is already elapsed.');
      return;
    }

    const secondsNumber = Number(secondsUntilChallengeReady);
    if (!Number.isSafeInteger(secondsNumber)) {
      setTimeError('Required time jump is too large');
      return;
    }

    await handleAdvanceTime(secondsNumber);
  }

  async function handleRefreshSession() {
    setError('');
    if (!isAddress(targetWalletInput)) {
      await refreshChainClock();
      setStatus('Refreshed chain time');
      return;
    }
    await lookupWallet(getAddress(targetWalletInput), true);
    setStatus('Session refreshed');
  }

  useEffect(() => {
    window.localStorage.setItem(
      RECOVER_STORAGE_KEY,
      JSON.stringify({
        targetWalletInput,
        newOwnerInput,
        deadlineSeconds,
        selectedGuardianIndex,
        guardianPrivateKey,
        executorPrivateKey,
        cancelOwnerPrivateKey,
      } satisfies PersistedRecoverState),
    );
  }, [
    cancelOwnerPrivateKey,
    deadlineSeconds,
    executorPrivateKey,
    guardianPrivateKey,
    newOwnerInput,
    selectedGuardianIndex,
    targetWalletInput,
  ]);

  useEffect(() => {
    void refreshChainClock();

    const candidate = props.walletAddress || targetWalletInput;
    if (isAddress(candidate)) {
      void lookupWallet(getAddress(candidate), true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!props.walletAddress) {
      return;
    }
    setTargetWalletInput(props.walletAddress);
    if (!loadedWalletAddress || loadedWalletAddress.toLowerCase() !== props.walletAddress.toLowerCase()) {
      void lookupWallet(props.walletAddress, true);
    }
  }, [loadedWalletAddress, props.walletAddress]);

  useEffect(() => {
    if (selectedGuardianIndex >= (snapshot?.policy.guardians.length ?? 0)) {
      setSelectedGuardianIndex(0);
    }
    resolveGuardianSigner(selectedGuardianIndex);
  }, [selectedGuardianIndex, snapshot]);

  useEffect(() => {
    resolveOwnerSigner(walletOwner);
  }, [walletOwner]);

  useEffect(() => {
    if (snapshot?.isActive) {
      setNewOwnerInput(snapshot.session.newOwner);
    } else {
      setActiveIntent(null);
    }
  }, [snapshot]);

  return (
    <section className="panel-grid two-col">
      <article className="panel">
        <h2>Recovery Portal</h2>
        <p className="muted">Recover by wallet address. One wallet can have only one active recovery session at a time.</p>

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

        {!activeSession ? (
          <>
            <label className="field">
              <span>2. Proposed new owner (new session only)</span>
              <input value={newOwnerInput} onChange={(event) => setNewOwnerInput(event.target.value)} />
            </label>

            <label className="field">
              <span>Intent deadline in seconds from now (new session only)</span>
              <input value={deadlineSeconds} onChange={(event) => setDeadlineSeconds(event.target.value)} />
            </label>
          </>
        ) : (
          <div className="subpanel">
            <h3>Active Intent (Locked)</h3>
            <p className="muted">New owner and deadline are fixed once session starts.</p>
            <div className="stats one-col">
              <div>
                <span>New owner</span>
                <strong>{snapshot?.session.newOwner}</strong>
              </div>
              <div>
                <span>Deadline</span>
                <strong>
                  {snapshot ? new Date(Number(snapshot.session.deadline) * 1000).toLocaleString() : '-'} ({' '}
                  {formatDuration(secondsUntilDeadline)} left )
                </strong>
              </div>
            </div>
          </div>
        )}

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
          <span>Executor / helper signer</span>
          <select value={executorPrivateKey} onChange={(event) => setExecutorPrivateKey(event.target.value as Hex)}>
            {DEMO_ACCOUNTS.map((account) => (
              <option key={account.address} value={account.privateKey}>
                {account.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Owner signer (for cancel)</span>
          <select value={cancelOwnerPrivateKey} onChange={(event) => setCancelOwnerPrivateKey(event.target.value as Hex)}>
            {DEMO_ACCOUNTS.map((account) => (
              <option key={account.address} value={account.privateKey}>
                {account.label}
              </option>
            ))}
          </select>
        </label>

        <div className="stats one-col">
          <div>
            <span>Current wallet owner</span>
            <strong>{walletOwner || '-'}</strong>
          </div>
        </div>

        <div className="actions">
          <button
            type="button"
            onClick={handleStartRecovery}
            disabled={!snapshot || activeSession}
            title="Create a new recovery session and submit the first guardian proof"
          >
            Start Recovery
          </button>
          <button
            type="button"
            onClick={handleSubmitProof}
            disabled={!snapshot || !activeSession || selectedGuardianAlreadyApproved}
            title="Submit another guardian proof for the active session"
          >
            Submit Additional Proof
          </button>
          <button
            type="button"
            onClick={handleExecuteRecovery}
            disabled={!snapshot || !activeSession || snapshot.status !== 'executable'}
            title="Execute recovery when threshold and challenge period are satisfied"
          >
            Execute Recovery
          </button>
          <button
            type="button"
            className="secondary"
            onClick={handleCancelRecovery}
            disabled={!snapshot || !activeSession}
            title="Cancel active recovery as current wallet owner"
          >
            Cancel Recovery (Owner)
          </button>
          <button
            type="button"
            className="secondary"
            onClick={handleClearExpiredRecovery}
            disabled={!snapshot || !activeSession || snapshot.status !== 'expired'}
            title="Clear expired session (any signer)"
          >
            Clear Expired Session
          </button>
          <button type="button" className="secondary" onClick={handleRefreshSession} title="Reload session and chain state">
            Refresh
          </button>
        </div>

        <div className="subpanel">
          <h3>Chain Time Controls (Anvil)</h3>
          <p className="muted">Skip time advances chain time and mines one block automatically.</p>
          <div className="stats one-col">
            <div>
              <span>Current block time</span>
              <strong>{latestBlockTimestamp > 0n ? new Date(Number(latestBlockTimestamp) * 1000).toLocaleString() : '-'}</strong>
            </div>
            <div>
              <span>Challenge unlock</span>
              <strong>
                {challengeReadyAt > 0n
                  ? `${new Date(Number(challengeReadyAt) * 1000).toLocaleString()} (${formatDuration(secondsUntilChallengeReady)} left)`
                  : 'Threshold not met yet'}
              </strong>
            </div>
          </div>

          <div className="actions">
            <button type="button" className="secondary" onClick={() => void handleAdvanceTime(60)} title="Advance chain time by 60 seconds">
              +60s
            </button>
            <button type="button" className="secondary" onClick={() => void handleAdvanceTime(600)} title="Advance chain time by 10 minutes">
              +10m
            </button>
            <button type="button" className="secondary" onClick={() => void handleAdvanceTime(3600)} title="Advance chain time by 1 hour">
              +1h
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleAdvanceToChallengeUnlock}
              disabled={!snapshot || !activeSession || snapshot.session.thresholdMetAt === 0n || secondsUntilChallengeReady === 0n}
              title="Jump exactly to challenge unlock time"
            >
              Advance to Challenge Unlock
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
              title="Advance by custom seconds"
            >
              Skip Time
            </button>
          </div>

          {timeStatus ? <p className="muted">{timeStatus}</p> : null}
          {timeError ? <p className="error">{timeError}</p> : null}
        </div>

        <p className="muted">Status: {status}</p>
        {error ? <p className="error">{error}</p> : null}
      </article>

      <article className="panel">
        <h2>Recovery Configuration</h2>
        {!snapshot ? <p className="muted">No recovery configuration found for this wallet yet.</p> : null}

        {snapshot ? (
          <>
            <div className="stats one-col">
              <div>
                <span>Recovery manager</span>
                <strong>{snapshot.recoveryManager}</strong>
              </div>
              <div>
                <span>Threshold</span>
                <strong>{snapshot.policy.threshold.toString()}</strong>
              </div>
              <div>
                <span>Challenge period</span>
                <strong>{snapshot.policy.challengePeriod.toString()}s</strong>
              </div>
            </div>

            <div className="subpanel">
              <h3>Active Session</h3>
              {!snapshot.isActive ? (
                <p className="muted">No active recovery session. Wallet is ready for a new attempt.</p>
              ) : (
                <div className="stats one-col">
                  <div>
                    <span>Status</span>
                    <strong>{snapshot.status}</strong>
                  </div>
                  <div>
                    <span>Approvals / threshold</span>
                    <strong>
                      {snapshot.session.approvalCount.toString()} / {snapshot.policy.threshold.toString()}
                    </strong>
                  </div>
                  <div>
                    <span>Proposed new owner</span>
                    <strong>{snapshot.session.newOwner}</strong>
                  </div>
                  <div>
                    <span>Deadline</span>
                    <strong>{new Date(Number(snapshot.session.deadline) * 1000).toLocaleString()}</strong>
                  </div>
                </div>
              )}
            </div>

            <h3>Guardians</h3>
            <ul className="guardian-list">
              {snapshot.policy.guardians.map((guardian, index) => (
                <li key={`${guardian.identifier}-${index}`} className={index === selectedGuardianIndex ? 'selected' : ''}>
                  <div className="guardian-row-head">
                    <label className="guardian-radio">
                      <input
                        type="radio"
                        checked={index === selectedGuardianIndex}
                        onChange={() => setSelectedGuardianIndex(index)}
                      />
                      <span>Guardian #{index}</span>
                    </label>
                    <span className={guardianApprovals[index] ? 'approval-chip approved' : 'approval-chip pending'}>
                      {guardianApprovals[index] ? 'Approved' : 'Pending'}
                    </span>
                  </div>
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
