import { useEffect, useMemo, useState } from 'react';
import { isAddress, type Address, type Hex } from 'viem';
import { TAB_ROUTES, type TabKey } from './routes';
import { WalletPage } from '../pages/WalletPage';
import { SettingsPage } from '../pages/SettingsPage';
import { RecoverPage } from '../pages/RecoverPage';
import type { ActivityItem } from '../state/types';

const STORAGE_KEY = 'aa-wallet-demo-state-v1';

interface PersistedAppState {
  activeTab: TabKey;
  walletAddress: Address | '';
  recoveryManagerAddress: Address | '';
  activities: ActivityItem[];
}

function normalizeAddress(value: unknown): Address | '' {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }
  return isAddress(value) ? value : '';
}

function normalizeActivities(value: unknown): ActivityItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const safeItems: ActivityItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const candidate = item as Partial<ActivityItem>;
    if (typeof candidate.id !== 'string' || typeof candidate.timestamp !== 'string' || typeof candidate.label !== 'string') {
      continue;
    }

    safeItems.push({
      id: candidate.id,
      timestamp: candidate.timestamp,
      label: candidate.label,
      details: typeof candidate.details === 'string' ? candidate.details : undefined,
      txHash: typeof candidate.txHash === 'string' ? (candidate.txHash as Hex) : undefined,
    });
  }

  return safeItems.slice(0, 100);
}

function loadPersistedState(): PersistedAppState {
  if (typeof window === 'undefined') {
    return {
      activeTab: 'wallet',
      walletAddress: '',
      recoveryManagerAddress: '',
      activities: [],
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        activeTab: 'wallet',
        walletAddress: '',
        recoveryManagerAddress: '',
        activities: [],
      };
    }

    const parsed = JSON.parse(raw) as Partial<PersistedAppState>;
    return {
      activeTab: parsed.activeTab === 'settings' || parsed.activeTab === 'recover' ? parsed.activeTab : 'wallet',
      walletAddress: normalizeAddress(parsed.walletAddress),
      recoveryManagerAddress: normalizeAddress(parsed.recoveryManagerAddress),
      activities: normalizeActivities(parsed.activities),
    };
  } catch {
    return {
      activeTab: 'wallet',
      walletAddress: '',
      recoveryManagerAddress: '',
      activities: [],
    };
  }
}

export function App() {
  const initialState = useMemo(() => loadPersistedState(), []);
  const [activeTab, setActiveTab] = useState<TabKey>(initialState.activeTab);
  const [walletAddress, setWalletAddress] = useState<Address | ''>(initialState.walletAddress);
  const [recoveryManagerAddress, setRecoveryManagerAddress] = useState<Address | ''>(initialState.recoveryManagerAddress);
  const [activities, setActivities] = useState<ActivityItem[]>(initialState.activities);

  const addActivity = (input: { label: string; details?: string; txHash?: Hex }) => {
    setActivities((prev) => [
      {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        label: input.label,
        details: input.details,
        txHash: input.txHash,
      },
      ...prev.slice(0, 99),
    ]);
  };

  useEffect(() => {
    const nextState: PersistedAppState = {
      activeTab,
      walletAddress,
      recoveryManagerAddress,
      activities,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }, [activeTab, activities, recoveryManagerAddress, walletAddress]);

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
          <p>Standalone demo: wallet deployment, recovery setup, and recovery execution on Anvil</p>
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
