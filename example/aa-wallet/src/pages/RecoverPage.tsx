import { useEffect, useMemo, useState } from 'react';
import { GuardianType, computeZkJwtIdentifier, decodeJwtPayload, type RecoveryIntent } from '@pse/social-recovery-sdk';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { DEMO_ACCOUNTS, getPublicClient, getWalletClient, increaseAnvilTime, shortAddress } from '../lib/chain';
import { ExampleAAWalletAbi, RecoveryManagerViewAbi, bytes32ToAddress } from '../lib/contracts';
import { buildIntent } from '../lib/intents';
import { listPasskeys, type PasskeyMaterial } from '../lib/passkeys';
import { toGuardianTypeLabel } from '../lib/policy';
import {
  createEoaAdapter,
  createPasskeyAdapter,
  createRecoveryClient,
  createZkJwtAdapter,
  loadRecoverySnapshot,
  type RecoverySnapshot,
} from '../lib/recovery';
import { requestGoogleIdTokenPopup } from '../lib/google-oauth';

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
  zkjwtInputs: Record<string, { salt: string }>;
}

interface ZkJwtTokenState {
  idToken: string;
  email: string;
  exp: number | null;
  issuedAt: string;
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
      zkjwtInputs: {},
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
        zkjwtInputs: {},
      };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedRecoverState>;
    const zkjwtInputs: Record<string, { salt: string }> = {};
    if (parsed.zkjwtInputs && typeof parsed.zkjwtInputs === 'object') {
      for (const [key, value] of Object.entries(parsed.zkjwtInputs)) {
        if (!value || typeof value !== 'object') {
          continue;
        }
        const candidate = value as { salt?: unknown };
        if (typeof candidate.salt !== 'string') {
          continue;
        }
        zkjwtInputs[key.toLowerCase()] = {
          salt: candidate.salt,
        };
      }
    }

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
      zkjwtInputs,
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
      zkjwtInputs: {},
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
  const firstLine = message.split('\n')[0].trim();
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
  if (message.includes('Guardian identifier does not match adapter public key')) {
    return 'Selected passkey does not match the guardian configured on-chain.';
  }
  if (message.includes('WebAuthn is not supported')) {
    return 'WebAuthn is not available in this browser/environment.';
  }
  if (
    message.includes('The operation either timed out or was not allowed') ||
    message.includes('NotAllowedError')
  ) {
    return 'Passkey prompt was cancelled or timed out.';
  }
  if (message.includes('Google OAuth popup was blocked')) {
    return 'Google popup was blocked by the browser. Allow popups and try again.';
  }
  if (message.includes('Google OAuth popup was closed')) {
    return 'Google popup was closed before authentication finished.';
  }
  if (message.includes('Google OAuth timed out')) {
    return 'Google authentication timed out. Try again.';
  }
  if (message.includes('Google OAuth state mismatch')) {
    return 'Google authentication state mismatch. Try again.';
  }
  if (message.includes('Google id_token nonce mismatch')) {
    return 'Google authentication nonce mismatch. Try again.';
  }
  if (message.includes('did not return an id_token')) {
    return 'Google did not return an ID token. Verify OpenID scope is enabled.';
  }
  if (message.includes('Authenticated Google account does not match selected ZK JWT guardian commitment')) {
    return 'Authenticated Google account + salt do not match selected guardian commitment.';
  }
  if (message.includes('email_verified')) {
    return 'Google token must have email_verified = true.';
  }
  if (message.includes('Guardian identifier does not match JWT email + salt commitment')) {
    return 'Email/salt do not match this on-chain ZK JWT guardian.';
  }
  if (message.includes('Failed to fetch Google JWKS')) {
    return 'Could not fetch Google signing keys. Check network and try again.';
  }
  if (message === 'Failed to fetch' || message.includes('fetch failed')) {
    return 'Network request failed while loading Google signing keys. Check internet connection/browser shields and retry.';
  }
  if (message.includes('No Google JWK found')) {
    return 'Google signing key for this token was not found. Re-authenticate to get a fresh token.';
  }
  if (message.includes('backend.generateProof failed') && message.toLowerCase().includes('unreachable')) {
    return 'zkJWT prover crashed in-browser. Reload and retry. If it persists, restart local stack and disable browser shields/tracking protection.';
  }
  if (message.includes('noir.execute failed') || message.includes('backend.generateProof failed')) {
    return firstLine.length > 220 ? `${firstLine.slice(0, 220)}...` : firstLine;
  }
  if (firstLine.length === 0) {
    return fallback;
  }
  return firstLine.length > 220 ? `${firstLine.slice(0, 220)}...` : firstLine;
}

