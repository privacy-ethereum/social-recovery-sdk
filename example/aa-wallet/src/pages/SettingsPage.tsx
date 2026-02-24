import { useEffect, useMemo, useState } from 'react';
import { GuardianType, type RecoveryPolicy } from '@pse/social-recovery-sdk';
import { anvil } from 'viem/chains';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { DEMO_ACCOUNTS, getPublicClient, getWalletClient } from '../lib/chain';
import { DEPLOYMENT, ExampleAAWalletAbi, bytes32ToAddress, isConfiguredAddress } from '../lib/contracts';
import { buildGuardianPolicy, normalizeGuardianAddresses, toGuardianTypeLabel, type GuardianKind } from '../lib/policy';
import { enrollPasskey, getDefaultRpId, listPasskeys, type PasskeyMaterial } from '../lib/passkeys';
import { createRecoveryClient, lookupRecoveryManager } from '../lib/recovery';

interface SettingsPageProps {
  walletAddress: Address | '';
  setWalletAddress: (wallet: Address | '') => void;
  recoveryManagerAddress: Address | '';
  setRecoveryManagerAddress: (value: Address | '') => void;
  addActivity: (input: { label: string; details?: string; txHash?: Hex }) => void;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SETTINGS_STORAGE_KEY = 'aa-wallet-demo-settings-state-v1';

interface GuardianDraft {
  id: string;
  type: GuardianKind;
  identifier: string;
  passkeyId: string;
}

interface PersistedSettingsState {
  selectedOwnerPrivateKey: Hex;
  walletInput: string;
  guardians: GuardianDraft[];
  threshold: string;
  challengePeriod: string;
}

const KNOWN_PRIVATE_KEYS = new Set<Hex>(DEMO_ACCOUNTS.map((account) => account.privateKey));

function createGuardianDraftId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `guardian-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createGuardianDraft(identifier = ''): GuardianDraft {
  return {
    id: createGuardianDraftId(),
    type: 'eoa',
    identifier,
    passkeyId: '',
  };
}

function defaultGuardianDrafts(): GuardianDraft[] {
  return [createGuardianDraft(DEMO_ACCOUNTS[1].address), createGuardianDraft(DEMO_ACCOUNTS[2].address)];
}

function normalizePrivateKey(value: unknown, fallback: Hex): Hex {
  if (typeof value !== 'string') {
    return fallback;
  }
  return KNOWN_PRIVATE_KEYS.has(value as Hex) ? (value as Hex) : fallback;
}

function normalizeGuardianDraft(value: unknown): GuardianDraft | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<GuardianDraft>;
  if (
    typeof candidate.id !== 'string' ||
    (candidate.type !== 'eoa' && candidate.type !== 'passkey' && candidate.type !== 'zkjwt') ||
    typeof candidate.identifier !== 'string' ||
    typeof candidate.passkeyId !== 'string'
  ) {
    return null;
  }

  return {
    id: candidate.id,
    type: candidate.type,
    identifier: candidate.identifier,
    passkeyId: candidate.passkeyId,
  };
}

function loadPersistedSettingsState(): PersistedSettingsState {
  if (typeof window === 'undefined') {
    return {
      selectedOwnerPrivateKey: DEMO_ACCOUNTS[0].privateKey,
      walletInput: '',
      guardians: defaultGuardianDrafts(),
      threshold: '2',
      challengePeriod: '600',
    };
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        selectedOwnerPrivateKey: DEMO_ACCOUNTS[0].privateKey,
        walletInput: '',
        guardians: defaultGuardianDrafts(),
        threshold: '2',
        challengePeriod: '600',
      };
    }

    const parsed = JSON.parse(raw) as Partial<PersistedSettingsState>;
    const guardians = Array.isArray(parsed.guardians)
      ? parsed.guardians
          .map((entry) => normalizeGuardianDraft(entry))
          .filter((entry): entry is GuardianDraft => entry !== null)
      : [];

    return {
      selectedOwnerPrivateKey: normalizePrivateKey(parsed.selectedOwnerPrivateKey, DEMO_ACCOUNTS[0].privateKey),
      walletInput: typeof parsed.walletInput === 'string' ? parsed.walletInput : '',
      guardians: guardians.length > 0 ? guardians : defaultGuardianDrafts(),
      threshold: typeof parsed.threshold === 'string' && parsed.threshold.length > 0 ? parsed.threshold : '2',
      challengePeriod:
        typeof parsed.challengePeriod === 'string' && parsed.challengePeriod.length > 0 ? parsed.challengePeriod : '600',
    };
  } catch {
    return {
      selectedOwnerPrivateKey: DEMO_ACCOUNTS[0].privateKey,
      walletInput: '',
      guardians: defaultGuardianDrafts(),
      threshold: '2',
      challengePeriod: '600',
    };
  }
}

function formatSettingsError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message || fallback;
  if (message.includes('WebAuthn is not supported')) {
    return 'WebAuthn is not available in this browser/environment.';
  }
  if (message.includes('Failed to create passkey credential')) {
    return 'Passkey enrollment failed. Make sure browser passkeys are enabled.';
  }
  if (
    message.includes('The operation either timed out or was not allowed') ||
    message.includes('NotAllowedError')
  ) {
    return 'Passkey enrollment was cancelled or timed out.';
  }

  const firstLine = message.split('\n')[0].trim();
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

export function SettingsPage(props: SettingsPageProps) {
  const initialState = useMemo(() => loadPersistedSettingsState(), []);
  const [selectedOwnerPrivateKey, setSelectedOwnerPrivateKey] = useState<Hex>(initialState.selectedOwnerPrivateKey);
  const [walletInput, setWalletInput] = useState<string>(props.walletAddress || initialState.walletInput);
  const [guardians, setGuardians] = useState<GuardianDraft[]>(initialState.guardians);
  const [threshold, setThreshold] = useState<string>(initialState.threshold);
  const [challengePeriod, setChallengePeriod] = useState<string>(initialState.challengePeriod);
  const [status, setStatus] = useState<string>('Load wallet and configure policy');
  const [error, setError] = useState<string>('');
  const [walletOwner, setWalletOwner] = useState<Address | ''>('');
  const [currentPolicy, setCurrentPolicy] = useState<RecoveryPolicy | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyMaterial[]>(() => listPasskeys());

  const publicClient = useMemo(() => getPublicClient(), []);
  const ownerWalletClient = useMemo(() => getWalletClient(selectedOwnerPrivateKey), [selectedOwnerPrivateKey]);
  const signerAddress = ownerWalletClient.account?.address;
  const signerIsOwner = Boolean(signerAddress && walletOwner && signerAddress.toLowerCase() === walletOwner.toLowerCase());
  const passkeyById = useMemo(() => new Map(passkeys.map((passkey) => [passkey.id, passkey])), [passkeys]);
  const passkeyByIdentifier = useMemo(
    () => new Map(passkeys.map((passkey) => [passkey.identifier.toLowerCase(), passkey])),
    [passkeys],
  );

  function mapPolicyToGuardianDrafts(policy: RecoveryPolicy): GuardianDraft[] {
    const next = policy.guardians.map((guardian) => {
      if (guardian.guardianType === GuardianType.EOA) {
        return createGuardianDraft(bytes32ToAddress(guardian.identifier));
      }

      if (guardian.guardianType === GuardianType.Passkey) {
        const localPasskey = passkeyByIdentifier.get(guardian.identifier.toLowerCase());
        return {
          id: createGuardianDraftId(),
          type: 'passkey' as const,
          identifier: guardian.identifier,
          passkeyId: localPasskey?.id ?? '',
        };
      }

      return {
        id: createGuardianDraftId(),
        type: 'zkjwt' as const,
        identifier: guardian.identifier,
        passkeyId: '',
      };
    });

    return next.length > 0 ? next : defaultGuardianDrafts();
  }

  function applyPolicyToForm(policy: RecoveryPolicy) {
    setGuardians(mapPolicyToGuardianDrafts(policy));
    setThreshold(policy.threshold.toString());
    setChallengePeriod(policy.challengePeriod.toString());
  }

  function syncPasskeys() {
    setPasskeys(listPasskeys());
  }

  function resolveWalletAddress(): Address {
    if (props.walletAddress) {
      return props.walletAddress;
    }
    if (!isAddress(walletInput)) {
      throw new Error('Wallet address is required');
    }
    return getAddress(walletInput);
  }

  async function refreshWalletOwner(walletAddress: Address) {
    const owner = await publicClient.readContract({
      address: walletAddress,
      abi: ExampleAAWalletAbi,
      functionName: 'owner',
    });
    setWalletOwner(owner);
    return owner;
  }

  function addGuardian() {
    setGuardians((prev) => [...prev, createGuardianDraft()]);
  }

  function updateGuardian(guardianId: string, patch: Partial<Omit<GuardianDraft, 'id'>>) {
    setGuardians((prev) =>
      prev.map((guardian) => (guardian.id === guardianId ? { ...guardian, ...patch } : guardian)),
    );
  }

  function updateGuardianType(guardianId: string, nextType: GuardianKind) {
    const defaultPasskey = passkeys[0];
    setGuardians((prev) =>
      prev.map((guardian) => {
        if (guardian.id !== guardianId) {
          return guardian;
        }

        if (nextType === 'passkey') {
          return {
            ...guardian,
            type: nextType,
            passkeyId: defaultPasskey?.id ?? '',
            identifier: defaultPasskey?.identifier ?? '',
          };
        }

        if (nextType === 'zkjwt') {
          return {
            ...guardian,
            type: nextType,
            passkeyId: '',
            identifier: '',
          };
        }

        return {
          ...guardian,
          type: nextType,
          passkeyId: '',
          identifier: guardian.type === 'eoa' ? guardian.identifier : '',
        };
      }),
    );
  }

  function updateGuardianPasskey(guardianId: string, passkeyId: string) {
    const selected = passkeyById.get(passkeyId);
    updateGuardian(guardianId, {
      passkeyId,
      identifier: selected?.identifier ?? '',
    });
  }

  function removeGuardian(guardianId: string) {
    setGuardians((prev) => {
      const next = prev.filter((guardian) => guardian.id !== guardianId);
      return next.length > 0 ? next : [createGuardianDraft()];
    });
  }

  function parsePolicyInput(walletAddress: Address) {
    const normalizedEoaGuardians = normalizeGuardianAddresses(
      guardians.filter((guardian) => guardian.type === 'eoa').map((guardian) => guardian.identifier),
    );

    const configuredPasskeyGuardians = guardians
      .filter((guardian) => guardian.type === 'passkey')
      .map((guardian) => {
        if (!guardian.passkeyId) {
          throw new Error('Select a local passkey for each Passkey guardian row.');
        }
        const selectedPasskey = passkeyById.get(guardian.passkeyId);
        if (!selectedPasskey) {
          throw new Error('Selected passkey was not found in local storage. Re-enroll or refresh passkeys.');
        }
        return selectedPasskey;
      });

    const unsupportedGuardians = guardians.filter((guardian) => guardian.type === 'zkjwt' && guardian.identifier.trim());
    if (unsupportedGuardians.length > 0) {
      throw new Error('ZK JWT guardians will be enabled in Phase 3.');
    }

    const totalGuardians = normalizedEoaGuardians.length + configuredPasskeyGuardians.length;
    if (totalGuardians === 0) {
      throw new Error('At least one guardian is required');
    }

    const thresholdValue = BigInt(threshold);
    if (thresholdValue <= 0n) {
      throw new Error('Threshold must be greater than zero');
    }
    if (thresholdValue > BigInt(totalGuardians)) {
      throw new Error('Threshold cannot exceed the number of configured guardians');
    }

    const challengePeriodValue = BigInt(challengePeriod);
    if (challengePeriodValue < 0n) {
      throw new Error('Challenge period cannot be negative');
    }

    return buildGuardianPolicy({
      wallet: walletAddress,
      guardians: [
        ...normalizedEoaGuardians.map((address) => ({ type: 'eoa' as const, address })),
        ...configuredPasskeyGuardians.map((passkey) => ({
          type: 'passkey' as const,
          passkeyPublicKey: passkey.publicKey,
        })),
      ],
      threshold: thresholdValue,
      challengePeriod: challengePeriodValue,
    });
  }

  async function refreshRecoveryConfiguration(targetWallet?: Address) {
    const walletAddress = targetWallet ?? resolveWalletAddress();
    await refreshWalletOwner(walletAddress);

    const recoveryManager = await lookupRecoveryManager(publicClient, walletAddress);
    if (recoveryManager.toLowerCase() === ZERO_ADDRESS) {
      props.setRecoveryManagerAddress('');
      setCurrentPolicy(null);
      setStatus('Recovery manager not deployed yet');
      return;
    }

    props.setRecoveryManagerAddress(recoveryManager);
    const client = createRecoveryClient({
      publicClient,
      recoveryManagerAddress: recoveryManager,
    });
    const policy = await client.getPolicy();
    setCurrentPolicy(policy);
    applyPolicyToForm(policy);
    setStatus('Loaded wallet and recovery policy');
  }

  async function handleLoadWallet() {
    setError('');
    try {
      const walletAddress = resolveWalletAddress();
      props.setWalletAddress(walletAddress);
      await refreshRecoveryConfiguration(walletAddress);
    } catch (loadError) {
      setError(formatSettingsError(loadError, 'Failed to load wallet'));
    }
  }

  async function handleEnrollPasskey(guardianId: string) {
    setError('');
    try {
      setStatus('Opening passkey enrollment prompt...');
      const created = await enrollPasskey({
        rpId: getDefaultRpId(),
      });
      syncPasskeys();
      updateGuardian(guardianId, { passkeyId: created.id, identifier: created.identifier });

      props.addActivity({
        label: 'Passkey enrolled',
        details: `${created.label} (${shortHex(created.identifier)})`,
      });
      setStatus('Passkey enrolled');
    } catch (enrollError) {
      setError(formatSettingsError(enrollError, 'Passkey enrollment failed'));
      setStatus('Passkey enrollment failed');
    }
  }

  async function handleDeployRecoveryManager() {
    setError('');
    if (!isConfiguredAddress(DEPLOYMENT.contracts.recoveryManagerFactory)) {
      setError('RecoveryManagerFactory is not configured. Run local deployment first.');
      return;
    }

    try {
      const walletAddress = resolveWalletAddress();
      const owner = await refreshWalletOwner(walletAddress);
      if (!signerAddress || signerAddress.toLowerCase() !== owner.toLowerCase()) {
        throw new Error('Selected signer is not current wallet owner.');
      }

      const existing = await lookupRecoveryManager(publicClient, walletAddress);
      if (existing.toLowerCase() !== ZERO_ADDRESS) {
        props.setRecoveryManagerAddress(existing);
        await refreshRecoveryConfiguration(walletAddress);
        setStatus('Recovery manager already exists for this wallet');
        return;
      }

      const policy = parsePolicyInput(walletAddress);
      const ownerClient = createRecoveryClient({
        publicClient,
        walletClient: ownerWalletClient,
      });

      setStatus('Deploying wallet-specific recovery manager...');
      const recoveryManagerAddress = await ownerClient.deployRecoveryManager(policy);
      props.setRecoveryManagerAddress(recoveryManagerAddress);
      setCurrentPolicy(policy);
      props.addActivity({ label: 'Recovery manager deployed', details: recoveryManagerAddress });
      setStatus('Recovery manager deployed');
    } catch (deployError) {
      setError(formatSettingsError(deployError, 'Recovery manager deployment failed'));
      setStatus('Deploy failed');
    }
  }

  async function handleAuthorizeRecoveryManager() {
    setError('');
    if (!props.walletAddress) {
      setError('Wallet address is required');
      return;
    }
    if (!props.recoveryManagerAddress) {
      setError('Deploy or load a recovery manager first');
      return;
    }
    if (!signerIsOwner) {
      setError('Selected signer must be the current wallet owner');
      return;
    }

    try {
      setStatus('Authorizing recovery manager on wallet...');
      const hash = await ownerWalletClient.writeContract({
        account: ownerWalletClient.account!,
        chain: anvil,
        address: props.walletAddress,
        abi: ExampleAAWalletAbi,
        functionName: 'authorizeRecoveryManager',
        args: [props.recoveryManagerAddress],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      props.addActivity({
        label: 'Recovery manager authorized',
        txHash: hash,
        details: props.recoveryManagerAddress,
      });
      setStatus('Recovery manager authorized');
    } catch (authError) {
      setError(formatSettingsError(authError, 'Authorization failed'));
      setStatus('Authorize failed');
    }
  }

  async function handleUpdatePolicy() {
    setError('');
    if (!props.recoveryManagerAddress) {
      setError('Deploy or load recovery manager first');
      return;
    }
    if (!signerIsOwner) {
      setError('Selected signer must be the current wallet owner');
      return;
    }

    try {
      const walletAddress = resolveWalletAddress();
      const policy = parsePolicyInput(walletAddress);
      const ownerClient = createRecoveryClient({
        publicClient,
        walletClient: ownerWalletClient,
        recoveryManagerAddress: props.recoveryManagerAddress,
      });

      setStatus('Updating policy...');
      const hash = await ownerClient.updatePolicy({
        guardians: policy.guardians,
        threshold: policy.threshold,
        challengePeriod: policy.challengePeriod,
      });
      await publicClient.waitForTransactionReceipt({ hash });

      props.addActivity({
        label: 'Policy updated',
        txHash: hash,
        details: `${policy.guardians.length} guardians / threshold ${policy.threshold.toString()}`,
      });
      await refreshRecoveryConfiguration(walletAddress);
      setStatus('Policy updated');
    } catch (updateError) {
      setError(formatSettingsError(updateError, 'Failed to update policy'));
      setStatus('Update failed');
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const nextState: PersistedSettingsState = {
      selectedOwnerPrivateKey,
      walletInput,
      guardians,
      threshold,
      challengePeriod,
    };
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextState));
  }, [challengePeriod, guardians, selectedOwnerPrivateKey, threshold, walletInput]);

  useEffect(() => {
    if (props.walletAddress) {
      setWalletInput(props.walletAddress);
      void refreshRecoveryConfiguration(props.walletAddress);
    }
  }, [props.walletAddress]);

  useEffect(() => {
    setGuardians((prev) => {
      let changed = false;
      const next = prev.map((guardian) => {
        if (guardian.type !== 'passkey' || !guardian.identifier) {
          return guardian;
        }

        const match = passkeyByIdentifier.get(guardian.identifier.toLowerCase());
        const resolvedPasskeyId = match?.id ?? '';
        if (guardian.passkeyId === resolvedPasskeyId) {
          return guardian;
        }

        changed = true;
        return {
          ...guardian,
          passkeyId: resolvedPasskeyId,
        };
      });

      return changed ? next : prev;
    });
  }, [passkeyByIdentifier]);

  useEffect(() => {
    syncPasskeys();

    function handleStorage(event: StorageEvent) {
      if (event.key === null || event.key === 'aa-wallet-demo-passkeys-v1') {
        syncPasskeys();
      }
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return (
    <section className="panel-grid two-col">
      <article className="panel">
        <h2>Recovery Setup</h2>
        <p className="muted">Configure guardians and deploy one recovery manager per wallet.</p>

        <label className="field">
          <span>1. Wallet owner signer</span>
          <select
            value={selectedOwnerPrivateKey}
            onChange={(event) => setSelectedOwnerPrivateKey(event.target.value as Hex)}
          >
            {DEMO_ACCOUNTS.map((account) => (
              <option key={account.address} value={account.privateKey}>
                {account.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>2. Wallet address</span>
          <div className="row gap-sm">
            <input value={walletInput} onChange={(event) => setWalletInput(event.target.value)} placeholder="0x..." />
            <button
              type="button"
              className="secondary"
              onClick={handleLoadWallet}
              title="Load this wallet and fetch owner + recovery manager info"
            >
              Load
            </button>
          </div>
        </label>

        <div className="stats one-col">
          <div>
            <span>Signer address</span>
            <strong>{signerAddress ?? '-'}</strong>
          </div>
          <div>
            <span>Wallet owner</span>
            <strong>{walletOwner || '-'}</strong>
          </div>
          <div>
            <span>Signer is owner</span>
            <strong>{signerIsOwner ? 'Yes' : 'No'}</strong>
          </div>
          <div>
            <span>Recovery manager</span>
            <strong>{props.recoveryManagerAddress || 'Not deployed'}</strong>
          </div>
        </div>

        <div className="subpanel">
          <h3>3. Guardians</h3>
          <ul className="guardian-builder-list">
            {guardians.map((guardian, index) => (
              <li key={guardian.id} className="guardian-builder-row">
                <div className="guardian-builder-head">
                  <span className="guardian-chip">Guardian {index + 1}</span>
                  <div className="row gap-sm">
                    <select
                      value={guardian.type}
                      onChange={(event) => updateGuardianType(guardian.id, event.target.value as GuardianKind)}
                    >
                      <option value="eoa">EOA</option>
                      <option value="passkey">Passkey</option>
                      <option value="zkjwt" disabled>
                        ZK JWT (Phase 3)
                      </option>
                    </select>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => removeGuardian(guardian.id)}
                      title="Remove this guardian row"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="guardian-builder-input">
                  {guardian.type === 'eoa' ? (
                    <input
                      value={guardian.identifier}
                      onChange={(event) => updateGuardian(guardian.id, { identifier: event.target.value })}
                      placeholder="0x..."
                    />
                  ) : null}

                  {guardian.type === 'passkey' ? (
                    <div className="guardian-passkey-row">
                      <select
                        value={guardian.passkeyId}
                        onChange={(event) => updateGuardianPasskey(guardian.id, event.target.value)}
                      >
                        <option value="">Select local passkey</option>
                        {passkeys.map((passkey) => (
                          <option key={passkey.id} value={passkey.id}>
                            {passkey.label} ({shortHex(passkey.identifier)})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void handleEnrollPasskey(guardian.id)}
                        title="Enroll a new passkey and assign it to this row"
                      >
                        Enroll
                      </button>
                    </div>
                  ) : null}

                  {guardian.type === 'zkjwt' ? (
                    <input
                      value={guardian.identifier}
                      onChange={(event) => updateGuardian(guardian.id, { identifier: event.target.value })}
                      placeholder="ZK JWT commitment (Phase 3)"
                      disabled
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <div className="actions centered">
            <button type="button" className="secondary" onClick={addGuardian} title="Add another guardian row">
              Add guardian
            </button>
            <button type="button" className="secondary" onClick={syncPasskeys} title="Reload local passkeys">
              Refresh passkeys
            </button>
          </div>
        </div>

        <div className="row gap-sm">
          <label className="field compact">
            <span>Threshold</span>
            <input value={threshold} onChange={(event) => setThreshold(event.target.value)} />
          </label>
          <label className="field compact">
            <span>Challenge period (seconds)</span>
            <input value={challengePeriod} onChange={(event) => setChallengePeriod(event.target.value)} />
          </label>
        </div>

        <div className="actions">
          <button
            type="button"
            onClick={handleDeployRecoveryManager}
            title="Deploy a dedicated RecoveryManager contract for this wallet"
          >
            4. Deploy Recovery Manager
          </button>
          <button
            type="button"
            onClick={handleAuthorizeRecoveryManager}
            title="Authorize the RecoveryManager on the wallet so it can call setOwner during recovery"
          >
            5. Authorize Manager on Wallet
          </button>
          <button type="button" onClick={handleUpdatePolicy} title="Update guardians, threshold, or challenge period">
            Update Policy
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void refreshRecoveryConfiguration()}
            title="Reload wallet owner, recovery manager, and current policy from chain"
          >
            Refresh
          </button>
        </div>

        <p className="muted">Status: {status}</p>
        {error ? <p className="error">{error}</p> : null}
      </article>

      <article className="panel">
        <h2>Current On-Chain Policy</h2>
        {!currentPolicy ? <p className="muted">No policy loaded for selected wallet.</p> : null}

        {currentPolicy ? (
          <>
            <div className="stats one-col">
              <div>
                <span>Wallet</span>
                <strong>{currentPolicy.wallet}</strong>
              </div>
              <div>
                <span>Threshold</span>
                <strong>{currentPolicy.threshold.toString()}</strong>
              </div>
              <div>
                <span>Challenge period</span>
                <strong>{currentPolicy.challengePeriod.toString()}s</strong>
              </div>
              <div>
                <span>Total guardians</span>
                <strong>{currentPolicy.guardians.length}</strong>
              </div>
            </div>

            <ul className="guardian-list">
              {currentPolicy.guardians.map((guardian, index) => {
                const localPasskey =
                  guardian.guardianType === GuardianType.Passkey
                    ? passkeyByIdentifier.get(guardian.identifier.toLowerCase())
                    : null;
                return (
                  <li key={`${guardian.identifier}-${index}`}>
                    <span>
                      Guardian #{index} ({toGuardianTypeLabel(guardian.guardianType)})
                    </span>
                    <code>
                      {guardian.guardianType === GuardianType.EOA
                        ? bytes32ToAddress(guardian.identifier)
                        : guardian.identifier}
                    </code>
                    {localPasskey ? <span className="muted">Local passkey: {localPasskey.label}</span> : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </article>
    </section>
  );
}
