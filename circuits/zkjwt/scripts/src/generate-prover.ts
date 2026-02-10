#!/usr/bin/env node
/**
 * Main entry point for generating Prover.toml for zkjwt circuit
 *
 * Usage:
 *   npm run generate
 *   npm run generate -- --email="test@example.com" --salt=12345 --intent-hash=42
 *   npm run generate:google -- --jwt="<google id_token>" --salt=12345 --intent-hash=1
 *   npm run generate:google -- --jwt="<google id_token>" --allow-insecure-claims
 */
import path from "path";
import { fileURLToPath } from "url";
import { generateSelfSignedFixture } from "./fixtures/self-signed.js";
import { generateGoogleSignedFixture } from "./fixtures/google-signed.js";
import { serializeToProverToml, writeProverToml, ZkJwtInputs } from "./utils/prover-toml.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CliArgs {
  fixture: "self-signed" | "google";
  email: string;
  salt: bigint;
  intentHash: bigint;
  jwt?: string;
  allowInsecureClaims: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    fixture: "self-signed",
    email: "alice@test.com",
    salt: 12345n,
    intentHash: 1n, // Must be non-zero (circuit constraint)
    allowInsecureClaims: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--fixture=")) {
      const value = arg.slice("--fixture=".length);
      if (value !== "self-signed" && value !== "google") {
        throw new Error(`Invalid fixture type: "${value}". Must be "self-signed" or "google".`);
      }
      result.fixture = value;
    } else if (arg.startsWith("--email=")) {
      result.email = arg.slice("--email=".length);
    } else if (arg.startsWith("--salt=")) {
      result.salt = BigInt(arg.slice("--salt=".length));
    } else if (arg.startsWith("--intent-hash=")) {
      result.intentHash = BigInt(arg.slice("--intent-hash=".length));
    } else if (arg.startsWith("--jwt=")) {
      result.jwt = arg.slice("--jwt=".length);
    } else if (arg === "--allow-insecure-claims") {
      result.allowInsecureClaims = true;
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
  console.log(`  Fixture: ${args.fixture}`);
  console.log(`  Salt: ${args.salt}`);
  console.log(`  Intent Hash: ${args.intentHash}`);
  if (args.fixture === "google") {
    console.log(`  Allow insecure claims: ${args.allowInsecureClaims}`);
  }
  console.log("");

  let inputs: ZkJwtInputs;
  let expectedCommitment: string;

  if (args.fixture === "google") {
    // Google-signed JWT flow
    if (!args.jwt) {
      console.error("Error: --jwt=<token> is required for --fixture=google");
      console.error("  Get a token from https://developers.google.com/oauthplayground/");
      console.error('  Select "Google OAuth2 API v2 > email" scope, authorize, and copy the id_token.');
      process.exit(1);
    }

    console.log("Generating Google-signed JWT fixture...");
    const fixture = await generateGoogleSignedFixture({
      jwt: args.jwt,
      salt: args.salt,
      intentHash: args.intentHash,
      allowInsecureClaims: args.allowInsecureClaims,
    });

    console.log(`  Email: ${fixture.email}`);
    console.log(`  Key ID (kid): ${fixture.kid}`);
    console.log("");

    inputs = fixture.inputs;
    expectedCommitment = fixture.expectedCommitment;
  } else {
    // Self-signed JWT flow (existing behavior)
    console.log(`  Email: ${args.email}`);
    console.log("");

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

    inputs = fixture.inputs;
    expectedCommitment = fixture.expectedCommitment;
  }

  // Write Prover.toml
  const tomlContent = serializeToProverToml(inputs, 900, 128);
  const outputPath = path.resolve(__dirname, "../../Prover.toml");
  writeProverToml(tomlContent, outputPath);

  console.log(`Prover.toml written to: ${outputPath}`);
  console.log("");

  // Print verification info
  console.log("Verification Info:");
  console.log(`  Expected commitment: ${expectedCommitment}`);
  console.log("");

  // Print debug info
  console.log("Debug Info:");
  console.log(`  Base64 decode offset: ${inputs.base64_decode_offset}`);
  console.log(`  Email bytes: [${inputs.email.slice(0, 20).join(", ")}...]`);
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
