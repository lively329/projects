import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { flushDataFlowAudit, recordDataFlowTestResult } from './helpers/dataflow-mock-flow.js';

function resolveChromeProfileSourceRoot() {
  const configuredDir = process.env.CHROME_USER_DATA_DIR;
  if (configuredDir) {
    const resolvedDir = path.resolve(configuredDir);
    const parentDir = path.dirname(resolvedDir);

    if (path.basename(resolvedDir) === 'Default' && fs.existsSync(path.join(parentDir, 'Local State'))) {
      return parentDir;
    }

    return resolvedDir;
  }

  const chromeRoot = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  if (fs.existsSync(path.join(chromeRoot, 'Local State')) && fs.existsSync(path.join(chromeRoot, 'Default'))) {
    return chromeRoot;
  }

  return path.resolve(process.cwd(), '.chrome-data-mcp');
}

function shouldCopyChromeEntry(sourcePath: string) {
  const baseName = path.basename(sourcePath);

  if (baseName === 'SingletonLock' || baseName === 'SingletonCookie' || baseName === 'SingletonSocket') {
    return false;
  }

  if (baseName === 'Cache' || baseName === 'Code Cache' || baseName === 'GPUCache' || baseName === 'CacheStorage' || baseName === 'ScriptCache') {
    return false;
  }

  if (baseName === 'DawnGraphiteCache' || baseName === 'DawnWebGPUCache') {
    return false;
  }

  if (baseName === 'GraphiteDawnCache' || baseName === 'GrShaderCache' || baseName === 'ShaderCache') {
    return false;
  }

  if (baseName === 'Crashpad' || baseName === 'Safe Browsing' || baseName === 'BrowserMetrics') {
    return false;
  }

  if (baseName === 'Service Worker') {
    return false;
  }

  if (baseName === 'component_crx_cache' || baseName === 'extensions_crx_cache') {
    return false;
  }

  return true;
}

function cloneChromeProfile(sourceRoot: string) {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-sealos-'));
  fs.cpSync(sourceRoot, runtimeRoot, {
    recursive: true,
    filter: shouldCopyChromeEntry,
  });
  return runtimeRoot;
}

function resolveSlowMo() {
  const rawSlowMo = process.env.PLAYWRIGHT_SLOW_MO_MS ?? process.env.SLOW_MO_MS;

  if (!rawSlowMo) {
    return undefined;
  }

  const slowMo = Number(rawSlowMo);
  return Number.isFinite(slowMo) && slowMo > 0 ? slowMo : undefined;
}

export const test = base.extend<{
  context: BrowserContext;
  page: Page;
}>({
  context: async ({}, use) => {
    const sourceProfileRoot = resolveChromeProfileSourceRoot();

    if (!fs.existsSync(sourceProfileRoot)) {
      throw new Error(`Chrome user data dir not found: ${sourceProfileRoot}`);
    }

    // Clone the profile into a temp dir so Playwright can launch even when
    // the real Chrome profile is already in use by a normal browser session.
    const runtimeUserDataDir = cloneChromeProfile(sourceProfileRoot);

    try {
      const context = await chromium.launchPersistentContext(runtimeUserDataDir, {
        channel: 'chrome',
        headless: false,
        slowMo: resolveSlowMo(),
        args: ['--no-first-run', '--no-default-browser-check'],
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true,
      });

      await use(context);
      await context.close();
    } finally {
      fs.rmSync(runtimeUserDataDir, { recursive: true, force: true });
    }
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();

    try {
      await use(page);
    } finally {
      await page.close().catch(() => {});
    }
  },
});

test.afterEach(async ({}, testInfo) => {
  recordDataFlowTestResult(testInfo);
});

test.afterAll(async () => {
  await flushDataFlowAudit();
});

export { expect } from '@playwright/test';
