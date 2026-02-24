import { useEffect, useMemo, useState } from 'react';
import type { RecoveryPolicy } from '@pse/social-recovery-sdk';
import { anvil } from 'viem/chains';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { DEMO_ACCOUNTS, getPublicClient, getWalletClient } from '../lib/chain';
import { DEPLOYMENT, ExampleAAWalletAbi, bytes32ToAddress, isConfiguredAddress } from '../lib/contracts';
import { buildEoaPolicy, normalizeGuardianAddresses, toGuardianTypeLabel, type GuardianKind } from '../lib/policy';
import { createRecoveryClient, lookupRecoveryManager } from '../lib/recovery';

interface SettingsPageProps {
  walletAddress: Address | '';
  setWalletAddress: (wallet: Address | '') => void;
  recoveryManagerAddress: Address | '';
  setRecoveryManagerAddress: (value: Address | '') => void;
  addActivity: (input: { label: string; details?: string; txHash?: Hex }) => void;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

interface GuardianDraft {
  id: string;
  type: GuardianKind;
  identifier: string;
}

function createGuardianDraft(identifier = ''): GuardianDraft {
  return {
    id: crypto.randomUUID(),
    type: 'eoa',
    identifier,
  };
}

export function SettingsPage(props: SettingsPageProps) {
  const [selectedOwnerPrivateKey, setSelectedOwnerPrivateKey] = useState<Hex>(DEMO_ACCOUNTS[0].privateKey);
  const [walletInput, setWalletInput] = useState<string>(props.walletAddress || '');
  const [guardians, setGuardians] = useState<GuardianDraft[]>([
    createGuardianDraft(DEMO_ACCOUNTS[1].address),
    createGuardianDraft(DEMO_ACCOUNTS[2].address),
  ]);
  const [threshold, setThreshold] = useState<string>('2');
  const [challengePeriod, setChallengePeriod] = useState<string>('600');
  const [status, setStatus] = useState<string>('Load wallet and configure policy');
  const [error, setError] = useState<string>('');
  const [walletOwner, setWalletOwner] = useState<Address | ''>('');
  const [currentPolicy, setCurrentPolicy] = useState<RecoveryPolicy | null>(null);

  const publicClient = useMemo(() => getPublicClient(), []);
  const ownerWalletClient = useMemo(() => getWalletClient(selectedOwnerPrivateKey), [selectedOwnerPrivateKey]);
  const signerAddress = ownerWalletClient.account?.address;
  const signerIsOwner = Boolean(signerAddress && walletOwner && signerAddress.toLowerCase() === walletOwner.toLowerCase());

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

  function removeGuardian(guardianId: string) {
    setGuardians((prev) => {
      const next = prev.filter((guardian) => guardian.id !== guardianId);
      return next.length > 0 ? next : [createGuardianDraft()];
    });
  }

  function parsePolicyInput(walletAddress: Address) {
    const supportedGuardians = guardians.filter((guardian) => guardian.type === 'eoa');
    const unsupportedGuardians = guardians.filter((guardian) => guardian.type !== 'eoa' && guardian.identifier.trim());
    if (unsupportedGuardians.length > 0) {
      throw new Error('Passkey and ZK JWT guardians will be enabled in later phases. Use EOA guardians for now.');
    }

    const guardianAddresses = normalizeGuardianAddresses(supportedGuardians.map((guardian) => guardian.identifier));
    if (guardianAddresses.length === 0) {
      throw new Error('At least one guardian address is required');
    }

    const thresholdValue = BigInt(threshold);
    if (thresholdValue <= 0n) {
      throw new Error('Threshold must be greater than zero');
    }
    if (thresholdValue > BigInt(guardianAddresses.length)) {
      throw new Error('Threshold cannot exceed the number of EOA guardians');
    }

    const challengePeriodValue = BigInt(challengePeriod);
    if (challengePeriodValue < 0n) {
      throw new Error('Challenge period cannot be negative');
    }

    return buildEoaPolicy({
      wallet: walletAddress,
      guardians: guardianAddresses,
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
    setStatus('Loaded wallet and recovery policy');
  }

  async function handleLoadWallet() {
    setError('');
    try {
      const walletAddress = resolveWalletAddress();
      props.setWalletAddress(walletAddress);
      await refreshRecoveryConfiguration(walletAddress);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load wallet');
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
      setError(deployError instanceof Error ? deployError.message : 'Recovery manager deployment failed');
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
      setError(authError instanceof Error ? authError.message : 'Authorization failed');
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
      setError(updateError instanceof Error ? updateError.message : 'Failed to update policy');
      setStatus('Update failed');
    }
  }

  useEffect(() => {
    if (props.walletAddress) {
      setWalletInput(props.walletAddress);
      void refreshRecoveryConfiguration(props.walletAddress);
    }
  }, [props.walletAddress]);

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
            <button type="button" className="secondary" onClick={handleLoadWallet} title="Load this wallet and fetch owner + recovery manager info">
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
          <p className="muted">Add guardians with a type selector. Phase 1 currently supports EOA only.</p>
          <ul className="guardian-builder-list">
            {guardians.map((guardian, index) => (
              <li key={guardian.id} className="guardian-builder-row">
                <span className="guardian-chip">Guardian {index + 1}</span>
                <input
                  value={guardian.identifier}
                  onChange={(event) => updateGuardian(guardian.id, { identifier: event.target.value })}
                  placeholder={guardian.type === 'eoa' ? '0x...' : 'Identifier'}
                />
                <select
                  value={guardian.type}
                  onChange={(event) => updateGuardian(guardian.id, { type: event.target.value as GuardianKind })}
                >
                  <option value="eoa">EOA</option>
                  <option value="passkey" disabled>
                    Passkey (Phase 2)
                  </option>
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
              </li>
            ))}
          </ul>
          <button type="button" className="secondary" onClick={addGuardian} title="Add another guardian row">
            + Add guardian
          </button>
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
              {currentPolicy.guardians.map((guardian, index) => (
                <li key={`${guardian.identifier}-${index}`}>
                  <span>
                    Guardian #{index} ({toGuardianTypeLabel(guardian.guardianType)})
                  </span>
                  <code>
                    {guardian.guardianType === 0 ? bytes32ToAddress(guardian.identifier) : guardian.identifier}
                  </code>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </article>
    </section>
  );
}
