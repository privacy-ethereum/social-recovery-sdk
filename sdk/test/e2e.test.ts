import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign as signMessage, type KeyObject } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodePacked,
  hexToBytes,
  http,
  keccak256,
  pad,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil } from 'viem/chains';

import {
  RecoveryClient,
  PolicyBuilder,
  EoaAdapter,
  computeZkJwtIdentifier,
  GuardianType,
  createRecoveryIntent,
  hashRecoveryIntent,
  parseP256Signature,
  type GuardianProof,
  type RecoveryIntent,
} from '../src';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONTRACTS_OUT_DIR = path.resolve(REPO_ROOT, 'contracts', 'out');
const ZKJWT_CIRCUIT_DIR = path.resolve(REPO_ROOT, 'circuits', 'zkjwt');
const ZKJWT_SCRIPTS_DIR = path.resolve(ZKJWT_CIRCUIT_DIR, 'scripts');
const NARGO_HOME = path.resolve(REPO_ROOT, '.nargo');
const BN254_SCALAR_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const RPC_URL = process.env.VITE_E2E_RPC_URL ?? 'http://127.0.0.1:8545';

const OWNER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const GUARDIAN_1_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const GUARDIAN_2_PK = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex;
const EXECUTOR_PK = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' as Hex;
const NEW_OWNER_PK = '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' as Hex;
const P256_VERIFIER_ADDRESS = '0xc2b78104907F722DABAc4C69f826a522B2754De4' as Address;

type LinkReference = { start: number; length: number };
type LinkReferences = Record<string, Record<string, LinkReference[]>>;

interface FoundryArtifact {
  abi: readonly unknown[];
  bytecode: {
    object: Hex;
    linkReferences: LinkReferences;
  };
  deployedBytecode?: {
    object: Hex;
  };
}

interface SharedDeployment {
  passkeyVerifier: Address;
  honkVerifier: Address;
  zkJwtVerifier: Address;
  recoveryManagerImplementation: Address;
  factory: Address;
  mockWalletArtifact: FoundryArtifact;
}

function artifactPath(relativePath: string): string {
  return path.join(CONTRACTS_OUT_DIR, relativePath);
}

function readArtifact(relativePath: string): FoundryArtifact {
  const json = readFileSync(artifactPath(relativePath), 'utf8');
  return JSON.parse(json) as FoundryArtifact;
}

function makeWalletClient(privateKey: Hex): WalletClient {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: anvil,
    transport: http(RPC_URL),
  });
}

function assertContractAddress(address: Address | null): Address {
  if (!address) {
    throw new Error('Deployment failed: receipt.contractAddress is null');
  }
  return address;
}

function base64UrlToBigInt(value: string): bigint {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bytes = Buffer.from(padded, 'base64');
  return BigInt(`0x${bytes.toString('hex')}`);
}

interface PasskeySigner {
  privateKey: KeyObject;
  publicKeyX: bigint;
  publicKeyY: bigint;
  identifier: Hex;
}

function createPasskeySigner(): PasskeySigner {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;

  if (!publicJwk.x || !publicJwk.y) {
    throw new Error('Generated EC key is missing x/y coordinates');
  }

  const publicKeyX = base64UrlToBigInt(publicJwk.x);
  const publicKeyY = base64UrlToBigInt(publicJwk.y);
  const identifier = keccak256(encodePacked(['uint256', 'uint256'], [publicKeyX, publicKeyY]));

  return { privateKey, publicKeyX, publicKeyY, identifier };
}

function linkBytecode(bytecode: Hex, linkRefs: LinkReferences, libraries: Record<string, Address>): Hex {
  let linked = bytecode.slice(2);

  for (const sourcePath of Object.keys(linkRefs)) {
    const refsByLibrary = linkRefs[sourcePath];
    for (const libraryName of Object.keys(refsByLibrary)) {
      const libraryAddress = libraries[libraryName] ?? libraries[`${sourcePath}:${libraryName}`];
      if (!libraryAddress) {
        throw new Error(`Missing address for linked library "${libraryName}"`);
      }

      const replacement = libraryAddress.toLowerCase().replace(/^0x/, '');
      for (const ref of refsByLibrary[libraryName]) {
        const start = ref.start * 2;
        const length = ref.length * 2;
        linked = `${linked.slice(0, start)}${replacement}${linked.slice(start + length)}`;
      }
    }
  }

  return `0x${linked}` as Hex;
}

