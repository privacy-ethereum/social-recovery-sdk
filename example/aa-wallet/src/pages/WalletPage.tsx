import { useCallback, useEffect, useMemo, useState } from 'react';
import { decodeEventLog, formatEther, getAddress, isAddress, parseEther, type Address, type Hex } from 'viem';
import { anvil } from 'viem/chains';
import { DEMO_ACCOUNTS, getPublicClient, getWalletClient, shortAddress } from '../lib/chain';
import { DEPLOYMENT, ExampleAAWalletAbi, ExampleAAWalletFactoryAbi, isConfiguredAddress } from '../lib/contracts';
import { lookupRecoveryManager } from '../lib/recovery';
import type { ActivityItem } from '../state/types';

interface WalletPageProps {
  walletAddress: Address | '';
  setWalletAddress: (wallet: Address | '') => void;
  recoveryManagerAddress: Address | '';
  setRecoveryManagerAddress: (value: Address | '') => void;
  activities: ActivityItem[];
  addActivity: (input: { label: string; details?: string; txHash?: Hex }) => void;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function WalletPage(props: WalletPageProps) {
  const [selectedPrivateKey, setSelectedPrivateKey] = useState<Hex>(DEMO_ACCOUNTS[0].privateKey);
  const [manualWalletInput, setManualWalletInput] = useState<string>(props.walletAddress || '');
  const [owner, setOwner] = useState<string>('');
  const [walletBalance, setWalletBalance] = useState<string>('0');
  const [signerBalance, setSignerBalance] = useState<string>('0');
  const [ownedWallets, setOwnedWallets] = useState<Address[]>([]);
  const [fundAmount, setFundAmount] = useState<string>('0.25');
  const [sendTo, setSendTo] = useState<string>(DEMO_ACCOUNTS[1].address);
  const [sendAmount, setSendAmount] = useState<string>('0.01');
  const [status, setStatus] = useState<string>('Select signer and deploy/load a wallet');
  const [error, setError] = useState<string>('');

  const publicClient = useMemo(() => getPublicClient(), []);
  const walletClient = useMemo(() => getWalletClient(selectedPrivateKey), [selectedPrivateKey]);
  const selectedAccount = walletClient.account?.address;
  const signerIsWalletOwner = Boolean(selectedAccount && owner && selectedAccount.toLowerCase() === owner.toLowerCase());
  const walletHasFunds = Number(walletBalance) > 0;
  const visibleWallets = useMemo(() => {
    const deduped = new Set(ownedWallets.map((wallet) => wallet.toLowerCase()));
    const result = [...ownedWallets];

    if (props.walletAddress && signerIsWalletOwner && !deduped.has(props.walletAddress.toLowerCase())) {
      result.unshift(props.walletAddress);
    }

    return result;
  }, [ownedWallets, props.walletAddress, signerIsWalletOwner]);

  const refreshOwnedWallets = useCallback(async () => {
    if (!selectedAccount) {
      setOwnedWallets([]);
      return;
    }
    if (!isConfiguredAddress(DEPLOYMENT.contracts.exampleWalletFactory)) {
      setOwnedWallets([]);
      return;
    }

    const wallets = await publicClient.readContract({
      address: DEPLOYMENT.contracts.exampleWalletFactory,
      abi: ExampleAAWalletFactoryAbi,
      functionName: 'getWallets',
      args: [selectedAccount],
    });
    setOwnedWallets([...wallets]);
  }, [publicClient, selectedAccount]);

  const refreshSignerBalance = useCallback(async () => {
    if (!selectedAccount) {
      setSignerBalance('0');
      return;
    }
    const balance = await publicClient.getBalance({ address: selectedAccount });
    setSignerBalance(formatEther(balance));
  }, [publicClient, selectedAccount]);

  const refreshWalletState = useCallback(
    async (targetWallet?: Address) => {
      const wallet = targetWallet ?? props.walletAddress;
      if (!wallet) {
        return;
      }

      const bytecode = await publicClient.getBytecode({ address: wallet });
      if (!bytecode || bytecode === '0x') {
        throw new Error('Selected address is not a deployed contract on current chain.');
      }

      let nextOwner: Address;
      try {
        nextOwner = await publicClient.readContract({
          address: wallet,
          abi: ExampleAAWalletAbi,
          functionName: 'owner',
        });
      } catch {
        throw new Error('Selected contract is not ExampleAAWallet (owner() call failed).');
      }

      const nextBalance = await publicClient.getBalance({ address: wallet });

      setOwner(nextOwner);
      setWalletBalance(formatEther(nextBalance));

      if (isConfiguredAddress(DEPLOYMENT.contracts.recoveryManagerFactory)) {
        const recoveryManager = await lookupRecoveryManager(publicClient, wallet);
        props.setRecoveryManagerAddress(recoveryManager.toLowerCase() === ZERO_ADDRESS ? '' : recoveryManager);
      }
    },
    [props.walletAddress, props.setRecoveryManagerAddress, publicClient],
  );

  async function setActiveWallet(wallet: Address) {
    setManualWalletInput(wallet);
    await refreshWalletState(wallet);
    props.setWalletAddress(wallet);
  }

  async function handleDeployWallet() {
    setError('');
    if (!selectedAccount) {
      setError('No signer selected.');
      return;
    }
    if (!isConfiguredAddress(DEPLOYMENT.contracts.exampleWalletFactory)) {
      setError('Example wallet factory is not configured. Run local deployment first.');
      return;
    }

    try {
      setStatus('Deploying ExampleAAWallet via ExampleAAWalletFactory...');
      const hash = await walletClient.writeContract({
        account: walletClient.account!,
        chain: anvil,
        address: DEPLOYMENT.contracts.exampleWalletFactory,
        abi: ExampleAAWalletFactoryAbi,
        functionName: 'createWallet',
        args: [selectedAccount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      let deployedWallet: Address | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = decodeEventLog({
            abi: ExampleAAWalletFactoryAbi,
            data: log.data,
            topics: log.topics,
          });
          if (parsed.eventName === 'WalletDeployed') {
            deployedWallet = parsed.args.wallet;
            break;
          }
        } catch {
          // Ignore non-matching logs.
        }
      }

      if (!deployedWallet) {
        throw new Error('Could not resolve deployed wallet address from transaction logs.');
      }

      props.addActivity({ label: 'Wallet deployed', txHash: hash, details: deployedWallet });
      await refreshOwnedWallets();
      await setActiveWallet(deployedWallet);
      setStatus(`Wallet deployed: ${shortAddress(deployedWallet)}`);
    } catch (deployError) {
      setError(deployError instanceof Error ? deployError.message : 'Failed to deploy wallet');
      setStatus('Deploy failed');
    }
  }

  async function handleUseWalletAddress() {
    setError('');
    if (!isAddress(manualWalletInput)) {
      setError('Invalid wallet address');
      return;
    }

    const normalized = getAddress(manualWalletInput);
    try {
      await setActiveWallet(normalized);
      setStatus(`Loaded wallet ${shortAddress(normalized)}`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load wallet');
      setStatus('Load failed');
    }
  }

  async function handleRemoveWallet(wallet: Address) {
    setError('');
    if (!selectedAccount) {
      setError('No signer selected.');
      return;
    }
    if (!isConfiguredAddress(DEPLOYMENT.contracts.exampleWalletFactory)) {
      setError('Example wallet factory is not configured.');
      return;
    }

    const confirmed = window.confirm(
      `Remove ${wallet} from this owner list?\n\nThis does not destroy the wallet contract. It only removes it from factory tracking for the selected owner.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      setStatus('Removing wallet from owner list...');
      const hash = await walletClient.writeContract({
        account: walletClient.account!,
        chain: anvil,
        address: DEPLOYMENT.contracts.exampleWalletFactory,
        abi: ExampleAAWalletFactoryAbi,
        functionName: 'removeWallet',
        args: [wallet],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      props.addActivity({
        label: 'Wallet removed from factory index',
        txHash: hash,
        details: wallet,
      });

      if (props.walletAddress && props.walletAddress.toLowerCase() === wallet.toLowerCase()) {
        props.setWalletAddress('');
        props.setRecoveryManagerAddress('');
        setManualWalletInput('');
        setOwner('');
        setWalletBalance('0');
      }

      await refreshOwnedWallets();
      setStatus('Wallet removed from owner list');
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Failed to remove wallet');
      setStatus('Remove failed');
    }
  }

  async function handleFundWallet() {
    setError('');
    if (!props.walletAddress) {
      setError('Select a wallet first');
      return;
    }

    try {
      const value = parseEther(fundAmount);
      setStatus('Sending ETH from signer to wallet...');
      const hash = await walletClient.sendTransaction({
        account: walletClient.account!,
        chain: anvil,
        to: props.walletAddress,
        value,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      props.addActivity({ label: 'Wallet funded', txHash: hash, details: `${fundAmount} ETH` });
      await refreshSignerBalance();
      await refreshWalletState();
      setStatus('Wallet funded');
    } catch (fundError) {
      setError(fundError instanceof Error ? fundError.message : 'Failed to fund wallet');
      setStatus('Fund failed');
    }
  }

  async function handleSendFromWallet() {
    setError('');
    if (!props.walletAddress) {
      setError('Select a wallet first');
      return;
    }
    if (!isAddress(sendTo)) {
      setError('Recipient address is invalid');
      return;
    }
    if (!signerIsWalletOwner) {
      setError('Selected signer is not wallet owner, so execute() will fail.');
      return;
    }
    if (!walletHasFunds) {
      setError('Wallet balance is zero. Fund it first.');
      return;
    }

    try {
      const value = parseEther(sendAmount);
      setStatus('Executing wallet transfer...');
      const hash = await walletClient.writeContract({
        account: walletClient.account!,
        chain: anvil,
        address: props.walletAddress,
        abi: ExampleAAWalletAbi,
        functionName: 'execute',
        args: [getAddress(sendTo), value, '0x'],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      props.addActivity({
        label: 'Wallet execute transfer',
        txHash: hash,
        details: `${sendAmount} ETH -> ${getAddress(sendTo)}`,
      });
      await refreshSignerBalance();
      await refreshWalletState();
      setStatus('Transfer executed');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Wallet transfer failed');
      setStatus('Transfer failed');
    }
  }

  useEffect(() => {
    void refreshSignerBalance();
    void refreshOwnedWallets();
  }, [refreshSignerBalance, refreshOwnedWallets]);

  useEffect(() => {
    if (!props.walletAddress) {
      setOwner('');
      setWalletBalance('0');
      return;
    }

    setManualWalletInput(props.walletAddress);
    void (async () => {
      try {
        await refreshWalletState();
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : 'Failed to load wallet');
        setStatus('Load failed');
        props.setWalletAddress('');
        props.setRecoveryManagerAddress('');
        setOwner('');
        setWalletBalance('0');
      }
    })();
  }, [props.walletAddress, refreshWalletState]);

  useEffect(() => {
    if (!selectedAccount) {
      return;
    }

    if (props.walletAddress && owner && owner.toLowerCase() !== selectedAccount.toLowerCase()) {
      setStatus('Signer changed. Active wallet is kept loaded, but execute actions require owner signer.');
    }
  }, [owner, props.walletAddress, selectedAccount]);

  return (
    <section className="panel-grid two-col">
      <article className="panel">
        <h2>Wallet Setup</h2>
        <p className="muted">
          Use one signer as wallet owner. Deploy creates an <code>ExampleAAWallet</code> contract for that signer.
        </p>

        <label className="field">
          <span>1. Owner signer</span>
          <select value={selectedPrivateKey} onChange={(event) => setSelectedPrivateKey(event.target.value as Hex)}>
            {DEMO_ACCOUNTS.map((account) => (
              <option key={account.address} value={account.privateKey}>
                {account.label}
              </option>
            ))}
          </select>
        </label>

        <div className="stats one-col">
          <div>
            <span>Signer address</span>
            <strong>{selectedAccount ?? '-'}</strong>
          </div>
          <div>
            <span>Signer balance</span>
            <strong>{signerBalance} ETH</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{status}</strong>
          </div>
        </div>

        <div className="actions">
          <button type="button" onClick={handleDeployWallet} title="Deploy a fresh ExampleAAWallet owned by selected signer">
            2. Deploy New Wallet
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void refreshOwnedWallets()}
            title="Reload owner wallet list from factory"
          >
            Refresh owned wallets
          </button>
        </div>

        <div className="subpanel">
          <h3>Owner Wallets</h3>
          {visibleWallets.length === 0 ? <p className="muted">No wallets indexed for this signer yet.</p> : null}
          {visibleWallets.length > ownedWallets.length ? (
            <p className="muted">
              Current active wallet is shown because signer matches on-chain owner, even if factory list is outdated.
            </p>
          ) : null}
          <ul className="wallet-list">
            {visibleWallets.map((wallet) => (
              <li key={wallet}>
                <code>{wallet}</code>
                <div className="row gap-sm">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void setActiveWallet(wallet)}
                    title="Set this wallet as active"
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void handleRemoveWallet(wallet)}
                    title="Remove this wallet from owner list (contract stays deployed)"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <label className="field">
          <span>Or load wallet by address</span>
          <div className="row gap-sm">
            <input
              placeholder="0x..."
              value={manualWalletInput}
              onChange={(event) => setManualWalletInput(event.target.value)}
            />
            <button type="button" className="secondary" onClick={handleUseWalletAddress} title="Load wallet state by address">
              Load
            </button>
          </div>
        </label>
      </article>

      <article className="panel">
        <h2>Active Smart Wallet (AA)</h2>
        <p className="muted">
          This is the deployed account abstraction wallet contract (<code>ExampleAAWallet</code>).
        </p>
        <div className="stats one-col">
          <div>
            <span>AA wallet address</span>
            <strong>{props.walletAddress || '-'}</strong>
          </div>
          <div>
            <span>Current owner</span>
            <strong>{owner || '-'}</strong>
          </div>
          <div>
            <span>Wallet balance</span>
            <strong>{walletBalance} ETH</strong>
          </div>
          <div>
            <span>Recovery manager</span>
            <strong>{props.recoveryManagerAddress || 'Not configured'}</strong>
          </div>
          <div>
            <span>Signer is owner</span>
            <strong>{signerIsWalletOwner ? 'Yes' : 'No'}</strong>
          </div>
        </div>

        <div className="subpanel">
          <h3>3. Fund Wallet</h3>
          <p className="muted">Transfers ETH from selected signer account to wallet contract.</p>
          <label className="field">
            <span>Amount (ETH)</span>
            <input value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} />
          </label>
          <button
            type="button"
            onClick={handleFundWallet}
            disabled={!props.walletAddress}
            title="Send ETH from selected signer account into wallet contract"
          >
            Fund Wallet
          </button>
        </div>

        <div className="subpanel">
          <h3>4. Send ETH From Wallet</h3>
          <p className="muted">Calls wallet <code>execute()</code>. Requires signer to be owner.</p>
          <label className="field">
            <span>Recipient</span>
            <input value={sendTo} onChange={(event) => setSendTo(event.target.value)} placeholder="0x..." />
          </label>
          <label className="field">
            <span>Amount (ETH)</span>
            <input value={sendAmount} onChange={(event) => setSendAmount(event.target.value)} />
          </label>
          <button
            type="button"
            onClick={handleSendFromWallet}
            disabled={!props.walletAddress || !signerIsWalletOwner || !walletHasFunds}
            title="Call wallet execute() to transfer ETH from the contract"
          >
            Execute Transfer
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </article>

      <article className="panel panel-full">
        <h2>Recent Activity</h2>
        <ul className="activity-list">
          {props.activities.length === 0 ? <li className="muted">No activity yet.</li> : null}
          {props.activities.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.label}</strong>
                <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
              </div>
              {item.details ? <p>{item.details}</p> : null}
              {item.txHash ? <code>{item.txHash}</code> : null}
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