function shortHex(value: string): string {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function parseZkjwtSaltInput(rawSalt: string): bigint {
  const trimmed = rawSalt.trim();
  if (!trimmed) {
    throw new Error('Salt is required for ZK JWT guardian.');
  }
  let salt: bigint;
  try {
    salt = BigInt(trimmed);
  } catch {
    throw new Error('Salt must be a valid integer.');
  }
  if (salt <= 0n) {
    throw new Error('Salt must be greater than zero.');
  }
  return salt;
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
  const [zkjwtInputs, setZkjwtInputs] = useState<Record<string, { salt: string }>>(initialState.zkjwtInputs);
  const [zkjwtTokens, setZkjwtTokens] = useState<Record<string, ZkJwtTokenState>>({});
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
  const [localPasskeys, setLocalPasskeys] = useState<PasskeyMaterial[]>(() => listPasskeys());

  const publicClient = useMemo(() => getPublicClient(), []);
  const selectedGuardian = snapshot?.policy.guardians[selectedGuardianIndex];
  const activeSession = Boolean(snapshot?.isActive);
  const passkeysByIdentifier = useMemo(
    () => new Map(localPasskeys.map((passkey) => [passkey.identifier.toLowerCase(), passkey])),
    [localPasskeys],
  );
  const selectedPasskey =
    selectedGuardian?.guardianType === GuardianType.Passkey
      ? passkeysByIdentifier.get(selectedGuardian.identifier.toLowerCase()) ?? null
      : null;

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
  const selectedGuardianMissingLocalCredential = Boolean(
    selectedGuardian?.guardianType === GuardianType.Passkey && !selectedPasskey,
  );
  const selectedGuardianKey = selectedGuardian?.identifier.toLowerCase() ?? '';
  const selectedZkjwtInput = selectedGuardianKey ? zkjwtInputs[selectedGuardianKey] : undefined;
  const selectedZkjwtToken = selectedGuardianKey ? zkjwtTokens[selectedGuardianKey] : undefined;
  const selectedZkjwtTokenExpired = Boolean(
    selectedZkjwtToken?.exp && Math.floor(Date.now() / 1000) >= selectedZkjwtToken.exp,
  );
  const selectedGuardianMissingZkjwtInput = Boolean(
    selectedGuardian?.guardianType === GuardianType.ZkJWT &&
      !selectedZkjwtInput?.salt?.trim(),
  );
  const selectedGuardianMissingZkjwtToken = Boolean(
    selectedGuardian?.guardianType === GuardianType.ZkJWT && !selectedZkjwtToken,
  );
  const googleOauthClientId = (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined)?.trim() ?? '';
  const googleOauthConfigured = googleOauthClientId.length > 0;

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

  async function resolveIntent(walletAddress: Address, sourceSnapshot?: RecoverySnapshot): Promise<RecoveryIntent> {
    const resolvedSnapshot = sourceSnapshot ?? snapshot;
    if (!resolvedSnapshot) {
      throw new Error('Recovery manager not loaded');
    }

    const chainId = BigInt(await publicClient.getChainId());
    const readClient = createRecoveryClient({
      publicClient,
      recoveryManagerAddress: resolvedSnapshot.recoveryManager,
    });
    const nonce = await readClient.getNonce();

    if (resolvedSnapshot.isActive) {
      if (activeIntent) {
        return activeIntent;
      }
      return {
        wallet: walletAddress,
        newOwner: resolvedSnapshot.session.newOwner,
        nonce,
        deadline: resolvedSnapshot.session.deadline,
        chainId,
        recoveryManager: resolvedSnapshot.recoveryManager,
      };
    }

    if (!isAddress(newOwnerInput)) {
      throw new Error('New owner address is invalid');
    }

    const deadlineSecondsValue = Number(deadlineSeconds);
    if (!Number.isInteger(deadlineSecondsValue) || deadlineSecondsValue <= 0) {
      throw new Error('Deadline seconds must be a positive integer');
    }
    const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });

    return buildIntent({
      wallet: walletAddress,
      newOwner: getAddress(newOwnerInput),
      recoveryManager: resolvedSnapshot.recoveryManager,
      nonce,
      chainId,
      challengePeriodSeconds: resolvedSnapshot.policy.challengePeriod,
      deadlineSeconds: deadlineSecondsValue,
      nowSeconds: latestBlock.timestamp,
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

  function refreshLocalPasskeyState() {
    setLocalPasskeys(listPasskeys());
  }

  function updateSelectedZkjwtInput(patch: Partial<{ salt: string }>) {
    if (!selectedGuardian || selectedGuardian.guardianType !== GuardianType.ZkJWT) {
      return;
    }
    const key = selectedGuardian.identifier.toLowerCase();
    setZkjwtInputs((prev) => {
      const current = prev[key] ?? { salt: '' };
      return {
        ...prev,
        [key]: {
          ...current,
          ...patch,
        },
      };
    });
  }

  function clearSelectedZkjwtToken() {
    if (!selectedGuardian || selectedGuardian.guardianType !== GuardianType.ZkJWT) {
      return;
    }
    const key = selectedGuardian.identifier.toLowerCase();
    setZkjwtTokens((prev) => {
      if (!prev[key]) {
        return prev;
      }
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function generateSelectedGuardianProof(intent: RecoveryIntent) {
    if (!selectedGuardian) {
      throw new Error('Select a guardian');
    }

    const guardianIndex = BigInt(selectedGuardianIndex);
    if (selectedGuardian.guardianType === GuardianType.EOA) {
      const guardianWalletClient = getWalletClient(guardianPrivateKey);
      const adapter = createEoaAdapter(guardianWalletClient);
      const proofResult = await adapter.generateProof(intent, selectedGuardian.identifier);
      if (!proofResult.success || !proofResult.proof) {
        throw new Error(proofResult.error || 'Could not generate guardian proof');
      }

      return {
        guardianIndex,
        proof: proofResult.proof,
        submitterWalletClient: guardianWalletClient,
        guardianDescription: `Guardian #${selectedGuardianIndex} (EOA)`,
      };
    }

    if (selectedGuardian.guardianType === GuardianType.Passkey) {
      setStatus('Waiting for passkey approval...');
      const currentPasskey = passkeysByIdentifier.get(selectedGuardian.identifier.toLowerCase());
      if (!currentPasskey) {
        throw new Error(
          'Selected passkey guardian is not available in this browser. Use the browser/device where that passkey was enrolled.',
        );
      }

      const adapter = createPasskeyAdapter({
        rpId: currentPasskey.rpId,
        credentialId: currentPasskey.credentialId,
        publicKey: currentPasskey.publicKey,
      });
      const proofResult = await adapter.generateProof(intent, selectedGuardian.identifier);
      if (!proofResult.success || !proofResult.proof) {
        throw new Error(proofResult.error || 'Could not generate passkey proof');
      }

      return {
        guardianIndex,
        proof: proofResult.proof,
        submitterWalletClient: getWalletClient(executorPrivateKey),
        guardianDescription: `Guardian #${selectedGuardianIndex} (Passkey)`,
      };
    }

    if (selectedGuardian.guardianType === GuardianType.ZkJWT) {
      const key = selectedGuardian.identifier.toLowerCase();
      const zkjwtInput = zkjwtInputs[key];
      const salt = parseZkjwtSaltInput(zkjwtInput?.salt ?? '');
      const tokenState = zkjwtTokens[key];
      if (!tokenState) {
        throw new Error('Authenticate Google account for the selected ZK JWT guardian first.');
      }
      if (tokenState.exp && tokenState.exp <= Math.floor(Date.now() / 1000)) {
        throw new Error('Authenticated Google id_token is expired. Authenticate again.');
      }
      const computedCommitment = await computeZkJwtIdentifier(tokenState.email, salt);
      if (computedCommitment.toLowerCase() !== selectedGuardian.identifier.toLowerCase()) {
        throw new Error('Authenticated Google account does not match selected ZK JWT guardian commitment.');
      }

      const adapter = createZkJwtAdapter({
        jwt: tokenState.idToken,
        salt,
      });
      setStatus('Generating zkJWT proof...');
      const proofResult = await adapter.generateProof(intent, selectedGuardian.identifier);
      if (!proofResult.success || !proofResult.proof) {
        throw new Error(proofResult.error || 'Could not generate zkJWT proof');
      }

      return {
        guardianIndex,
        proof: proofResult.proof,
        submitterWalletClient: getWalletClient(executorPrivateKey),
        guardianDescription: `Guardian #${selectedGuardianIndex} (ZK JWT)`,
      };
    }

    throw new Error('Selected guardian type is not supported.');
  }

  async function clearExpiredRecoveryForWallet(walletAddress: Address): Promise<boolean> {
    const latestSnapshot = await loadRecoverySnapshot({
      publicClient,
      walletAddress,
    });

    if (!latestSnapshot || !latestSnapshot.isActive || latestSnapshot.status !== 'expired') {
      return false;
    }

    const helperWalletClient = getWalletClient(executorPrivateKey);
    const helperClient = createRecoveryClient({
      publicClient,
      walletClient: helperWalletClient,
      recoveryManagerAddress: latestSnapshot.recoveryManager,
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
    return true;
  }

  async function handleAuthenticateGoogle() {
    setError('');
    if (!selectedGuardian || selectedGuardian.guardianType !== GuardianType.ZkJWT) {
      setError('Selected guardian is not a ZK JWT guardian.');
      return;
    }
    if (!googleOauthConfigured) {
      setError('Google OAuth client ID is missing. Set VITE_GOOGLE_OAUTH_CLIENT_ID in example/aa-wallet/.env.');
      return;
    }

    try {
      parseZkjwtSaltInput(selectedZkjwtInput?.salt ?? '');
      setStatus('Opening Google sign-in popup...');
      const authResult = await requestGoogleIdTokenPopup({
        clientId: googleOauthClientId,
      });
      const idToken = authResult.idToken;
      const payload = decodeJwtPayload(idToken);
      if (typeof payload.nonce !== 'string' || payload.nonce !== authResult.nonce) {
        throw new Error('Google id_token nonce mismatch.');
      }
      const tokenEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
      if (!tokenEmail) {
        throw new Error('Google id_token is missing email claim.');
      }
      if (payload.email_verified !== true) {
        throw new Error('Google id_token has email_verified !== true.');
      }
      const exp = typeof payload.exp === 'number' ? payload.exp : null;
      if (exp && exp <= Math.floor(Date.now() / 1000)) {
        throw new Error('Google id_token is expired. Authenticate again.');
      }
      const salt = parseZkjwtSaltInput(selectedZkjwtInput?.salt ?? '');
      const computedCommitment = await computeZkJwtIdentifier(tokenEmail, salt);
      if (computedCommitment.toLowerCase() !== selectedGuardian.identifier.toLowerCase()) {
        throw new Error('Authenticated Google account does not match selected ZK JWT guardian commitment.');
      }

      const key = selectedGuardian.identifier.toLowerCase();
      setZkjwtTokens((prev) => ({
        ...prev,
        [key]: {
          idToken,
          email: tokenEmail,
          exp,
          issuedAt: new Date().toISOString(),
        },
      }));

      props.addActivity({
        label: 'Google authenticated for zkJWT guardian',
        details: `${shortHex(selectedGuardian.identifier)} (${tokenEmail})`,
      });
      setStatus(`Google authenticated as ${tokenEmail}`);
    } catch (authError) {
      setError(formatRecoverError(authError, 'Google authentication failed'));
      setStatus('Google authentication failed');
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
    if (selectedGuardianMissingLocalCredential) {
      setError('Selected passkey guardian is not available in this browser.');
      return;
    }
    if (selectedGuardianMissingZkjwtInput) {
      setError('Enter salt for the selected ZK JWT guardian.');
      return;
    }
    if (selectedGuardianMissingZkjwtToken) {
      setError('Authenticate Google account for the selected ZK JWT guardian.');
      return;
    }
    if (selectedZkjwtTokenExpired) {
      setError('Authenticated Google id_token is expired. Authenticate again.');
      return;
    }

    try {
      const walletAddress = getAddress(targetWalletInput);
      if (snapshot.isActive && snapshot.status === 'expired') {
        await clearExpiredRecoveryForWallet(walletAddress);
      }

      const latestSnapshot = await loadRecoverySnapshot({
        publicClient,
        walletAddress,
      });
      if (!latestSnapshot) {
        throw new Error('Recovery is not configured for this wallet.');
      }
      if (latestSnapshot.isActive) {
        throw new Error('Recovery already active. Use active session actions instead.');
      }

      const intent = await resolveIntent(walletAddress, latestSnapshot);
      const proofPayload = await generateSelectedGuardianProof(intent);

      const guardianClient = createRecoveryClient({
        publicClient,
        walletClient: proofPayload.submitterWalletClient,
        recoveryManagerAddress: latestSnapshot.recoveryManager,
      });

      setStatus('Submitting first guardian proof...');
      const hash = await guardianClient.startRecovery({
        intent,
        guardianIndex: proofPayload.guardianIndex,
        proof: proofPayload.proof,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      props.addActivity({
        label: 'Recovery started',
        txHash: hash,
        details: proofPayload.guardianDescription,
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
    if (snapshot.status === 'expired') {
      try {
        const walletAddress = getAddress(targetWalletInput);
        const cleared = await clearExpiredRecoveryForWallet(walletAddress);
        if (cleared) {
          setError('Expired session was cleared. Start a new recovery attempt.');
        } else {
          setError('Recovery session is expired. Start a new recovery attempt.');
        }
      } catch (clearError) {
        setError(formatRecoverError(clearError, 'Failed to clear expired recovery session'));
      }
      return;
    }
    if (selectedGuardianAlreadyApproved) {
      setError('This guardian already approved the active recovery session. Choose another guardian.');
      return;
    }
    if (selectedGuardianMissingLocalCredential) {
      setError('Selected passkey guardian is not available in this browser.');
      return;
    }
    if (selectedGuardianMissingZkjwtInput) {
      setError('Enter salt for the selected ZK JWT guardian.');
      return;
    }
    if (selectedGuardianMissingZkjwtToken) {
      setError('Authenticate Google account for the selected ZK JWT guardian.');
      return;
    }
    if (selectedZkjwtTokenExpired) {
      setError('Authenticated Google id_token is expired. Authenticate again.');
      return;
    }

    try {
      const walletAddress = getAddress(targetWalletInput);
      const intent = await resolveIntent(walletAddress);
      const proofPayload = await generateSelectedGuardianProof(intent);

      const guardianClient = createRecoveryClient({
        publicClient,
        walletClient: proofPayload.submitterWalletClient,
        recoveryManagerAddress: snapshot.recoveryManager,
      });

      setStatus('Submitting guardian approval...');
      const hash = await guardianClient.submitProof({
        guardianIndex: proofPayload.guardianIndex,
        proof: proofPayload.proof,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      props.addActivity({
        label: 'Recovery proof submitted',
        txHash: hash,
        details: proofPayload.guardianDescription,
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
    if (!isAddress(targetWalletInput)) {
      setError('Target wallet address is invalid');
      return;
    }

    try {
      const walletAddress = getAddress(targetWalletInput);
      const cleared = await clearExpiredRecoveryForWallet(walletAddress);
      if (!cleared) {
        setError('Recovery session is not expired or not active.');
      }
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
    refreshLocalPasskeyState();
    setStatus('Session refreshed');
  }

  useEffect(() => {
    refreshLocalPasskeyState();

    function handleStorage(event: StorageEvent) {
      if (event.key === null || event.key === 'aa-wallet-demo-passkeys-v1') {
        refreshLocalPasskeyState();
      }
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

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
        zkjwtInputs,
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
    zkjwtInputs,
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

        {selectedGuardian?.guardianType === GuardianType.EOA ? (
          <label className="field">
            <span>3. Guardian signer (must match selected EOA guardian)</span>
            <select value={guardianPrivateKey} onChange={(event) => setGuardianPrivateKey(event.target.value as Hex)}>
              {DEMO_ACCOUNTS.map((account) => (
                <option key={account.address} value={account.privateKey}>
                  {account.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {selectedGuardian?.guardianType === GuardianType.Passkey ? (
          <div className="subpanel">
            <h3>3. Passkey guardian</h3>
            <p className="muted">Passkey proof is generated via WebAuthn prompt. Tx is submitted by helper signer below.</p>
            <div className="stats one-col">
              <div>
                <span>Selected guardian identifier</span>
                <strong>{shortHex(selectedGuardian.identifier)}</strong>
              </div>
              <div>
                <span>Local passkey</span>
                <strong>{selectedPasskey ? `${selectedPasskey.label} (${selectedPasskey.rpId})` : 'Not available on this browser'}</strong>
              </div>
            </div>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={refreshLocalPasskeyState}
                title="Reload passkeys from local browser storage"
              >
                Refresh Local Passkeys ({localPasskeys.length})
              </button>
            </div>
          </div>
        ) : null}

        {selectedGuardian?.guardianType === GuardianType.ZkJWT ? (
          <div className="subpanel">
            <h3>3. ZK JWT guardian</h3>
            <p className="muted">Enter salt, then authenticate Google in a popup. JWT stays client-side and is used for ZK proof generation.</p>
            <label className="field">
              <span>Salt shared by wallet owner</span>
              <input
                value={selectedZkjwtInput?.salt ?? ''}
                onChange={(event) => updateSelectedZkjwtInput({ salt: event.target.value })}
                placeholder="e.g. 123456789"
              />
            </label>

            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={() => void handleAuthenticateGoogle()}
                disabled={!googleOauthConfigured}
                title="Open Google OAuth popup and cache id_token in browser memory"
              >
                Authenticate Google
              </button>
              <button
                type="button"
                className="secondary"
                onClick={clearSelectedZkjwtToken}
                disabled={!selectedZkjwtToken}
                title="Forget cached Google token for this guardian"
              >
                Clear Google Token
              </button>
            </div>

            {!googleOauthConfigured ? (
              <p className="error">Set `VITE_GOOGLE_OAUTH_CLIENT_ID` in `example/aa-wallet/.env` to enable Google popup auth.</p>
            ) : null}
            <div className="stats one-col">
              <div>
                <span>Selected guardian commitment</span>
                <strong>{shortHex(selectedGuardian.identifier)}</strong>
              </div>
              <div>
                <span>Authenticated Google account</span>
                <strong>{selectedZkjwtToken ? selectedZkjwtToken.email : 'Not authenticated'}</strong>
              </div>
              <div>
                <span>Token expiry</span>
                <strong>
                  {selectedZkjwtToken?.exp ? new Date(selectedZkjwtToken.exp * 1000).toLocaleString() : 'Unknown'}
                  {selectedZkjwtTokenExpired ? ' (expired)' : ''}
                </strong>
              </div>
            </div>
          </div>
        ) : null}

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
        {selectedGuardianMissingLocalCredential ? (
          <p className="error">
            Selected passkey guardian is not available in this browser. Use the same browser/device that enrolled it.
          </p>
        ) : null}
        {selectedZkjwtTokenExpired ? <p className="error">Cached Google id_token is expired. Authenticate again.</p> : null}

        <div className="actions">
          <button
            type="button"
            onClick={handleStartRecovery}
            disabled={
              !snapshot ||
              (activeSession && snapshot.status !== 'expired') ||
              selectedGuardianMissingLocalCredential ||
              selectedGuardianMissingZkjwtInput ||
              selectedGuardianMissingZkjwtToken ||
              selectedZkjwtTokenExpired
            }
            title="Create a new recovery session and submit the first guardian proof"
          >
            Start Recovery
          </button>
          <button
            type="button"
            onClick={handleSubmitProof}
            disabled={
              !snapshot ||
              !activeSession ||
              snapshot.status === 'expired' ||
              selectedGuardianAlreadyApproved ||
              selectedGuardianMissingLocalCredential ||
              selectedGuardianMissingZkjwtInput ||
              selectedGuardianMissingZkjwtToken ||
              selectedZkjwtTokenExpired
            }
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
            {!snapshot.isActive ? <p className="muted">No approvals are tracked until a recovery session is started.</p> : null}
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
                    {snapshot.isActive ? (
                      <span className={guardianApprovals[index] ? 'approval-chip approved' : 'approval-chip pending'}>
                        {guardianApprovals[index] ? 'Approved' : 'Pending'}
                      </span>
                    ) : (
                      <span className="approval-chip idle">No Active Session</span>
                    )}
                  </div>
                  <span>Type: {toGuardianTypeLabel(guardian.guardianType)}</span>
                  <code>{guardian.guardianType === GuardianType.EOA ? bytes32ToAddress(guardian.identifier) : guardian.identifier}</code>
                  {guardian.guardianType === GuardianType.Passkey ? (
                    <span className="muted">
                      Local credential:{' '}
                      {passkeysByIdentifier.get(guardian.identifier.toLowerCase())
                        ? passkeysByIdentifier.get(guardian.identifier.toLowerCase())?.label
                        : 'Missing on this browser'}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </article>
    </section>
  );
}
