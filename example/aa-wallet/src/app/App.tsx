import { useMemo, useState } from 'react';
import type { Address, Hex } from 'viem';
import { TAB_ROUTES, type TabKey } from './routes';
import { WalletPage } from '../pages/WalletPage';
import { SettingsPage } from '../pages/SettingsPage';
import { RecoverPage } from '../pages/RecoverPage';
import type { ActivityItem } from '../state/types';

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('wallet');
  const [walletAddress, setWalletAddress] = useState<Address | ''>('');
  const [recoveryManagerAddress, setRecoveryManagerAddress] = useState<Address | ''>('');
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  const addActivity = (input: { label: string; details?: string; txHash?: Hex }) => {
    setActivities((prev) => [
      {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        label: input.label,
        details: input.details,
        txHash: input.txHash,
      },
      ...prev,
    ]);
  };

  const commonProps = useMemo(
    () => ({
      walletAddress,
      setWalletAddress,
      recoveryManagerAddress,
      setRecoveryManagerAddress,
      addActivity,
      activities,
    }),
    [activities, recoveryManagerAddress, walletAddress],
  );

  return (
    <div className="app-shell">
      <header className="header">
        <div>
          <h1>Social Recovery AA Wallet</h1>
          <p>Standalone demo: wallet deployment, recovery setup, and EOA guardian recovery on Anvil</p>
        </div>
        <nav className="tabs" aria-label="Main tabs">
          {TAB_ROUTES.map((route) => (
            <button
              key={route.key}
              type="button"
              className={activeTab === route.key ? 'tab active' : 'tab'}
              onClick={() => setActiveTab(route.key)}
            >
              {route.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="main-content">
        <section className="panel">
          <h2>Demo Flow</h2>
          <p className="muted">
            1. Deploy wallet in <strong>Wallet</strong>. 2. Configure guardians and recovery manager in{' '}
            <strong>Settings</strong>. 3. Recover by pasted wallet address in <strong>Recover</strong>.
          </p>
        </section>
        {activeTab === 'wallet' && <WalletPage {...commonProps} />}
        {activeTab === 'settings' && <SettingsPage {...commonProps} />}
        {activeTab === 'recover' && <RecoverPage {...commonProps} />}
      </main>
    </div>
  );
}
