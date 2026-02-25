import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(projectRoot, '..', '..');
const sdkRoot = path.resolve(repoRoot, 'sdk');

export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.wasm', '**/*.wasm.gz'],
  optimizeDeps: {
    // Keep Noir/ACVM as native ESM so their `new URL("*.wasm", import.meta.url)`
    // points to real package files instead of pre-bundled stubs.
    exclude: ['@pse/social-recovery-sdk', '@noir-lang/noir_js', '@noir-lang/acvm_js', '@noir-lang/noirc_abi'],
  },
  server: {
    host: true,
    port: 5173,
    fs: {
      // Required because SDK is consumed via `file:../../sdk`, and Noir/ACVM wasm
      // assets are loaded from sdk/node_modules via /@fs/... during dev.
      allow: [repoRoot, sdkRoot],
    },
  },
});
