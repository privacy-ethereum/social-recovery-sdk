import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil } from 'viem/chains';
import localAddresses from '../config/local-addresses.json';

const DEFAULT_RPC_URL = localAddresses.rpcUrl || 'http://127.0.0.1:8545';

export const RPC_URL = import.meta.env.VITE_RPC_URL ?? DEFAULT_RPC_URL;

const ANVIL_PRIVATE_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
] as const;

export interface DemoAccount {
  role: string;
  label: string;
  privateKey: Hex;
  address: `0x${string}`;
}

const DEMO_ROLES = ['Owner', 'Guardian A', 'Guardian B', 'Executor', 'New Owner'] as const;

export function shortAddress(address: `0x${string}`): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export const DEMO_ACCOUNTS: DemoAccount[] = ANVIL_PRIVATE_KEYS.map((privateKey, index) => {
  const account = privateKeyToAccount(privateKey);
  const role = DEMO_ROLES[index] ?? `Account ${index + 1}`;
  return {
    role,
    label: `${role} (${shortAddress(account.address)})`,
    privateKey,
    address: account.address,
  };
});

export function getPublicClient() {
  return createPublicClient({
    chain: anvil,
    transport: http(RPC_URL),
  });
}

export function getWalletClient(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: anvil,
    transport: http(RPC_URL),
  });
}

export async function mineAnvilBlock(publicClient: ReturnType<typeof getPublicClient>) {
  await publicClient.request({
    method: 'evm_mine' as never,
    params: [] as never,
  });
}

export async function increaseAnvilTime(publicClient: ReturnType<typeof getPublicClient>, seconds: number) {
  await publicClient.request({
    method: 'evm_increaseTime' as never,
    params: [seconds] as never,
  });
  await mineAnvilBlock(publicClient);
}
