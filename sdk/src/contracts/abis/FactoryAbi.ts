export const RecoveryManagerFactoryAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_implementation', type: 'address', internalType: 'address' },
      { name: '_passkeyVerifier', type: 'address', internalType: 'address' },
      { name: '_zkJwtVerifier', type: 'address', internalType: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'deployRecoveryManager',
    inputs: [
      { name: '_wallet', type: 'address', internalType: 'address' },
      {
        name: 'guardians',
        type: 'tuple[]',
        internalType: 'struct GuardianLib.Guardian[]',
        components: [
          {
            name: 'guardianType',
            type: 'uint8',
            internalType: 'enum GuardianLib.GuardianType',
          },
          { name: 'identifier', type: 'bytes32', internalType: 'bytes32' },
        ],
      },
      { name: '_threshold', type: 'uint256', internalType: 'uint256' },
      { name: '_challengePeriod', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: 'proxy', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getRecoveryManager',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'implementation',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'passkeyVerifier',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'zkJwtVerifier',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'RecoveryManagerDeployed',
    inputs: [
      { name: 'wallet', type: 'address', indexed: true, internalType: 'address' },
      { name: 'recoveryManager', type: 'address', indexed: true, internalType: 'address' },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'AlreadyDeployed', inputs: [] },
  { type: 'error', name: 'DeploymentFailed', inputs: [] },
] as const;
