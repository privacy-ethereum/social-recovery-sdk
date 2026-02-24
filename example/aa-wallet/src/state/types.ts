import type { Hex } from 'viem';

export interface ActivityItem {
  id: string;
  timestamp: string;
  label: string;
  txHash?: Hex;
  details?: string;
}
