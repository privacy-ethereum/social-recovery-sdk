export type TabKey = 'wallet' | 'settings' | 'recover';

export interface TabRoute {
  key: TabKey;
  label: string;
}

export const TAB_ROUTES: TabRoute[] = [
  { key: 'wallet', label: 'Wallet' },
  { key: 'settings', label: 'Settings' },
  { key: 'recover', label: 'Recover' },
];
