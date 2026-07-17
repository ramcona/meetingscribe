import test from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, '../..');

test('Vite client production build test', async (t) => {
  await t.test('Client builds successfully without syntax or dependency errors', () => {
    try {
      // Run vite build to verify the entire JSX / CSS bundler pipeline
      execSync('npm run build', { cwd: clientDir, stdio: 'pipe' });
      assert.ok(true, 'Build completed successfully');
    } catch (error) {
      const errorMsg = error.stderr?.toString() || error.stdout?.toString() || error.message;
      assert.fail(`Vite build failed:\n${errorMsg}`);
    }
  });
});
