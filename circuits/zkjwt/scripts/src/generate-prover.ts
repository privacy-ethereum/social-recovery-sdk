#!/usr/bin/env node
/**
 * Main entry point for generating Prover.toml for zkjwt circuit
 *
 * Usage:
 *   npm run generate
 *   npm run generate -- --email="test@example.com" --salt=12345 --intent-hash=0
 */
import path from "path";
import { fileURLToPath } from "url";
import { generateSelfSignedFixture } from "./fixtures/self-signed.js";
import { serializeToProverToml, writeProverToml } from "./utils/prover-toml.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CliArgs {
  email: string;
  salt: bigint;
  intentHash: bigint;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    email: "alice@test.com",
    salt: 12345n,
    intentHash: 1n, // Must be non-zero (circuit constraint)
  };

  for (const arg of args) {
    if (arg.startsWith("--email=")) {
      result.email = arg.slice("--email=".length);
    } else if (arg.startsWith("--salt=")) {
      result.salt = BigInt(arg.slice("--salt=".length));
    } else if (arg.startsWith("--intent-hash=")) {
      result.intentHash = BigInt(arg.slice("--intent-hash=".length));
    }
  }

  return result;
}

async function main() {
  console.log("zkJWT Prover.toml Generator");
  console.log("===========================\n");

  // Parse CLI args (or use defaults)
  const args = parseArgs();

  console.log("Configuration:");
  console.log(`  Email: ${args.email}`);
  console.log(`  Salt: ${args.salt}`);
  console.log(`  Intent Hash: ${args.intentHash}`);
  console.log("");

  // Generate fixture
  console.log("Generating self-signed JWT fixture...");
  const fixture = await generateSelfSignedFixture({
    email: args.email,
    salt: args.salt,
    intentHash: args.intentHash,
  });

  console.log("JWT generated successfully!");
  console.log(`  JWT length: ${fixture.jwt.length} characters`);
  console.log(`  Data length: ${fixture.inputs.dataLength} bytes`);
  console.log("");

  // Write Prover.toml
  const tomlContent = serializeToProverToml(fixture.inputs, 900, 128);
  const outputPath = path.resolve(__dirname, "../../Prover.toml");
  writeProverToml(tomlContent, outputPath);

  console.log(`Prover.toml written to: ${outputPath}`);
  console.log("");

  // Print verification info
  console.log("Verification Info:");
  console.log(`  Expected commitment: ${fixture.expectedCommitment}`);
  console.log("");

  // Print debug info
  console.log("Debug Info:");
  console.log(`  Base64 decode offset: ${fixture.inputs.base64_decode_offset}`);
  console.log(`  Email bytes: [${fixture.inputs.email.slice(0, 20).join(", ")}...]`);
  console.log("");

  console.log("Next steps (from circuits/zkjwt/):");
  console.log("  1. nargo execute                                              (generate witness)");
  console.log("  2. bb prove -b ./target/zkjwt.json -w ./target/zkjwt.gz --write_vk -o target  (prove)");
  console.log("  3. bb verify -p ./target/proof -k ./target/vk                 (verify)");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