async function deployFromArtifact(params: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  artifact: FoundryArtifact;
  args?: readonly unknown[];
  bytecodeOverride?: Hex;
}): Promise<Address> {
  const hash = await params.walletClient.deployContract({
    account: params.walletClient.account!,
    chain: anvil,
    abi: params.artifact.abi,
    bytecode: params.bytecodeOverride ?? params.artifact.bytecode.object,
    args: params.args ?? [],
  });

  const receipt = await params.publicClient.waitForTransactionReceipt({ hash });
  return assertContractAddress(receipt.contractAddress);
}

async function waitForTx(publicClient: PublicClient, hash: Hex): Promise<void> {
  await publicClient.waitForTransactionReceipt({ hash });
}

function runCommand(command: string, args: string[], cwd: string): void {
  try {
    execFileSync(command, args, {
      cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        NARGO_HOME,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Command failed: ${command} ${args.join(' ')}\n${error.message}`);
    }
    throw error;
  }
}

function chunkBytes32(buffer: Buffer, count: number): Hex[] {
  const requiredLength = count * 32;
  if (buffer.length < requiredLength) {
    throw new Error(
      `public_inputs is too short: expected at least ${requiredLength} bytes, got ${buffer.length}`,
    );
  }

  const chunks: Hex[] = [];
  for (let i = 0; i < count; i++) {
    chunks.push(toHex(buffer.subarray(i * 32, (i + 1) * 32)));
  }
  return chunks;
}

function generateZkJwtProofViaToolchain(params: {
  email: string;
  salt: bigint;
  intentHash: bigint;
  guardianIdentifier: Hex;
}): GuardianProof {
  const proverTomlPath = path.join(ZKJWT_CIRCUIT_DIR, 'Prover.toml');
  const originalProverToml = readFileSync(proverTomlPath, 'utf8');

  try {
    runCommand(
      'npm',
      [
        'run',
        'generate:self-signed',
        '--',
        `--email=${params.email}`,
        `--salt=${params.salt.toString()}`,
        `--intent-hash=${params.intentHash.toString()}`,
      ],
      ZKJWT_SCRIPTS_DIR,
    );
    runCommand('nargo', ['execute'], ZKJWT_CIRCUIT_DIR);
    runCommand(
      'bb',
      [
        'prove',
        '-b',
        './target/zkjwt.json',
        '-w',
        './target/zkjwt.gz',
        '--write_vk',
        '-o',
        'target',
        '-t',
        'evm',
      ],
      ZKJWT_CIRCUIT_DIR,
    );

    const proofBytes = readFileSync(path.join(ZKJWT_CIRCUIT_DIR, 'target', 'proof'));
    const publicInputs = readFileSync(path.join(ZKJWT_CIRCUIT_DIR, 'target', 'public_inputs'));
    const limbs = chunkBytes32(publicInputs, 18) as [
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
      Hex,
    ];
    const encodedProof = encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes32[18]' }],
      [toHex(proofBytes), limbs],
    );

    return {
      guardianIdentifier: params.guardianIdentifier,
      guardianType: GuardianType.ZkJWT,
      proof: encodedProof,
    };
  } finally {
    writeFileSync(proverTomlPath, originalProverToml);
  }
}

function buildPasskeyProof(intent: RecoveryIntent, signer: PasskeySigner): GuardianProof {
  const challengeBytes = hexToBytes(hashRecoveryIntent(intent));
  const challengeB64Url = Buffer.from(challengeBytes).toString('base64url');
  const clientDataJSON = `{"type":"webauthn.get","challenge":"${challengeB64Url}","origin":"https://example.com"}`;
  const challengeLocation = clientDataJSON.indexOf('"challenge"');
  const responseTypeLocation = clientDataJSON.indexOf('"type"');

  const rpIdHash = createHash('sha256').update('example.com').digest();
  const authenticatorData = Buffer.concat([rpIdHash, Buffer.from([0x05]), Buffer.alloc(4)]);
  const clientDataJSONHash = createHash('sha256').update(clientDataJSON).digest();
  const signPayload = Buffer.concat([authenticatorData, clientDataJSONHash]);
  const signatureDer = signMessage('sha256', signPayload, signer.privateKey);
  const { r, s } = parseP256Signature(new Uint8Array(signatureDer));

  const encodedProof = encodeAbiParameters(
    [
      { type: 'bytes' },
      { type: 'string' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
    ],
    [
      toHex(authenticatorData),
      clientDataJSON,
      BigInt(challengeLocation),
      BigInt(responseTypeLocation),
      r,
      s,
      signer.publicKeyX,
      signer.publicKeyY,
    ],
  );

  return {
    guardianIdentifier: signer.identifier,
    guardianType: GuardianType.Passkey,
    proof: encodedProof,
  };
}

describe.sequential('SDK End-to-End (Anvil)', () => {
  const publicClient = createPublicClient({
    chain: anvil,
    transport: http(RPC_URL),
  });

  const ownerWalletClient = makeWalletClient(OWNER_PK);
  const guardian1WalletClient = makeWalletClient(GUARDIAN_1_PK);
  const guardian2WalletClient = makeWalletClient(GUARDIAN_2_PK);
  const executorWalletClient = makeWalletClient(EXECUTOR_PK);
  const newOwnerWalletClient = makeWalletClient(NEW_OWNER_PK);
  if (!newOwnerWalletClient.account) {
    throw new Error('NEW_OWNER_PK wallet client is missing account');
  }
  const newOwnerAddress = newOwnerWalletClient.account.address;

  let chainId: bigint;
  let sharedDeployment: SharedDeployment;

  beforeAll(async () => {
    chainId = BigInt(await publicClient.getChainId());

    const p256VerifierStubArtifact = readArtifact('P256VerifierStub.sol/P256VerifierStub.json');
    const passkeyVerifierArtifact = readArtifact('PasskeyVerifier.sol/PasskeyVerifier.json');
    const honkLibraryArtifact = readArtifact('HonkVerifier.sol/ZKTranscriptLib.json');
    const honkVerifierArtifact = readArtifact('HonkVerifier.sol/HonkVerifier.json');
    const zkJwtVerifierArtifact = readArtifact('ZkJwtVerifier.sol/ZkJwtVerifier.json');
    const recoveryManagerArtifact = readArtifact('RecoveryManager.sol/RecoveryManager.json');
    const factoryArtifact = readArtifact('RecoveryManagerFactory.sol/RecoveryManagerFactory.json');
    const mockWalletArtifact = readArtifact('MockRecoveryWallet.sol/MockRecoveryWallet.json');

    const p256RuntimeBytecode = p256VerifierStubArtifact.deployedBytecode?.object;
    if (!p256RuntimeBytecode || p256RuntimeBytecode === '0x') {
      throw new Error('P256VerifierStub runtime bytecode is missing');
    }
    await publicClient.request({
      method: 'anvil_setCode',
      params: [P256_VERIFIER_ADDRESS, p256RuntimeBytecode],
    });

    const passkeyVerifier = await deployFromArtifact({
      walletClient: ownerWalletClient,
      publicClient,
      artifact: passkeyVerifierArtifact,
    });

    const zkTranscriptLib = await deployFromArtifact({
      walletClient: ownerWalletClient,
      publicClient,
      artifact: honkLibraryArtifact,
    });

    const linkedHonkBytecode = linkBytecode(
      honkVerifierArtifact.bytecode.object,
      honkVerifierArtifact.bytecode.linkReferences,
      { ZKTranscriptLib: zkTranscriptLib },
    );

    const honkVerifier = await deployFromArtifact({
      walletClient: ownerWalletClient,
      publicClient,
      artifact: honkVerifierArtifact,
      bytecodeOverride: linkedHonkBytecode,
    });

    const zkJwtVerifier = await deployFromArtifact({
      walletClient: ownerWalletClient,
      publicClient,
      artifact: zkJwtVerifierArtifact,
      args: [honkVerifier],
    });

    const recoveryManagerImplementation = await deployFromArtifact({
      walletClient: ownerWalletClient,
      publicClient,
      artifact: recoveryManagerArtifact,
    });

    const factory = await deployFromArtifact({
      walletClient: ownerWalletClient,
      publicClient,
      artifact: factoryArtifact,
      args: [recoveryManagerImplementation, passkeyVerifier, zkJwtVerifier],
    });

    sharedDeployment = {
      passkeyVerifier,
      honkVerifier,
      zkJwtVerifier,
      recoveryManagerImplementation,
      factory,
      mockWalletArtifact,
    };
  }, 180000);

  async function deployWalletAndRecoveryManager(policy: PolicyBuilder): Promise<{
    walletAddress: Address;
    recoveryManagerAddress: Address;
    ownerClient: RecoveryClient;
  }> {
    const walletAddress = await deployFromArtifact({
      walletClient: ownerWalletClient,
      publicClient,
      artifact: sharedDeployment.mockWalletArtifact,
      args: [ownerWalletClient.account.address],
    });

    const ownerClient = new RecoveryClient({
      publicClient,
      walletClient: ownerWalletClient,
      factoryAddress: sharedDeployment.factory,
    });

    const recoveryManagerAddress = await ownerClient.deployRecoveryManager(policy.setWallet(walletAddress).build());

    const authTxHash = await ownerWalletClient.writeContract({
      account: ownerWalletClient.account!,
      chain: anvil,
      address: walletAddress,
      abi: sharedDeployment.mockWalletArtifact.abi,
      functionName: 'authorizeRecoveryManager',
      args: [recoveryManagerAddress],
    });
    await waitForTx(publicClient, authTxHash);

    return { walletAddress, recoveryManagerAddress, ownerClient };
  }

  it('EOA flow: SDK can recover wallet through deployed contracts', async () => {
    const policy = new PolicyBuilder()
      .addEoaGuardian(guardian1WalletClient.account.address)
      .addEoaGuardian(guardian2WalletClient.account.address)
      .setThreshold(2)
      .setChallengePeriod(0);

    const { walletAddress, recoveryManagerAddress, ownerClient } =
      await deployWalletAndRecoveryManager(policy);

    const intent = createRecoveryIntent({
      wallet: walletAddress,
      newOwner: newOwnerAddress,
      recoveryManager: recoveryManagerAddress,
      nonce: await ownerClient.getNonce(),
      chainId,
      deadlineSeconds: 3600,
    });

    const guardian1Adapter = new EoaAdapter({ walletClient: guardian1WalletClient });
    const guardian1Proof = await guardian1Adapter.generateProof(
      intent,
      pad(guardian1WalletClient.account.address, { size: 32 }) as Hex,
    );
    expect(guardian1Proof.success).toBe(true);

    const guardian1Client = new RecoveryClient({
      publicClient,
      walletClient: guardian1WalletClient,
      recoveryManagerAddress,
    });
    const startTx = await guardian1Client.startRecovery({
      intent,
      guardianIndex: 0n,
      proof: guardian1Proof.proof!,
    });
    await waitForTx(publicClient, startTx);

    const guardian2Adapter = new EoaAdapter({ walletClient: guardian2WalletClient });
    const guardian2Proof = await guardian2Adapter.generateProof(
      intent,
      pad(guardian2WalletClient.account.address, { size: 32 }) as Hex,
    );
    expect(guardian2Proof.success).toBe(true);

    const guardian2Client = new RecoveryClient({
      publicClient,
      walletClient: guardian2WalletClient,
      recoveryManagerAddress,
    });
    const submitTx = await guardian2Client.submitProof({
      guardianIndex: 1n,
      proof: guardian2Proof.proof!,
    });
    await waitForTx(publicClient, submitTx);

    const executeTx = await guardian2Client.executeRecovery();
    await waitForTx(publicClient, executeTx);

    const currentOwner = await publicClient.readContract({
      address: walletAddress,
      abi: sharedDeployment.mockWalletArtifact.abi,
      functionName: 'owner',
    });
    expect(currentOwner.toLowerCase()).toBe(newOwnerAddress.toLowerCase());
  });

  it('Passkey flow: deterministic WebAuthn-format proof succeeds on-chain', async () => {
    const passkeySigner = createPasskeySigner();

    const policy = new PolicyBuilder()
      .addPasskeyGuardian({ x: passkeySigner.publicKeyX, y: passkeySigner.publicKeyY })
      .setThreshold(1)
      .setChallengePeriod(0);

    const { walletAddress, recoveryManagerAddress, ownerClient } =
      await deployWalletAndRecoveryManager(policy);

    const intent = createRecoveryIntent({
      wallet: walletAddress,
      newOwner: newOwnerAddress,
      recoveryManager: recoveryManagerAddress,
      nonce: await ownerClient.getNonce(),
      chainId,
      deadlineSeconds: 3600,
    });
    const deterministicProof = buildPasskeyProof(intent, passkeySigner);

    const executorClient = new RecoveryClient({
      publicClient,
      walletClient: executorWalletClient,
      recoveryManagerAddress,
    });

    const startTx = await executorClient.startRecovery({
      intent,
      guardianIndex: 0n,
      proof: deterministicProof,
    });
    await waitForTx(publicClient, startTx);

    const executeTx = await executorClient.executeRecovery();
    await waitForTx(publicClient, executeTx);

    const currentOwner = await publicClient.readContract({
      address: walletAddress,
      abi: sharedDeployment.mockWalletArtifact.abi,
      functionName: 'owner',
    });
    expect(currentOwner.toLowerCase()).toBe(newOwnerAddress.toLowerCase());
  });

  it('zkJWT flow: circuit-generated proof verifies on-chain through SDK client', async () => {
    const email = 'guardian@example.com';
    const salt = 424242n;

    const guardianIdentifier = await computeZkJwtIdentifier(email, salt);
    const policy = new PolicyBuilder()
      .addZkJwtGuardian(guardianIdentifier)
      .setThreshold(1)
      .setChallengePeriod(0);

    const { walletAddress, recoveryManagerAddress, ownerClient } =
      await deployWalletAndRecoveryManager(policy);

    const intent = createRecoveryIntent({
      wallet: walletAddress,
      newOwner: newOwnerAddress,
      recoveryManager: recoveryManagerAddress,
      nonce: await ownerClient.getNonce(),
      chainId,
      deadlineSeconds: 3600,
    });

    const reducedIntentHash =
      BigInt(hashRecoveryIntent(intent)) % BN254_SCALAR_FIELD_MODULUS;
    const zkProof = generateZkJwtProofViaToolchain({
      email,
      salt,
      intentHash: reducedIntentHash,
      guardianIdentifier,
    });

    const guardianClient = new RecoveryClient({
      publicClient,
      walletClient: guardian1WalletClient,
      recoveryManagerAddress,
    });

    const startTx = await guardianClient.startRecovery({
      intent,
      guardianIndex: 0n,
      proof: zkProof,
    });
    await waitForTx(publicClient, startTx);

    const executeTx = await guardianClient.executeRecovery();
    await waitForTx(publicClient, executeTx);

    const currentOwner = await publicClient.readContract({
      address: walletAddress,
      abi: sharedDeployment.mockWalletArtifact.abi,
      functionName: 'owner',
    });
    expect(currentOwner.toLowerCase()).toBe(newOwnerAddress.toLowerCase());
  }, 300000);
});
