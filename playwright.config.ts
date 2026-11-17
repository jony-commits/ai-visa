import { defineConfig } from '@playwright/test';

const e2ePort = 3105;
const runId = `${Date.now()}`;
const sqlitePath = `/tmp/meridian-e2e-${runId}.db`;
const storageDir = `/tmp/meridian-e2e-storage-${runId}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    headless: true,
    launchOptions: {
      args: ['--no-sandbox'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx tsx server.ts',
    url: `http://127.0.0.1:${e2ePort}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      PORT: String(e2ePort),
      NODE_ENV: 'development',
      SQLITE_PATH: sqlitePath,
      PRIVATE_STORAGE_DIR: storageDir,
      APP_ENCRYPTION_KEY: 'meridian-playwright-e2e-encryption-key-32b',
    },
  },
});
