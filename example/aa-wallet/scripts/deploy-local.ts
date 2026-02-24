import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil } from 'viem/chains';
import { P256_VERIFIER_ADDRESS } from '@pse/social-recovery-sdk';

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

interface LocalAddressConfig {
  chainId: number;
  rpcUrl: string;
  deployer: Address;
  generatedAt: string;
  contracts: {
    passkeyVerifier: Address;
    honkVerifier: Address;
    zkJwtVerifier: Address;
    recoveryManagerImplementation: Address;
    recoveryManagerFactory: Address;
    exampleWalletFactory: Address;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PROJECT_ROOT, '..', '..');
const SDK_CONTRACTS_OUT_DIR = path.resolve(REPO_ROOT, 'contracts', 'out');
const EXAMPLE_CONTRACTS_OUT_DIR = path.resolve(REPO_ROOT, 'example', 'contracts', 'out');
const OUTPUT_CONFIG_PATH = path.resolve(PROJECT_ROOT, 'src', 'config', 'local-addresses.json');
const DEFAULT_DEPLOYER_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;

function sdkArtifactPath(relativePath: string): string {
  return path.join(SDK_CONTRACTS_OUT_DIR, relativePath);
}

function exampleArtifactPath(relativePath: string): string {
  return path.join(EXAMPLE_CONTRACTS_OUT_DIR, relativePath);
}

function resolveArtifactPath(baseDirPath: (relativePath: string) => string, relativePath: string): string {
  const expectedPath = baseDirPath(relativePath);
  if (existsSync(expectedPath)) {
    return expectedPath;
  }

  const artifactDir = path.dirname(expectedPath);
  const artifactFileName = path.basename(expectedPath, '.json');

  if (!existsSync(artifactDir)) {
    throw new Error(`Artifact directory not found: ${artifactDir}`);
  }

  const versionedCandidates = readdirSync(artifactDir)
    .filter((entry) => entry.startsWith(`${artifactFileName}.`) && entry.endsWith('.json'))
    .sort();

  if (versionedCandidates.length > 0) {
    return path.join(artifactDir, versionedCandidates[versionedCandidates.length - 1]);
  }

  throw new Error(`Artifact not found: ${expectedPath}`);
}

function readArtifact(baseDirPath: (relativePath: string) => string, relativePath: string): FoundryArtifact {
  const json = readFileSync(resolveArtifactPath(baseDirPath, relativePath), 'utf8');
  return JSON.parse(json) as FoundryArtifact;
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

function assertContractAddress(address: Address | null | undefined): Address {
  if (!address) {
    throw new Error('Deployment failed: receipt.contractAddress is null or undefined');
  }
  return address;
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

function ensureArtifactsPresent(): void {
  const requiredSdkArtifacts = [
    'P256VerifierStub.sol/P256VerifierStub.json',
    'PasskeyVerifier.sol/PasskeyVerifier.json',
    'HonkVerifier.sol/ZKTranscriptLib.json',
    'HonkVerifier.sol/HonkVerifier.json',
    'ZkJwtVerifier.sol/ZkJwtVerifier.json',
    'RecoveryManager.sol/RecoveryManager.json',
    'RecoveryManagerFactory.sol/RecoveryManagerFactory.json',
  ];
  const requiredExampleArtifacts = [
    'ExampleAAWalletFactory.sol/ExampleAAWalletFactory.json',
  ];

  for (const relPath of requiredSdkArtifacts) {
    resolveArtifactPath(sdkArtifactPath, relPath);
  }
  for (const relPath of requiredExampleArtifacts) {
    resolveArtifactPath(exampleArtifactPath, relPath);
  }
}

async function main(): Promise<void> {
  ensureArtifactsPresent();

  const rpcUrl = process.env.VITE_RPC_URL ?? 'http://127.0.0.1:8545';
  const deployerPrivateKey = (process.env.DEPLOYER_PRIVATE_KEY ?? DEFAULT_DEPLOYER_PRIVATE_KEY) as Hex;

  const account = privateKeyToAccount(deployerPrivateKey);
  const publicClient = createPublicClient({
    chain: anvil,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: anvil,
    transport: http(rpcUrl),
  });

  const chainId = await publicClient.getChainId();
  if (chainId !== anvil.id) {
    throw new Error(`Expected Anvil chain id ${anvil.id}, received ${chainId}`);
  }

  const p256VerifierStubArtifact = readArtifact(sdkArtifactPath, 'P256VerifierStub.sol/P256VerifierStub.json');
  const passkeyVerifierArtifact = readArtifact(sdkArtifactPath, 'PasskeyVerifier.sol/PasskeyVerifier.json');
  const honkLibraryArtifact = readArtifact(sdkArtifactPath, 'HonkVerifier.sol/ZKTranscriptLib.json');
  const honkVerifierArtifact = readArtifact(sdkArtifactPath, 'HonkVerifier.sol/HonkVerifier.json');
  const zkJwtVerifierArtifact = readArtifact(sdkArtifactPath, 'ZkJwtVerifier.sol/ZkJwtVerifier.json');
  const recoveryManagerArtifact = readArtifact(sdkArtifactPath, 'RecoveryManager.sol/RecoveryManager.json');
  const recoveryManagerFactoryArtifact = readArtifact(
    sdkArtifactPath,
    'RecoveryManagerFactory.sol/RecoveryManagerFactory.json',
  );
  const exampleWalletFactoryArtifact = readArtifact(
    exampleArtifactPath,
    'ExampleAAWalletFactory.sol/ExampleAAWalletFactory.json',
  );

  const p256RuntimeBytecode = p256VerifierStubArtifact.deployedBytecode?.object;
  if (!p256RuntimeBytecode || p256RuntimeBytecode === '0x') {
    throw new Error('P256VerifierStub runtime bytecode is missing');
  }

  await publicClient.request({
    method: 'anvil_setCode' as never,
    params: [P256_VERIFIER_ADDRESS, p256RuntimeBytecode] as never,
  });

  console.log(`Set P256 verifier bytecode at ${P256_VERIFIER_ADDRESS}`);

  const passkeyVerifier = await deployFromArtifact({
    walletClient,
    publicClient,
    artifact: passkeyVerifierArtifact,
  });
  console.log(`PasskeyVerifier: ${passkeyVerifier}`);

  const zkTranscriptLib = await deployFromArtifact({
    walletClient,
    publicClient,
    artifact: honkLibraryArtifact,
  });
  console.log(`ZKTranscriptLib: ${zkTranscriptLib}`);

  const linkedHonkBytecode = linkBytecode(
    honkVerifierArtifact.bytecode.object,
    honkVerifierArtifact.bytecode.linkReferences,
    { ZKTranscriptLib: zkTranscriptLib },
  );

  const honkVerifier = await deployFromArtifact({
    walletClient,
    publicClient,
    artifact: honkVerifierArtifact,
    bytecodeOverride: linkedHonkBytecode,
  });
  console.log(`HonkVerifier: ${honkVerifier}`);

  const zkJwtVerifier = await deployFromArtifact({
    walletClient,
    publicClient,
    artifact: zkJwtVerifierArtifact,
    args: [honkVerifier],
  });
  console.log(`ZkJwtVerifier: ${zkJwtVerifier}`);

  const recoveryManagerImplementation = await deployFromArtifact({
    walletClient,
    publicClient,
    artifact: recoveryManagerArtifact,
  });
  console.log(`RecoveryManager implementation: ${recoveryManagerImplementation}`);

  const recoveryManagerFactory = await deployFromArtifact({
    walletClient,
    publicClient,
    artifact: recoveryManagerFactoryArtifact,
    args: [recoveryManagerImplementation, passkeyVerifier, zkJwtVerifier],
  });
  console.log(`RecoveryManagerFactory: ${recoveryManagerFactory}`);

  const exampleWalletFactory = await deployFromArtifact({
    walletClient,
    publicClient,
    artifact: exampleWalletFactoryArtifact,
  });
  console.log(`ExampleAAWalletFactory: ${exampleWalletFactory}`);

  const config: LocalAddressConfig = {
    chainId,
    rpcUrl,
    deployer: account.address,
    generatedAt: new Date().toISOString(),
    contracts: {
      passkeyVerifier,
      honkVerifier,
      zkJwtVerifier,
      recoveryManagerImplementation,
      recoveryManagerFactory,
      exampleWalletFactory,
    },
  };

  mkdirSync(path.dirname(OUTPUT_CONFIG_PATH), { recursive: true });
  writeFileSync(OUTPUT_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  console.log(`Wrote local address config: ${OUTPUT_CONFIG_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
