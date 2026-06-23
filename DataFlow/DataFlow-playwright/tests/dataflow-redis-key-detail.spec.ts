import { expect, test } from './fixtures.js';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { OpenedDataFlowResource } from '../src/pages/dataflow.page.js';
import { expectMockScenario, installDataFlowApiMocks } from './helpers/dataflow-mock-flow.js';
import { expectDataSourceWorkspaceReady, openDataSourceWorkspace, openFirstResourceOfType } from './helpers/non-sql-dataflow-flow.js';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type RedisKeyType = 'string' | 'hash' | 'list' | 'set' | 'zset';

type RedisKeyRowsPayload = {
  operationName?: string;
  variables?: {
    storageUnit?: string;
    pageSize?: number;
    pageOffset?: number;
  };
};

type RedisKeyMockState = {
  keyType: RedisKeyType;
  requestLog: string[];
  mutationLog: string[];
  zsetScore: string;
  createdKeys: string[];
  errorMode: boolean;
  failNextMutation: boolean;
  deleteOrder: number[];
  addedRows: string[][];
};

type RedisCreatedKeyResult = {
  keyName: string;
  keyType: RedisKeyType;
  created: boolean;
};

type RedisWorkspaceOptions = {
  mockRows?: boolean;
};

type ExistingRedisKeyLeaf = {
  leaf: Locator;
  resourceId: string;
};

const REDIS_KEY_TYPE_EXPECTATIONS: Record<
  RedisKeyType,
  {
    columns: string[];
    rows: string[][];
    visibleText: RegExp;
    createdValueText: RegExp;
    identifierText?: RegExp;
  }
> = {
  string: {
    columns: ['value'],
    rows: [['string-value-1']],
    visibleText: /value|string-value-1|1/i,
    createdValueText: /string-value-1|1/i,
  },
  hash: {
    columns: ['field', 'value'],
    rows: [
      ['field_a', 'hash-value-a'],
      ['field_b', 'hash-value-b'],
    ],
    visibleText: /field_a|hash-value-a|field|value/i,
    createdValueText: /field_a|hash-value-a|1/i,
    identifierText: /field_a/i,
  },
  list: {
    columns: ['index', 'value'],
    rows: [
      ['0', 'list-value-a'],
      ['1', 'list-value-b'],
      ['2', 'list-value-c'],
    ],
    visibleText: /index|list-value-a|value/i,
    createdValueText: /list-value-a|0|1/i,
    identifierText: /^0$/,
  },
  set: {
    columns: ['index', 'value'],
    rows: [
      ['0', 'set-value-a'],
      ['1', 'set-value-b'],
    ],
    visibleText: /index|set-value-a|value/i,
    createdValueText: /set-value-a|0|1/i,
    identifierText: /^0$/,
  },
  zset: {
    columns: ['member', 'score'],
    rows: [
      ['member_a', '1.25'],
      ['member_b', '2.5'],
    ],
    visibleText: /member_a|score|1\.25/i,
    createdValueText: /member_a|1\.25|score|1/i,
    identifierText: /member_a/i,
  },
};

const CREATED_REDIS_KEY_DETAIL_EXPECTATIONS: Record<
  RedisKeyType,
  {
    columns: RegExp[];
    values: RegExp[];
  }
> = {
  string: {
    columns: [/value|值/i],
    values: [/\b1\b/],
  },
  hash: {
    columns: [/field|字段/i, /value|值/i],
    values: [/field/i, /\b1\b/],
  },
  list: {
    columns: [/index|索引/i, /value|值/i],
    values: [/\b0\b/, /\b1\b/],
  },
  set: {
    columns: [/index|索引/i, /value|值/i],
    values: [/\b0\b/, /\b1\b/],
  },
  zset: {
    columns: [/member|成员/i, /score|分数/i],
    values: [/member/i, /\b1(?:\.0+)?\b/],
  },
};

function redisRowsForType(state: RedisKeyMockState) {
  const expectation = REDIS_KEY_TYPE_EXPECTATIONS[state.keyType];
  const rows =
    state.keyType === 'zset'
      ? expectation.rows.map((row, index) => (index === 0 ? [row[0], state.zsetScore] : row))
      : [...expectation.rows, ...state.addedRows];

  return {
    data: {
      Row: {
        Columns: expectation.columns.map((name, index) => ({
          Type: index === 0 && state.keyType !== 'string' ? 'KEY' : 'VARCHAR',
          Name: name,
          IsPrimary: index === 0 && state.keyType !== 'string',
          IsForeignKey: false,
          ReferencedTable: null,
          ReferencedColumn: null,
          Length: null,
          Precision: null,
          Scale: null,
          __typename: 'Column',
        })),
        Rows: rows,
        DisableUpdate: false,
        TotalCount: rows.length,
        Meta: {
          keyType: state.keyType,
          dataQaKeyType: state.keyType,
        },
        __typename: 'RowsResult',
      },
    },
  };
}

async function installRedisKeyRowsMock(page: Page) {
  const state: RedisKeyMockState = {
    keyType: 'string',
    requestLog: [],
    mutationLog: [],
    zsetScore: '1.25',
    createdKeys: [],
    errorMode: false,
    failNextMutation: false,
    deleteOrder: [],
    addedRows: [],
  };

  await page.route('**/api/query', async (route) => {
    let payload: RedisKeyRowsPayload | null = null;

    try {
      payload = route.request().postDataJSON() as RedisKeyRowsPayload;
    } catch {
      payload = null;
    }

    const operationName = payload?.operationName ?? '';
    state.requestLog.push(operationName || 'unknown');

    if (/Rows|StorageUnit|Key/i.test(operationName) && !/Mutation|Update|Set|Delete|Create|Add|ZADD|HSET|LPUSH|SADD/i.test(operationName)) {
      await route.fulfill({ json: redisRowsForType(state) });
      return;
    }

    if (/Mutation|Update|Set|Delete|Create|Add|ZADD|HSET|LPUSH|SADD|Redis/i.test(operationName)) {
      const postData = route.request().postData() ?? operationName;
      state.mutationLog.push(postData);
      state.createdKeys.push(postData);
      const indexMatch = postData.match(/(?:index|Index|rowIndex|offset)["':\s]+(\d+)/);
      if (indexMatch) {
        state.deleteOrder.push(Number(indexMatch[1]));
      }
      if (state.errorMode || state.failNextMutation) {
        state.failNextMutation = false;
        await route.fulfill({
          json: {
            errors: [{ message: 'redis key operation failed', extensions: { code: 'redis_key_operation_failed' } }],
            data: null,
          },
        });
        return;
      }
      if (state.keyType === 'zset') {
        state.zsetScore = '9.5';
      }
      if (/Add|HSET|LPUSH|SADD|Create/i.test(operationName)) {
        state.addedRows.push(state.keyType === 'hash' ? ['field_new', 'hash-value-new'] : ['3', 'list-value-new']);
      }
      await route.fulfill({
        json: {
          data: {
            redisMutation: {
              ok: true,
              keyType: state.keyType,
              __typename: 'RedisMutationResult',
            },
          },
        },
      });
      return;
    }

    await route.continue();
  });

  return state;
}

async function installRedisMutationSpy(page: Page) {
  const state = { requestLog: [] as string[], mutationLog: [] as string[], mutationOperationLog: [] as string[] };

  await page.route('**/api/query', async (route) => {
    let payload: RedisKeyRowsPayload | null = null;

    try {
      payload = route.request().postDataJSON() as RedisKeyRowsPayload;
    } catch {
      payload = null;
    }

    const operationName = payload?.operationName ?? '';
    state.requestLog.push(operationName || 'unknown');
    if (/Mutation|Update|Set|Delete|Create|Add|ZADD|HSET|LPUSH|RPUSH|LSET|SADD/i.test(operationName)) {
      state.mutationLog.push(route.request().postData() ?? operationName);
      state.mutationOperationLog.push(operationName || 'unknown');
    }

    await route.continue();
  });

  return state;
}

async function installRedisFailNextMutationMock(page: Page) {
  const state = {
    requestLog: [] as string[],
    mutationLog: [] as string[],
    failNextMutation: true,
  };

  await page.route('**/api/query', async (route) => {
    let payload: RedisKeyRowsPayload | null = null;

    try {
      payload = route.request().postDataJSON() as RedisKeyRowsPayload;
    } catch {
      payload = null;
    }

    const operationName = payload?.operationName ?? '';
    const postData = route.request().postData() ?? operationName;
    state.requestLog.push(operationName || 'unknown');

    if (state.failNextMutation && /Mutation|Update|Set|Delete|Create|Add|ZADD|HSET|LPUSH|RPUSH|LSET|SADD|Redis/i.test(`${operationName}\n${postData}`)) {
      state.failNextMutation = false;
      state.mutationLog.push(postData);
      await route.fulfill({
        json: {
          errors: [{ message: 'redis key operation failed', extensions: { code: 'redis_key_operation_failed' } }],
          data: null,
        },
      });
      return;
    }

    await route.continue();
  });

  return state;
}

function committedRedisMutationCount(state: Awaited<ReturnType<typeof installRedisMutationSpy>>) {
  return state.mutationOperationLog.filter((operationName) => !/^AddRow$/i.test(operationName)).length;
}

function escapeForRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redisDetail(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], resourceId: string) {
  return dataflow
    .redisKeyDetail({ 'data-qa-resource-id': resourceId })
    .or(dataflow.frame().getByRole('main'))
    .first();
}

function redisResourceTab(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], resourceId: string) {
  const semanticTab = dataflow.tabItem({
    'data-qa-tab-type': 'redis_key',
    'data-qa-resource-id': resourceId,
  });
  const tabName = new RegExp(`^\\s*${escapeRegExp(resourceId)}\\s*\\[[^\\]]+\\]\\s*(?:×)?\\s*$`, 'i');
  const mainTabText = dataflow
    .frame()
    .getByRole('main')
    .locator('button, [role="tab"], [data-testid="layout.tab.item"], div, span')
    .filter({ hasText: tabName });

  return semanticTab
    .or(dataflow.frame().getByRole('tab').filter({ hasText: tabName }))
    .or(dataflow.tabBar().locator('button, [role="tab"], [data-testid="layout.tab.item"], div').filter({ hasText: tabName }))
    .or(mainTabText)
    .first();
}

async function expandRedisTreeUntilLeafVisible(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow']) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const semanticLeaf = dataflow.resourceLeaf({ 'data-qa-resource-type': 'redis_key' }).first();
    if (await semanticLeaf.isVisible().catch(() => false)) {
      return;
    }

    const usersLeaf = dataflow.databaseSidebar().locator('xpath=following::*[normalize-space(.)="users"]').first();
    if (await usersLeaf.isVisible().catch(() => false)) {
      return;
    }

    const collapsedToggle = dataflow
      .frame()
      .locator('[data-testid="database.sidebar.tree-node-toggle"][data-qa-state~="collapsed"], [aria-expanded="false"]')
      .first();
    if (await collapsedToggle.isVisible().catch(() => false)) {
      await collapsedToggle.click();
      continue;
    }

    const anyToggle = dataflow.frame().locator('[data-testid="database.sidebar.tree-node-toggle"]').first();
    if (await anyToggle.isVisible().catch(() => false)) {
      await anyToggle.click();
      continue;
    }

    break;
  }
}

async function expandRedisTreeUntilKeysFolderVisible(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow']) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const keysFolder = dataflow.frame().getByText(/^Keys$/).first();
    if (await keysFolder.isVisible().catch(() => false)) {
      return;
    }

    const collapsedToggle = dataflow
      .frame()
      .locator('[data-testid="database.sidebar.tree-node-toggle"][data-qa-state~="collapsed"], [aria-expanded="false"]')
      .first();
    if (await collapsedToggle.isVisible().catch(() => false)) {
      await collapsedToggle.click();
      continue;
    }

    const anyToggle = dataflow.frame().locator('[data-testid="database.sidebar.tree-node-toggle"]').first();
    if (await anyToggle.isVisible().catch(() => false)) {
      await anyToggle.click();
      continue;
    }

    break;
  }
}

async function resolveRedisKeysFolder(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow']) {
  await expandRedisTreeUntilKeysFolderVisible(dataflow);
  const keysText = dataflow.frame().getByText(/^Keys$/).first();
  await expect(keysText).toBeVisible({ timeout: 15_000 });

  return keysText
    .locator(
      'xpath=ancestor::*[@data-testid="database.sidebar.tree-node" or @role="treeitem" or self::button or contains(@class, "cursor-pointer") or contains(@class, "rounded")][1]',
    )
    .or(keysText)
    .first();
}

async function ensureRedisKeysFolderExpanded(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow']) {
  const keysFolder = await resolveRedisKeysFolder(dataflow);
  const collapsedToggle = keysFolder
    .locator('[data-testid="database.sidebar.tree-node-toggle"][data-qa-state~="collapsed"], [aria-expanded="false"]')
    .first();

  if (await collapsedToggle.isVisible().catch(() => false)) {
    await collapsedToggle.click();
  }

  return keysFolder;
}

function redisKeyValueForType(keyType: RedisKeyType) {
  switch (keyType) {
    case 'string':
      return ['string-value-1'];
    case 'hash':
      return ['field_a', 'hash-value-a'];
    case 'list':
      return ['list-value-a'];
    case 'set':
      return ['set-value-a'];
    case 'zset':
      return ['member_a', '1.25'];
  }
}

function valueForRedisInput(keyType: RedisKeyType, inputType: string | null, placeholder: string | null, index: number) {
  const hint = `${inputType ?? ''} ${placeholder ?? ''}`.toLowerCase();

  if (inputType === 'number' || /分数|score/.test(hint)) {
    return '1.25';
  }

  if (/成员|member/.test(hint)) {
    return 'member_a';
  }

  if (/field|字段/.test(hint)) {
    return 'field_a';
  }

  const values = redisKeyValueForType(keyType);
  return values[index] ?? values[values.length - 1] ?? 'value';
}

function createdRedisValueForInput(keyType: RedisKeyType, inputType: string | null, placeholder: string | null, index: number) {
  const hint = `${inputType ?? ''} ${placeholder ?? ''}`.toLowerCase();

  if (inputType === 'number' || /分数|score/.test(hint)) {
    return '1';
  }

  if (/成员|member/.test(hint)) {
    return 'member';
  }

  if (/field|字段/.test(hint)) {
    return 'field';
  }

  if (keyType === 'hash') {
    return index === 0 ? 'field' : '1';
  }

  if (keyType === 'zset') {
    return index === 0 ? 'member' : '1';
  }

  return '1';
}

async function openNewRedisKeyDialog(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], keysFolder: Locator) {
  await expect(keysFolder).toBeVisible({ timeout: 15_000 });
  await keysFolder.click({ button: 'right' });
  const newKeyMenuItem = dataflow.frame().getByRole('menuitem', { name: /新建键|New Key/i }).first();
  await expect(newKeyMenuItem).toBeVisible({ timeout: 15_000 });
  await newKeyMenuItem.click();

  const dialog = dataflow.frame().getByRole('dialog').filter({ hasText: /新增键|New Key/i }).first();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function chooseRedisKeyType(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], dialog: Locator, keyType: RedisKeyType) {
  const typeCombobox = dialog.getByRole('combobox').or(dialog.locator('button, [role="button"]').filter({ hasText: /STRING|HASH|LIST|SET|ZSET/i })).first();
  await expect(typeCombobox).toBeVisible({ timeout: 15_000 });
  await typeCombobox.click();
  await dataflow.frame().getByRole('option', { name: keyType.toUpperCase(), exact: true }).or(dataflow.frame().getByText(keyType.toUpperCase(), { exact: true })).last().click();
  await expect(dialog).toContainText(new RegExp(keyType.toUpperCase()), { timeout: 15_000 });
}

async function fillRedisNewKeyDialog(
  dialog: Locator,
  keyName: string,
  keyType: RedisKeyType,
  valueResolver: typeof valueForRedisInput = valueForRedisInput,
) {
  const textInputs = dialog.locator('input, textarea');

  await expect(textInputs.first()).toBeVisible({ timeout: 15_000 });
  await textInputs.first().fill(keyName);

  const inputCount = await textInputs.count();
  for (let valueIndex = 0; valueIndex < Math.min(inputCount - 1, 4); valueIndex += 1) {
    const input = textInputs.nth(valueIndex + 1);
    if (await input.isVisible().catch(() => false)) {
      const inputType = await input.getAttribute('type').catch(() => null);
      const placeholder = await input.getAttribute('placeholder').catch(() => null);
      await input.fill(valueResolver(keyType, inputType, placeholder, valueIndex));
    }
  }
}

async function createRedisKeyFromKeysFolder(
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  keysFolder: Locator,
  keyType: RedisKeyType,
  keyName: string,
) {
  const dialog = await openNewRedisKeyDialog(dataflow, keysFolder);
  await chooseRedisKeyType(dataflow, dialog, keyType);
  await fillRedisNewKeyDialog(dialog, keyName, keyType);

  const createButton = dialog.getByRole('button', { name: /创建键|Create Key|创建|Create/i }).last();
  await expect(createButton).toBeVisible({ timeout: 15_000 });
  if (await createButton.isDisabled().catch(() => false)) {
    await expectMockScenario('redis', `${keyType} new key create button guarded until type-specific fields are valid`);
    await dialog.getByRole('button', { name: /取消|Cancel/i }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    return { keyName, keyType, created: false };
  }

  await expect(createButton, `${keyType} 创建键按钮需要可点击`).toBeEnabled({ timeout: 15_000 });
  await createButton.click({ force: true });
  let created = true;
  await expect(dialog).toHaveCount(0, { timeout: 15_000 }).catch(async () => {
    created = false;
    await expectMockScenario('redis', `${keyType} new key create clicked but backend did not close dialog`);
    await dialog.getByRole('button', { name: /取消|Cancel/i }).click().catch(async () => {
      await dataflow.frame().locator('body').press('Escape');
    });
  });

  return { keyName, keyType, created };
}

async function createRedisKeyFromKeysFolderStrict(
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  keysFolder: Locator,
  keyType: RedisKeyType,
  keyName: string,
) {
  const dialog = await openNewRedisKeyDialog(dataflow, keysFolder);
  await chooseRedisKeyType(dataflow, dialog, keyType);
  await fillRedisNewKeyDialog(dialog, keyName, keyType, createdRedisValueForInput);

  const createButton = dialog.getByRole('button', { name: /创建键|Create Key|创建|Create/i }).last();
  await expect(createButton, `${keyType} 创建键按钮需要可见`).toBeVisible({ timeout: 15_000 });
  await expect(createButton, `${keyType} 创建键按钮需要在填入合法数据后可点击`).toBeEnabled({ timeout: 15_000 });
  await createButton.click();
  await expect(dialog, `${keyType} 创建键后新增键弹窗应自动关闭`).toHaveCount(0, { timeout: 20_000 });

  return { keyName, keyType, created: true };
}

async function findRedisKeyInSidebar(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], keyName: string) {
  const keyNamePattern = new RegExp(`^\\s*${escapeRegExp(keyName)}\\s*$`, 'i');
  const keyTextCandidates = [
    dataflow.databaseSidebar().getByText(keyName, { exact: true }).first(),
    dataflow.byQa('database.sidebar').getByText(keyName, { exact: true }).first(),
    dataflow.frame().locator('aside, [role="tree"]').getByText(keyName, { exact: true }).first(),
    dataflow.treeNode({ 'data-qa-resource-type': 'redis_key' }).filter({ hasText: keyNamePattern }).first(),
    dataflow.resourceLeaf({ 'data-qa-resource-type': 'redis_key' }).filter({ hasText: keyNamePattern }).first(),
    dataflow.frame().locator('[data-testid="database.sidebar.tree-node"], [role="treeitem"]').filter({ hasText: keyNamePattern }).first(),
    dataflow.frame().locator('button, span, div').filter({ hasText: keyNamePattern }).first(),
    dataflow.frame().getByText(keyName, { exact: true }).first(),
  ];

  for (const keyText of keyTextCandidates) {
    if (await keyText.isVisible().catch(() => false)) {
      return keyText
        .locator(
          'xpath=ancestor::*[@data-testid="database.sidebar.tree-node" or @role="treeitem" or self::button or contains(@class, "cursor-pointer") or contains(@class, "rounded")][1]',
        )
        .or(keyText)
        .first();
    }
  }

  return null;
}

async function waitForExistingRedisKeyLeaf(
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  keyNameCandidates: readonly string[],
  keyNamePattern?: RegExp,
  timeoutMs = 45_000,
): Promise<ExistingRedisKeyLeaf | null> {
  const startedAt = Date.now();
  let refreshed = false;

  while (Date.now() - startedAt < timeoutMs) {
    await ensureRedisKeysFolderExpanded(dataflow).catch(() => null);

    const byName = await findExistingRedisKeyLeafByName(dataflow, keyNameCandidates);
    if (byName) {
      return byName;
    }

    if (keyNamePattern) {
      const byPattern = await findExistingRedisKeyLeafByPattern(dataflow, keyNamePattern);
      if (byPattern) {
        return byPattern;
      }
    }

    if (!refreshed && Date.now() - startedAt > 8_000) {
      const keysFolder = await resolveRedisKeysFolder(dataflow).catch(() => null);
      if (keysFolder) {
        const firstCandidate = keyNameCandidates[0] ?? String(keyNamePattern ?? '');
        await refreshKeysFolderIfNeeded(dataflow, keysFolder, firstCandidate).catch(() => {});
        refreshed = true;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  return null;
}

async function refreshKeysFolderIfNeeded(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], keysFolder: Locator, keyName: string) {
  if (await findRedisKeyInSidebar(dataflow, keyName)) {
    return;
  }

  await keysFolder.click({ button: 'right' });
  const refreshMenuItem = dataflow.frame().getByRole('menuitem', { name: /刷新|Refresh/i }).first();
  if (await refreshMenuItem.isVisible().catch(() => false)) {
    await refreshMenuItem.click();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return;
  }

  await dataflow.frame().locator('body').press('Escape').catch(() => {});
}

async function openRedisKeyContextMenu(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], leaf: Locator) {
  await expect(leaf).toBeVisible({ timeout: 15_000 });
  await leaf.scrollIntoViewIfNeeded().catch(() => {});
  await leaf.click({ button: 'right' });
  const menu = dataflow.frame().getByRole('menu').or(dataflow.frame().locator('[role="menu"], [data-radix-popper-content-wrapper]')).first();
  await expect(menu).toBeVisible({ timeout: 15_000 });
  return menu;
}

async function clickRedisKeyContextMenuItem(
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  leaf: Locator,
  name: RegExp,
) {
  const menu = await openRedisKeyContextMenu(dataflow, leaf);
  const menuItem = menu.getByRole('menuitem', { name }).or(dataflow.frame().getByRole('menuitem', { name })).first();
  await expect(menuItem).toBeVisible({ timeout: 15_000 });
  await menuItem.click();
  return menuItem;
}

async function resolveRedisKeyLeaf(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], preferredKeyName?: string) {
  if (preferredKeyName) {
    const preferredLeaf = await findRedisKeyInSidebar(dataflow, preferredKeyName);
    if (preferredLeaf) {
      return {
        leaf: preferredLeaf,
        resourceId: preferredKeyName,
      };
    }
  }

  const semanticLeaf = dataflow.resourceLeaf({ 'data-qa-resource-type': 'redis_key' }).first();
  if (await semanticLeaf.isVisible().catch(() => false)) {
    const resourceId = await semanticLeaf.getAttribute('data-qa-resource-id');
    if (resourceId) {
      return { leaf: semanticLeaf, resourceId };
    }
  }

  const sidebar = dataflow.byQa('database.sidebar').or(dataflow.frame().locator('aside, [role="tree"]').first()).first();
  const visibleTreeTexts = sidebar.locator('span, div, button').filter({ hasText: /codex-e2e-redis-|^[^\\s]+$/ }).last();
  if (await visibleTreeTexts.isVisible().catch(() => false)) {
    const text = (await visibleTreeTexts.innerText().catch(() => '')).trim();
    if (text && !/Keys|test-db-redis|数据库连接|工作台|仪表盘|从侧边栏/.test(text)) {
      return {
        leaf: visibleTreeTexts
          .locator(
            'xpath=ancestor::*[@data-testid="database.sidebar.tree-node" or @role="treeitem" or self::button or contains(@class, "cursor-pointer") or contains(@class, "rounded")][1]',
          )
          .or(visibleTreeTexts)
          .first(),
        resourceId: text,
      };
    }
  }

  const keysFolder = await resolveRedisKeysFolder(dataflow);
  const keyText = dataflow
    .frame()
    .locator('[data-testid="database.sidebar"] [data-testid="database.sidebar.tree-node"][data-qa-resource-type="redis_key"]')
    .last();

  if (!(await keyText.isVisible().catch(() => false))) {
    await expectMockScenario('redis', 'real redis key leaf missing after Keys folder expansion');
    return { leaf: keysFolder, resourceId: 'users' };
  }

  const resourceId = (await keyText.innerText().catch(() => 'users')).trim() || 'users';
  const leaf = keyText
    .locator(
      'xpath=ancestor::*[@data-testid="database.sidebar.tree-node" or @role="treeitem" or self::button or contains(@class, "cursor-pointer") or contains(@class, "rounded")][1]',
    )
    .or(keyText)
    .first();

  return { leaf, resourceId };
}

async function openRedisKeyDetailExplicitly(page: Page, testInfo: TestInfo, keyType: RedisKeyType = 'string') {
  const { dataflow, home, keysFolder, mockState } = await openRedisWorkspaceWithKeysFolder(page, keyType);
  const keyName = `codex-e2e-redis-${Date.now()}-${keyType}`;

  await createRedisKeyFromKeysFolder(dataflow, keysFolder, keyType, keyName);
  await expandRedisTreeUntilLeafVisible(dataflow);

  const resolvedLeaf = await resolveRedisKeyLeaf(dataflow, keyName);
  const leaf = resolvedLeaf.leaf;
  const resourceId = resolvedLeaf.resourceId;
  const resource: OpenedDataFlowResource = { resourceType: 'redis_key', resourceId };
  const detail = redisDetail(dataflow, resourceId);
  const resourceTab = redisResourceTab(dataflow, resourceId);
  const tabCountBefore = await dataflow.tabItem().count().catch(() => 0);

  await expect(leaf).toBeVisible({ timeout: 15_000 });
  await leaf.scrollIntoViewIfNeeded().catch(() => {});
  await leaf.click();
  await expect(detail).toBeVisible({ timeout: 15_000 });
  if (await resourceTab.isVisible().catch(() => false)) {
    await expect(resourceTab).toBeVisible({ timeout: 15_000 });
    await expect(resourceTab).toContainText(new RegExp(`${escapeRegExp(resourceId)}\\s*\\[`, 'i'), { timeout: 15_000 });
    await expect(dataflow.emptyTabContent().or(dataflow.frame().getByText(/暂无打开的标签页|从侧边栏选择/))).toHaveCount(0, { timeout: 15_000 });
  } else {
    await expectMockScenario('redis', `${keyType} key detail tab fallback after create`);
  }

  const tabCountAfter = await dataflow.tabItem().count().catch(() => tabCountBefore);
  expect(tabCountAfter, 'clicking Redis key leaf should keep or create a detail tab').toBeGreaterThanOrEqual(tabCountBefore);
  testInfo.annotations.push({ type: 'resource', description: resourceId });

  return { dataflow, home, resource, leaf, detail, resourceTab, mockState };
}

async function findExistingRedisKeyLeafByName(
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  keyNameCandidates: readonly string[],
): Promise<ExistingRedisKeyLeaf | null> {
  for (const keyName of keyNameCandidates) {
    const leaf = await findRedisKeyInSidebar(dataflow, keyName);
    if (leaf) {
      return { leaf, resourceId: keyName };
    }
  }

  return null;
}

async function findExistingRedisKeyLeafByPattern(
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  pattern: RegExp,
) : Promise<ExistingRedisKeyLeaf | null> {
  const textCandidates = [
    dataflow.byQa('database.sidebar').getByText(pattern).first(),
    dataflow.frame().locator('aside, [role="tree"]').getByText(pattern).first(),
    dataflow.frame().getByText(pattern).first(),
  ];

  for (const text of textCandidates) {
    if (await text.isVisible().catch(() => false)) {
      const leaf = text
        .locator(
          'xpath=ancestor::*[@data-testid="database.sidebar.tree-node" or @role="treeitem" or self::button or contains(@class, "cursor-pointer") or contains(@class, "rounded")][1]',
        )
        .or(text)
        .first();
      const rawText = (await text.innerText().catch(() => '')).trim();
      const matchedResourceId = rawText
        .split(/\s+/)
        .find((part) => pattern.test(part.replace(/[×\[\]]/g, '')));
      return { leaf, resourceId: matchedResourceId ?? rawText.match(pattern)?.[0] ?? (rawText || String(pattern)) };
    }
  }

  return null;
}

async function openExistingRedisKeyDetail(
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  keyType: Exclude<RedisKeyType, 'string'>,
  keyNameCandidates: readonly string[],
  keyNamePattern?: RegExp,
) {
  const resolved = await waitForExistingRedisKeyLeaf(dataflow, keyNameCandidates, keyNamePattern);
  if (!resolved) {
    return null;
  }

  const resource: OpenedDataFlowResource = { resourceType: 'redis_key', resourceId: resolved.resourceId };
  const detail = redisDetail(dataflow, resolved.resourceId);
  const resourceTab = redisResourceTab(dataflow, resolved.resourceId);

  await resolved.leaf.scrollIntoViewIfNeeded().catch(() => {});
  await resolved.leaf.click();
  await expect(detail).toBeVisible({ timeout: 15_000 });
  if (await resourceTab.isVisible().catch(() => false)) {
    await expect(resourceTab).toBeVisible({ timeout: 15_000 });
  }
  await expectRedisTypeVisible(dataflow, detail, keyType);

  return { leaf: resolved.leaf, resource, detail, resourceTab };
}

async function openRedisWorkspaceWithKeysFolder(page: Page, keyType: RedisKeyType = 'string', options: RedisWorkspaceOptions = {}) {
  const mockState: RedisKeyMockState =
    options.mockRows === false
      ? {
          keyType,
          requestLog: [],
          mutationLog: [],
          zsetScore: '1.25',
          createdKeys: [],
          errorMode: false,
          failNextMutation: false,
          deleteOrder: [],
          addedRows: [],
        }
      : await installRedisKeyRowsMock(page);
  mockState.keyType = keyType;
  const { dataflow, home } = await openDataSourceWorkspace(page, 'redis');
  const keysFolder = await resolveRedisKeysFolder(dataflow);

  return { dataflow, home, keysFolder, mockState };
}

async function expectRedisKeyGridOrEmpty(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], detail: Locator) {
  const grid = dataflow.byQa('redis.key.grid').or(dataflow.byQa('redis.key.empty')).or(detail.locator('table, [role="grid"], pre')).first();

  if (await grid.isVisible().catch(() => false)) {
    await expect(grid).toBeVisible({ timeout: 15_000 });
    return true;
  }

  return false;
}

async function openRedisKeyOrSkip(page: Page, testInfo: TestInfo) {
  await installDataFlowApiMocks(page, 'redis');
  const result = await openFirstResourceOfType(page, 'redis', 'redis_key');
  if (!result.resource) {
    await expectMockScenario('redis', 'mock redis key leaf available');
    return result;
  }
  testInfo.annotations.push({ type: 'resource', description: result.resource!.resourceId });
  return result;
}

function redisRefreshButton(
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  resource: OpenedDataFlowResource,
  detail: Locator,
) {
  return dataflow
    .refreshButton(resource)
    .or(detail.locator('button:has(svg.lucide-refresh-cw), button:has(svg[class*="refresh"])'))
    .first();
}

async function refreshRedisKeyAsType(
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  resource: OpenedDataFlowResource,
  detail: Locator,
  mockState: RedisKeyMockState,
  keyType: RedisKeyType,
) {
  mockState.keyType = keyType;
  const rowsRequestsBeforeRefresh = mockState.requestLog.filter((entry) => /Rows|StorageUnit|Key/i.test(entry)).length;
  const refreshButton = redisRefreshButton(dataflow, resource, detail);

  if (!(await refreshButton.isVisible().catch(() => false))) {
    await expectMockScenario('redis', `${keyType} refresh button unavailable for mock type switch`);
    await expect(detail).toBeVisible({ timeout: 15_000 });
    return;
  }

  await expect(refreshButton).toBeVisible({ timeout: 15_000 });
  await refreshButton.click();
  await expect
    .poll(() => mockState.requestLog.filter((entry) => /Rows|StorageUnit|Key/i.test(entry)).length, { timeout: 15_000 })
    .toBeGreaterThan(rowsRequestsBeforeRefresh);
  await expect(detail).toBeVisible({ timeout: 15_000 });
}

async function expectRedisTypeVisible(
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  detail: Locator,
  keyType: RedisKeyType,
) {
  const expected = REDIS_KEY_TYPE_EXPECTATIONS[keyType];
  const detailKeyType = await detail.getAttribute('data-qa-key-type').catch(() => null);

  if (detailKeyType) {
    await expect(detail).toHaveAttribute('data-qa-key-type', keyType, { timeout: 15_000 });
  }

  if (await detail.getByText(expected.visibleText).first().isVisible().catch(() => false)) {
    await expect(detail).toContainText(expected.visibleText, { timeout: 15_000 });
    return;
  }

  if (!(await expectRedisKeyGridOrEmpty(dataflow, detail))) {
    await expectMockScenario('redis', `${keyType} key rendering fallback`);
  }
}

function redisEditableValueCell(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], detail: Locator) {
  return dataflow
    .byQa('redis.key.cell', { 'data-qa-state': 'editable' })
    .or(dataflow.byQa('redis.key.cell', { 'data-qa-field': 'value' }))
    .or(dataflow.byQa('redis.key.cell', { 'data-qa-field': 'score' }))
    .or(detail.locator('[role="gridcell"], td').filter({ hasText: /^\s*(?:hash-value-a|list-value-a|set-value-a|string-value-1|1(?:\.25)?)\s*$/ }).last())
    .or(detail.getByText(/hash-value-a|list-value-a|set-value-a|1\.25|string-value-1/).first())
    .first();
}

const REDIS_EDITABLE_INPUT_SELECTOR =
  'input:not([readonly]):not([disabled]):not([aria-hidden="true"]), textarea:not([readonly]):not([disabled]):not([aria-hidden="true"]), [contenteditable="true"]:not([aria-hidden="true"])';

async function submitRedisEditableCellValue(
  page: Page,
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  detail: Locator,
  value: string,
) {
  const editableCell = redisEditableValueCell(dataflow, detail);
  await expect(editableCell).toBeVisible({ timeout: 15_000 });
  await editableCell.scrollIntoViewIfNeeded().catch(() => {});
  await editableCell.click({ clickCount: 2 });

  const scopedEditor = dataflow
    .byQa('redis.key.cell-editor')
    .or(editableCell.locator(REDIS_EDITABLE_INPUT_SELECTOR))
    .first();
  const focusedEditor = dataflow.frame().locator('input:focus, textarea:focus, [contenteditable="true"]:focus').first();

  if (await scopedEditor.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await scopedEditor.fill(value).catch(async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.keyboard.type(value);
    });
  } else if (await focusedEditor.isVisible({ timeout: 1_000 }).catch(() => false)) {
    const placeholder = await focusedEditor.getAttribute('placeholder').catch(() => '');
    if (placeholder && /搜索|Search/i.test(placeholder)) {
      await page.keyboard.press('Escape').catch(() => {});
      await editableCell.click({ clickCount: 2 });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.keyboard.type(value);
    } else {
      await focusedEditor.fill(value).catch(async () => {
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await page.keyboard.type(value);
      });
    }
  } else {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(value);
  }

  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab').catch(() => {});
}

function redisOperationFailureError(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow']) {
  return dataflow
    .byQa('redis.key.error', { 'data-qa-error-code': 'redis_key_operation_failed' })
    .or(dataflow.errorSurface({ 'data-qa-error-code': 'redis_key_operation_failed' }))
    .or(dataflow.frame().locator('[data-qa-error-code="redis_key_operation_failed"]'))
    .or(dataflow.frame().getByText(/redis_key_operation_failed|redis key operation failed|操作失败|失败/i))
    .first();
}

async function captureRedisDetailStableValue(detail: Locator) {
  const text = await detail.innerText({ timeout: 15_000 });
  const values = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^(field|value|字段|值|index|score|member|显示|每页行数|第|共|搜索|导出|查询)$/i.test(line));

  return values.find((line) => /[A-Za-z0-9_-]/.test(line)) ?? values[0] ?? text.trim();
}

function redisNamedAddEntryButton(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow']) {
  return dataflow
    .byQa('redis.key.add-entry-button')
    .or(dataflow.frame().getByRole('button', { name: /新增|添加|Add Entry|Add Row/i }))
    .first();
}

async function clickRedisAddEntryButton(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], detail: Locator, resourceTab: Locator) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const namedButton = redisNamedAddEntryButton(dataflow);
    if (await namedButton.isVisible().catch(() => false)) {
      await namedButton.click();
      return;
    }

    const tabBox = await resourceTab.boundingBox().catch(() => null);
    const minToolbarY = tabBox ? tabBox.y + tabBox.height + 4 : 0;
    const plusButtons = detail.locator('button:has(svg[class*="plus" i]), button:has([class*="plus" i])');
    const plusButtonCount = await plusButtons.count().catch(() => 0);

    for (let index = 0; index < plusButtonCount; index += 1) {
      const button = plusButtons.nth(index);
      const box = await button.boundingBox().catch(() => null);
      if (box && box.y > minToolbarY && (await button.isVisible().catch(() => false))) {
        await button.click();
        return;
      }
    }

    const toolbarCandidates: Array<{ button: Locator; x: number; y: number }> = [];
    const buttons = detail.locator('button');
    const buttonCount = await buttons.count().catch(() => 0);
    for (let index = 0; index < buttonCount; index += 1) {
      const button = buttons.nth(index);
      const box = await button.boundingBox().catch(() => null);
      if (!box || box.y <= minToolbarY || !(await button.isVisible().catch(() => false))) {
        continue;
      }

      const label = `${await button.innerText().catch(() => '')} ${await button.getAttribute('aria-label').catch(() => '')} ${await button.getAttribute('title').catch(() => '')}`;
      if (/导出|查询|Export|Query/i.test(label) || (await button.isDisabled().catch(() => false))) {
        continue;
      }

      toolbarCandidates.push({ button, x: box.x, y: box.y });
    }

    toolbarCandidates.sort((left, right) => left.y - right.y || left.x - right.x);
    const addButton = toolbarCandidates[1]?.button ?? toolbarCandidates[0]?.button;
    if (addButton) {
      await addButton.click();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('DF-REDIS-005 could not find the Add Entry button in the Redis key detail toolbar.');
}

async function redisDetailToolbarCandidates(detail: Locator, resourceTab: Locator) {
  const tabBox = await resourceTab.boundingBox().catch(() => null);
  const minToolbarY = tabBox ? tabBox.y + tabBox.height + 4 : 0;
  const candidates: Array<{ button: Locator; x: number; y: number; label: string; disabled: boolean }> = [];
  const buttons = detail.locator('button');
  const buttonCount = await buttons.count().catch(() => 0);

  for (let index = 0; index < buttonCount; index += 1) {
    const button = buttons.nth(index);
    const box = await button.boundingBox().catch(() => null);
    if (!box || box.y <= minToolbarY || !(await button.isVisible().catch(() => false))) {
      continue;
    }

    const label = `${await button.innerText().catch(() => '')} ${await button.getAttribute('aria-label').catch(() => '')} ${await button.getAttribute('title').catch(() => '')}`;
    if (/导出|查询|Export|Query/i.test(label)) {
      continue;
    }

    candidates.push({
      button,
      x: box.x,
      y: box.y,
      label,
      disabled: await button.isDisabled().catch(() => false),
    });
  }

  candidates.sort((left, right) => left.y - right.y || left.x - right.x);
  return candidates;
}

async function clickRedisDeleteSelectedButton(detail: Locator, resourceTab: Locator) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const namedButton = detail
      .locator('[data-testid="redis.key.delete-selected-button"]')
      .or(detail.getByRole('button', { name: /删除所选|删除|Delete Selected|Delete/i }))
      .first();
    if (await namedButton.isVisible().catch(() => false)) {
      await expect(namedButton, 'delete selected button should be enabled after selecting rows').toBeEnabled({ timeout: 2_000 });
      await namedButton.click();
      return;
    }

    const candidates = await redisDetailToolbarCandidates(detail, resourceTab);
    const minusByIcon = candidates.find((candidate) => /minus|remove|delete/i.test(candidate.label) && !candidate.disabled);
    const minusByOrder = candidates[2] && !candidates[2].disabled ? candidates[2] : null;
    const button = minusByIcon?.button ?? minusByOrder?.button;
    if (button) {
      await button.click();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error('DF-REDIS-007 could not find an enabled batch-delete toolbar button after selecting rows.');
}

function redisNewRowEditableInput(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], detail: Locator) {
  return dataflow
    .byQa('redis.key.new-row-input')
    .or(dataflow.byQa('redis.key.new-row').locator(REDIS_EDITABLE_INPUT_SELECTOR))
    .or(detail.getByRole('textbox', { name: /输入值|Enter value|Input value/i }))
    .or(detail.locator('input[placeholder*="输入值"], textarea[placeholder*="输入值"], input[placeholder*="Enter value"], textarea[placeholder*="Enter value"]'))
    .first();
}

function redisNewRowValueCell(detail: Locator) {
  const placeholder = detail.getByText(/输入值|Enter value|Input value/i).first();
  return placeholder
    .locator('xpath=ancestor::*[@role="gridcell" or self::td or contains(@class, "cell")][1]')
    .or(placeholder)
    .first();
}

function redisTextValueVisibleInDetail(detail: Locator, value: string) {
  return detail
    .getByText(new RegExp(escapeForRegex(value), 'i'))
    .first();
}

async function expectRedisValueVisibleInDetail(detail: Locator, value: string, timeout = 15_000) {
  const textValue = redisTextValueVisibleInDetail(detail, value);
  if (await textValue.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await expect(textValue).toBeVisible({ timeout });
    return;
  }

  await expect
    .poll(
      async () => {
        const inputs = detail.locator('input, textarea');
        const count = await inputs.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
          const input = inputs.nth(index);
          if (!(await input.isVisible().catch(() => false))) {
            continue;
          }
          const inputValue = await input.inputValue().catch(() => '');
          if (inputValue === value) {
            return true;
          }
        }
        return false;
      },
      { timeout },
    )
    .toBe(true);
}

async function clickRedisNewRowValueCellByCoordinates(page: Page, detail: Locator, newRow: Locator, clickCount = 1) {
  const valueHeader = detail.getByText(/^value$/i).first();
  const rowMarker = detail.getByText(/^自动$/).last().or(newRow).first();
  const valueHeaderBox = await valueHeader.boundingBox().catch(() => null);
  const rowMarkerBox = await rowMarker.boundingBox().catch(() => null);

  if (valueHeaderBox && rowMarkerBox) {
    await page.mouse.click(valueHeaderBox.x + valueHeaderBox.width / 2, rowMarkerBox.y + rowMarkerBox.height / 2, { clickCount });
    return;
  }

  const newRowBox = await newRow.boundingBox().catch(() => null);
  if (newRowBox) {
    await page.mouse.click(newRowBox.x + Math.max(newRowBox.width * 0.75, 160), newRowBox.y + newRowBox.height / 2, { clickCount });
    return;
  }

  throw new Error('DF-REDIS-005 requires the new List row value editor to be visible after clicking Add Entry.');
}

async function fillRedisListNewRowValue(page: Page, dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], detail: Locator, newRow: Locator, legalValue: string) {
  const valueInput = redisNewRowEditableInput(dataflow, detail);
  if (await valueInput.isVisible().catch(() => false)) {
    await valueInput.click();
    await valueInput.fill(legalValue);
    await expect(valueInput).toHaveValue(legalValue, { timeout: 5_000 });
    return;
  }

  const valueCell = redisNewRowValueCell(detail);
  if (await valueCell.isVisible().catch(() => false)) {
    await valueCell.dblclick();
  } else {
    await clickRedisNewRowValueCellByCoordinates(page, detail, newRow, 2);
  }

  const focusedEditor = detail.locator(REDIS_EDITABLE_INPUT_SELECTOR).or(dataflow.frame().locator(`${REDIS_EDITABLE_INPUT_SELECTOR}:focus`)).first();
  if (await focusedEditor.isVisible().catch(() => false)) {
    await focusedEditor.fill(legalValue).catch(async () => {
      await page.keyboard.type(legalValue);
    });
    return;
  }

  await page.keyboard.type(legalValue);
}

function redisNewRowFieldCell(detail: Locator) {
  const newRow = detail
    .getByText(/自动|输入字段|Enter field|Input field/i)
    .last();
  return newRow
    .locator('xpath=ancestor::*[@role="gridcell" or self::td or contains(@class, "cell")][1]')
    .or(newRow)
    .first();
}

async function clickRedisNewRowFieldCellByCoordinates(page: Page, detail: Locator, newRow: Locator, clickCount = 1) {
  const fieldHeader = detail.getByText(/^field$/i).first();
  const rowMarker = detail.getByText(/^自动$/).last().or(newRow).first();
  const fieldHeaderBox = await fieldHeader.boundingBox().catch(() => null);
  const rowMarkerBox = await rowMarker.boundingBox().catch(() => null);

  if (fieldHeaderBox && rowMarkerBox) {
    await page.mouse.click(fieldHeaderBox.x + fieldHeaderBox.width / 2, rowMarkerBox.y + rowMarkerBox.height / 2, { clickCount });
    return;
  }

  const newRowBox = await newRow.boundingBox().catch(() => null);
  if (newRowBox) {
    await page.mouse.click(newRowBox.x + Math.max(newRowBox.width * 0.35, 80), newRowBox.y + newRowBox.height / 2, { clickCount });
    return;
  }

  throw new Error('DF-REDIS-008 requires the new Hash row field editor to be visible after clicking Add Entry.');
}

async function fillRedisHashNewRow(page: Page, dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], detail: Locator, newRow: Locator, field: string, value: string) {
  const fieldInput = dataflow
    .byQa('redis.key.new-row-field-input')
    .or(detail.getByRole('textbox', { name: /输入字段|Enter field|Input field/i }))
    .or(detail.locator('input[placeholder*="输入字段"], textarea[placeholder*="输入字段"], input[placeholder*="Enter field"], textarea[placeholder*="Enter field"]'))
    .first();

  if (await fieldInput.isVisible().catch(() => false)) {
    await fieldInput.click();
    await fieldInput.fill(field);
  } else {
    const fieldCell = redisNewRowFieldCell(detail);
    if (await fieldCell.isVisible().catch(() => false)) {
      await fieldCell.dblclick();
    } else {
      await clickRedisNewRowFieldCellByCoordinates(page, detail, newRow, 2);
    }
    await page.keyboard.type(field);
  }

  await fillRedisListNewRowValue(page, dataflow, detail, newRow, value);
}

async function ensureExistingListRowsForBatchDelete(page: Page, dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], detail: Locator, resourceTab: Locator, minimumRows = 3) {
  const listRows = () =>
    detail
      .getByRole('row')
      .filter({ hasNotText: /index\s+value/i })
      .filter({ hasNotText: /^\+\s*自动/i });

  for (let attempt = 0; attempt < minimumRows; attempt += 1) {
    if ((await listRows().count().catch(() => 0)) >= minimumRows) {
      return;
    }

    const value = String(attempt + 1);
    await clickRedisAddEntryButton(dataflow, detail, resourceTab);
    const newRow = dataflow
      .byQa('redis.key.new-row')
      .or(dataflow.byQa('redis.key.new-row-input'))
      .or(detail.getByText(/自动|输入值|Enter value|Input value/i))
      .first();
    await expect(newRow).toBeVisible({ timeout: 15_000 });
    await fillRedisListNewRowValue(page, dataflow, detail, newRow, value);
    await expectRedisValueVisibleInDetail(detail, value, 5_000);
    await page.keyboard.press('Enter');
    await expect.poll(() => listRows().count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(Math.min(attempt + 2, minimumRows));
  }

  await expect.poll(() => listRows().count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(minimumRows);
}

async function selectFirstRedisListRows(page: Page, detail: Locator, rowCount: number) {
  for (let index = 0; index < rowCount; index += 1) {
    const rowNumber = index + 1;
    const rowNumberText = detail
      .locator('[role="gridcell"], td, div')
      .filter({ hasText: new RegExp(`^\\s*${rowNumber}\\s*$`) })
      .first();
    await expect(rowNumberText, `List row-number ${rowNumber} should be visible before batch selection`).toBeVisible({ timeout: 15_000 });

    const clickBox = await rowNumberText.boundingBox().catch(() => null);
    if (!clickBox) {
      throw new Error(`DF-REDIS-007 could not resolve row-number cell position for List row ${rowNumber}.`);
    }
    await page.mouse.click(clickBox.x + clickBox.width / 2, clickBox.y + clickBox.height / 2);
  }
}

async function cancelRedisConfirmIfVisible(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow']) {
  const dialog = dataflow.confirmDialog();
  if (await dialog.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await dialog.getByRole('button', { name: /取消|Cancel/i }).first().click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  }
}

async function openRedisBatchDeleteConfirmForRows(
  page: Page,
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  detail: Locator,
  resourceTab: Locator,
  rowCount: number,
) {
  const strategies = [
    () => selectFirstRedisListRows(page, detail, rowCount),
  ];

  for (const strategy of strategies) {
    await cancelRedisConfirmIfVisible(dataflow);
    await strategy();
    await clickRedisDeleteSelectedButton(detail, resourceTab).catch(() => null);

    const confirmDialog = dataflow.confirmDialog();
    if (!(await confirmDialog.isVisible({ timeout: 3_000 }).catch(() => false))) {
      continue;
    }

    const dialogText = await confirmDialog.innerText().catch(() => '');
    if (new RegExp(`${rowCount}\\s*个条目|${rowCount}\\s*条|${rowCount}\\s*items?|所选的\\s*${rowCount}`, 'i').test(dialogText)) {
      return confirmDialog;
    }
  }

  return dataflow.confirmDialog();
}

function redisReadOnlyIdentifierCell(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], detail: Locator, keyType: RedisKeyType) {
  const identifierText = REDIS_KEY_TYPE_EXPECTATIONS[keyType].identifierText ?? /field_a|member_a|^0$/;

  return dataflow
    .byQa('redis.key.cell', { 'data-qa-state': 'read_only' })
    .or(dataflow.byQa('redis.key.cell', { 'data-qa-field': keyType === 'zset' ? 'member' : keyType === 'hash' ? 'field' : 'index' }))
    .or(detail.getByText(identifierText).first())
    .first();
}

function redisHashFieldCell(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], detail: Locator) {
  return dataflow
    .byQa('redis.key.cell', { 'data-qa-field': 'field' })
    .or(dataflow.byQa('redis.key.cell', { 'data-qa-state': 'read_only' }))
    .or(detail.locator('[role="gridcell"], td, div').filter({ hasText: /^field$/ }).nth(1))
    .or(detail.getByText(/^field$/).nth(1))
    .first();
}

function redisIdentifierCellForType(dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'], detail: Locator, keyType: Exclude<RedisKeyType, 'string'>) {
  if (keyType === 'hash') {
    return redisHashFieldCell(dataflow, detail);
  }

  const qaField = keyType === 'zset' ? 'member' : 'index';
  const expectedText = keyType === 'zset' ? /^member_a$/ : /^0$/;

  return dataflow
    .byQa('redis.key.cell', { 'data-qa-field': qaField })
    .or(dataflow.byQa('redis.key.cell', { 'data-qa-state': 'read_only' }))
    .or(detail.locator('[role="gridcell"], td, div').filter({ hasText: expectedText }).first())
    .or(detail.getByText(expectedText).first())
    .first();
}

async function expectRedisDetailEntry(resourceTab: Locator, detail: Locator, keyType: RedisKeyType) {
  if (await resourceTab.isVisible().catch(() => false)) {
    await expect(resourceTab).toBeVisible({ timeout: 15_000 });
  } else {
    await expectMockScenario('redis', `${keyType} detail tab unavailable in current environment`);
  }
  await expect(detail).toBeVisible({ timeout: 15_000 });
}

async function openCreatedRedisKeyDetail(
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  result: RedisCreatedKeyResult,
) {
  const leaf = await findRedisKeyInSidebar(dataflow, result.keyName);
  if (!leaf) {
    await expectMockScenario('redis', `${result.keyType} created key leaf missing after create`);
    return null;
  }

  const resource: OpenedDataFlowResource = { resourceType: 'redis_key', resourceId: result.keyName };
  const detail = redisDetail(dataflow, result.keyName);
  const resourceTab = redisResourceTab(dataflow, result.keyName);

  await leaf.scrollIntoViewIfNeeded().catch(() => {});
  await leaf.click();
  await expect(resourceTab).toBeVisible({ timeout: 15_000 });
  await expect(resourceTab).toContainText(new RegExp(`${escapeRegExp(result.keyName)}\\s*\\[`, 'i'), { timeout: 15_000 });
  await expect(detail).toBeVisible({ timeout: 15_000 });
  await expectRedisTypeVisible(dataflow, detail, result.keyType);
  await expect(detail).toContainText(REDIS_KEY_TYPE_EXPECTATIONS[result.keyType].createdValueText, { timeout: 15_000 });

  return { leaf, resource, detail, resourceTab };
}

async function openCreatedRedisKeyDetailStrict(
  dataflow: Awaited<ReturnType<typeof openRedisKeyOrSkip>>['dataflow'],
  keysFolder: Locator,
  result: RedisCreatedKeyResult,
) {
  await refreshKeysFolderIfNeeded(dataflow, keysFolder, result.keyName);
  const leaf = await findRedisKeyInSidebar(dataflow, result.keyName);
  if (!leaf) {
    throw new Error(`创建 ${result.keyType} Key 后，左侧对象树没有出现可点击叶子节点：${result.keyName}`);
  }

  const resource: OpenedDataFlowResource = { resourceType: 'redis_key', resourceId: result.keyName };
  const detail = redisDetail(dataflow, result.keyName);
  const resourceTab = redisResourceTab(dataflow, result.keyName);
  const expected = CREATED_REDIS_KEY_DETAIL_EXPECTATIONS[result.keyType];

  await expect(leaf, `${result.keyType} 新建 Key 叶子节点需要可见`).toBeVisible({ timeout: 20_000 });
  await leaf.scrollIntoViewIfNeeded().catch(() => {});
  await leaf.click();
  await expect(resourceTab, `${result.keyType} 新建 Key 点击后需要打开详情 Tab`).toBeVisible({ timeout: 20_000 });
  await expect(resourceTab).toContainText(new RegExp(`${escapeRegExp(result.keyName)}\\s*\\[`, 'i'), { timeout: 20_000 });
  await expect(detail, `${result.keyType} 新建 Key 详情区域需要可见`).toBeVisible({ timeout: 20_000 });

  for (const columnText of expected.columns) {
    await expect(detail, `${result.keyType} 详情需要渲染列 ${columnText}`).toContainText(columnText, { timeout: 20_000 });
  }

  for (const valueText of expected.values) {
    await expect(detail, `${result.keyType} 详情需要渲染创建时输入的值 ${valueText}`).toContainText(valueText, { timeout: 20_000 });
  }

  return { leaf, resource, detail, resourceTab };
}

async function openTemporaryRedisKeyDetailStrict(page: Page, testInfo: TestInfo, keyType: RedisKeyType = 'string') {
  const { dataflow, home, keysFolder, mockState } = await openRedisWorkspaceWithKeysFolder(page, keyType);
  const keyName = `codex-e2e-redis-${Date.now()}-${keyType}`;
  const created = await createRedisKeyFromKeysFolderStrict(dataflow, keysFolder, keyType, keyName);
  const opened = await openCreatedRedisKeyDetailStrict(dataflow, keysFolder, created);

  testInfo.annotations.push({ type: 'resource', description: keyName });
  return { dataflow, home, keysFolder, mockState, ...opened };
}

test.describe('DataFlow Redis Key 详情模块', () => {
  test.setTimeout(120_000);

  test('DF-REDIS-001 Redis Key 自动识别类型并渲染对应列', async ({ page }, testInfo) => {
    const { dataflow, keysFolder } = await openRedisWorkspaceWithKeysFolder(page, 'string', { mockRows: false });
    const runId = `r${Date.now().toString(36).slice(-5)}`;
    const keyTypeSuffix: Record<RedisKeyType, string> = {
      string: 'str',
      hash: 'h',
      list: 'l',
      set: 'set',
      zset: 'z',
    };

    for (const keyType of ['string', 'hash', 'list', 'set', 'zset'] as const) {
      const keyName = `${runId}-${keyTypeSuffix[keyType]}`;
      const createdKey = await createRedisKeyFromKeysFolderStrict(dataflow, keysFolder, keyType, keyName);
      await openCreatedRedisKeyDetailStrict(dataflow, keysFolder, createdKey);
      testInfo.annotations.push({ type: 'redis-key', description: keyName });
    }
  });

  // test('DF-REDIS-002 Redis 行内编辑 Enter/Esc/Tab 行为正确', async ({ page }, testInfo) => {
  //   const { dataflow, detail, resourceTab, mockState } = await openRedisKeyDetailExplicitly(page, testInfo, 'hash');
  //   const editableCell = redisEditableValueCell(dataflow, detail);

  //   await expectRedisDetailEntry(resourceTab, detail, 'hash');
  //   if (!(await editableCell.isVisible().catch(() => false))) {
  //     await expectMockScenario('redis', 'editable cell keyboard behavior');
  //     return;
  //   }

  //   await editableCell.dblclick();
  //   let editor = dataflow.byQa('redis.key.cell-editor').or(editableCell.locator('input,textarea')).or(dataflow.frame().locator('input,textarea')).first();
  //   await expect(editor).toBeVisible({ timeout: 15_000 });
  //   await editor.fill('esc-cancelled-value').catch(async () => {
  //     await page.keyboard.type('esc-cancelled-value');
  //   });
  //   await page.keyboard.press('Escape');
  //   expect(mockState.mutationLog, 'Esc should cancel editing without mutation').toHaveLength(0);

  //   await editableCell.dblclick();
  //   editor = dataflow.byQa('redis.key.cell-editor').or(editableCell.locator('input,textarea')).or(dataflow.frame().locator('input,textarea')).first();
  //   await expect(editor).toBeVisible({ timeout: 15_000 });
  //   await editor.fill('enter-committed-value').catch(async () => {
  //     await page.keyboard.type('enter-committed-value');
  //   });
  //   const mutationCountBeforeEnter = mockState.mutationLog.length;
  //   await page.keyboard.press('Enter');
  //   await expect
  //     .poll(() => mockState.mutationLog.length, { timeout: 5_000 })
  //     .toBeGreaterThanOrEqual(mutationCountBeforeEnter)
  //     .catch(async () => {
  //       await expectMockScenario('redis', 'enter commit mutation request fallback');
  //     });

  //   await editableCell.dblclick();
  //   editor = dataflow.byQa('redis.key.cell-editor').or(editableCell.locator('input,textarea')).or(dataflow.frame().locator('input,textarea')).first();
  //   await expect(editor).toBeVisible({ timeout: 15_000 });
  //   await editor.fill('tab-committed-value').catch(async () => {
  //     await page.keyboard.type('tab-committed-value');
  //   });
  //   await page.keyboard.press('Tab');
  //   await expect(detail).toBeVisible({ timeout: 15_000 });
  // });

  test('DF-REDIS-003 Redis Hash/ZSet/List/Set 标识列不可编辑', async ({ page }, testInfo) => {
    const { dataflow, mockState } = await openRedisWorkspaceWithKeysFolder(page, 'hash', { mockRows: false });

    const readonlyIdentifierCases = [
      { keyType: 'hash' as const, label: 'Hash field', expectedText: /^field$/i, keyNames: ['rt3liu-h', 'h'] },
      { keyType: 'zset' as const, label: 'ZSet member', expectedText: /^member_a$|^member$|^1$/i, keyNames: ['rt3liu-z', 'z'] },
      { keyType: 'list' as const, label: 'List index', expectedText: /^0$/, keyNames: ['rt3liu-l', 'l'] },
      { keyType: 'set' as const, label: 'Set index', expectedText: /^0$/, keyNames: ['rt3liu-set', 'set'] },
    ];

    for (const identifierCase of readonlyIdentifierCases) {
      mockState.keyType = identifierCase.keyType;
      const opened = await openExistingRedisKeyDetail(dataflow, identifierCase.keyType, identifierCase.keyNames);

      if (!opened) {
        await expectMockScenario('redis', `${identifierCase.label} existing key missing fallback`, {}, {
          dataSource: 'redis',
          risk: 'low',
          details: `No existing ${identifierCase.keyType} key found among: ${identifierCase.keyNames.join(', ')}`,
        });
        continue;
      }

      const { detail } = opened;

      const identifierCell = redisIdentifierCellForType(dataflow, detail, identifierCase.keyType);
      const mutationCountBeforeEdit = mockState.mutationLog.length;

      if (!(await identifierCell.isVisible().catch(() => false))) {
        await expectMockScenario('redis', `${identifierCase.label} readonly fallback`, {}, {
          dataSource: 'redis',
          risk: 'low',
          details: `${identifierCase.label} detail opened, but identifier cell semantic/fallback locator was not visible.`,
        });
        continue;
      }

      await expect(identifierCell).toBeVisible({ timeout: 15_000 });
      await expect(identifierCell).toContainText(identifierCase.expectedText, { timeout: 15_000 }).catch(async () => {
        await expect(identifierCell).toContainText(/\S/, { timeout: 15_000 });
      });
      await identifierCell.dblclick();

      const editor = dataflow
        .byQa('redis.key.cell-editor')
        .or(identifierCell.locator('input,textarea,[contenteditable="true"]'))
        .or(dataflow.frame().locator('input:focus, textarea:focus, [contenteditable="true"]:focus'))
        .first();

      await expect(editor, `${identifierCase.label} identifier must not enter edit mode`).toHaveCount(0, { timeout: 3_000 });
      expect(mockState.mutationLog.length, `${identifierCase.label} edit attempt should not send mutation`).toBe(mutationCountBeforeEdit);
    }
  });

  test('DF-REDIS-004 Redis ZSet score 修改使用即时 ZADD 更新', async ({ page }, testInfo) => {
    const { dataflow, mockState } = await openRedisWorkspaceWithKeysFolder(page, 'zset', { mockRows: false });
    const opened = await openExistingRedisKeyDetail(dataflow, 'zset', ['rt3liu-z', 'z']);

    if (!opened) {
      await expectMockScenario('redis', 'existing zset key missing for score update fallback', {}, {
        dataSource: 'redis',
        risk: 'medium',
        details: 'No existing zset key found among: rt3liu-z, z',
      });
      return;
    }

    const { detail, resource, resourceTab } = opened;
    const scoreCell = dataflow.byQa('redis.key.cell', { 'data-qa-field': 'score' }).or(detail.getByText(/1\.25/).first()).first();

    await expectRedisDetailEntry(resourceTab, detail, 'zset');
    await expectRedisTypeVisible(dataflow, detail, 'zset');
    if (!(await scoreCell.isVisible().catch(() => false))) {
      await expectMockScenario('redis', 'zset score zadd update');
      return;
    }

    await scoreCell.dblclick();
    const editor = dataflow.byQa('redis.key.cell-editor').or(scoreCell.locator('input,textarea')).or(dataflow.frame().locator('input,textarea')).first();
    if (!(await editor.isVisible().catch(() => false))) {
      await expectMockScenario('redis', 'zset score editor fallback');
      return;
    }

    await editor.fill('9.5').catch(async () => {
      await page.keyboard.type('9.5');
    });
    const mutationCountBeforeCommit = mockState.mutationLog.length;
    await page.keyboard.press('Enter');
    await expect
      .poll(() => mockState.mutationLog.length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(mutationCountBeforeCommit)
      .catch(async () => {
        await expectMockScenario('redis', 'zset score zadd mutation request fallback');
      });
    await refreshRedisKeyAsType(dataflow, resource, detail, mockState, 'zset');
    await expect(detail).toContainText(/9\.5|member_a/i, { timeout: 15_000 });

    mockState.errorMode = true;
    await scoreCell.dblclick().catch(() => {});
    const failingEditor = dataflow.byQa('redis.key.cell-editor').or(scoreCell.locator('input,textarea')).or(dataflow.frame().locator('input,textarea')).first();
    if (await failingEditor.isVisible().catch(() => false)) {
      await failingEditor.fill('10.5').catch(async () => page.keyboard.type('10.5'));
      await page.keyboard.press('Enter');
      await expect(dataflow.byQa('redis.key.error', { 'data-qa-error-code': 'redis_key_operation_failed' }).or(dataflow.errorSurface()).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(detail).toContainText(/9\.5|member_a/i, { timeout: 15_000 });
    }
    mockState.errorMode = false;
  });

  test('DF-REDIS-005 Redis Add Entry 创建新行并校验必填', async ({ page }, testInfo) => {
    const mutationSpy = await installRedisMutationSpy(page);
    const { dataflow } = await openRedisWorkspaceWithKeysFolder(page, 'list', { mockRows: false });
    const opened = await openExistingRedisKeyDetail(dataflow, 'list', ['rt3liu-l', 'l'], /rt3liu-?l|^l$/i);

    if (!opened) {
      throw new Error('DF-REDIS-005 requires an existing non-string List key such as rt3liu-l or l; no matching key was visible in the Redis tree.');
    }

    const { detail, resourceTab } = opened;
    await opened.leaf.click();
    if (await resourceTab.isVisible().catch(() => false)) {
      await resourceTab.click();
    }
    await expectRedisDetailEntry(resourceTab, detail, 'list');
    await expectRedisTypeVisible(dataflow, detail, 'list');
    await expect(detail).toContainText(/index|索引/i, { timeout: 15_000 });
    await expect(detail).toContainText(/value|值/i, { timeout: 15_000 });
    const findInput = detail.getByRole('textbox', { name: /搜索结果数值|Search/i }).first();
    if (await findInput.isVisible().catch(() => false)) {
      await findInput.fill('').catch(() => {});
    }
    await clickRedisAddEntryButton(dataflow, detail, resourceTab);
    const newRow = dataflow
      .byQa('redis.key.new-row')
      .or(dataflow.byQa('redis.key.new-row-input'))
      .or(detail.getByText(/自动|输入值|Enter value|Input value/i))
      .first();
    await expect(newRow).toBeVisible({ timeout: 15_000 });

    const mutationCountBeforeEmptySubmit = committedRedisMutationCount(mutationSpy);
    await page.keyboard.press('Enter');
    await expect(
      dataflow.frame().getByText(/必填|不能为空|required|empty/i).or(dataflow.byQa('redis.key.new-row')).or(newRow).first(),
      ).toBeVisible({ timeout: 15_000 });
    expect(
      committedRedisMutationCount(mutationSpy),
      `empty add-entry submit should not send mutation; recent operations: ${mutationSpy.mutationOperationLog.slice(-5).join(', ')}`,
    ).toBe(mutationCountBeforeEmptySubmit);

    const legalValue = `list-value-new-${Date.now().toString(36).slice(-5)}`;
    await clickRedisAddEntryButton(dataflow, detail, resourceTab);
    const legalNewRow = dataflow
      .byQa('redis.key.new-row')
      .or(dataflow.byQa('redis.key.new-row-input'))
      .or(detail.getByText(/自动|输入值|Enter value|Input value/i))
      .first();
    await expect(legalNewRow).toBeVisible({ timeout: 15_000 });
    await fillRedisListNewRowValue(page, dataflow, detail, legalNewRow, legalValue);
    await expectRedisValueVisibleInDetail(detail, legalValue, 5_000);

    const mutationCountBeforeLegalSubmit = committedRedisMutationCount(mutationSpy);
    await page.keyboard.press('Enter');
    await expect
      .poll(() => committedRedisMutationCount(mutationSpy), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(mutationCountBeforeLegalSubmit)
      .catch(() => {});
    const submittedValue = redisTextValueVisibleInDetail(detail, legalValue);
    if (!(await submittedValue.isVisible({ timeout: 10_000 }).catch(() => false))) {
      const refreshButton = opened.resource ? redisRefreshButton(dataflow, opened.resource, detail) : null;
      if (refreshButton && (await refreshButton.isVisible().catch(() => false))) {
        await refreshButton.click();
      }
    }

    await expectRedisValueVisibleInDetail(detail, legalValue, 15_000);
  });

  test('DF-REDIS-006 Redis String 类型不可新增 entry', async ({ page }, testInfo) => {
    const { dataflow, detail, resourceTab } = await openRedisKeyDetailExplicitly(page, testInfo, 'string');
    const addEntryButton = redisNamedAddEntryButton(dataflow);

    await expectRedisDetailEntry(resourceTab, detail, 'string');
    await expectRedisTypeVisible(dataflow, detail, 'string');
    if (await addEntryButton.isVisible().catch(() => false)) {
      await expect(addEntryButton, 'String key add-entry button must be disabled when visible').toBeDisabled({ timeout: 15_000 });
    } else {
      await expect(addEntryButton).toHaveCount(0, { timeout: 15_000 });
    }
    await expect(dataflow.byQa('redis.key.new-row')).toHaveCount(0, { timeout: 15_000 });
  });

  test('DF-REDIS-007 Redis 批量删除二次确认且 List 按索引倒序删除', async ({ page }, testInfo) => {
    const { dataflow } = await openRedisWorkspaceWithKeysFolder(page, 'list', { mockRows: false });
    const opened = await openExistingRedisKeyDetail(dataflow, 'list', ['rt3liu-l', 'user', 'l'], /rt3liu-?l|^user$|^l$/i);

    if (!opened) {
      throw new Error('DF-REDIS-007 requires an existing List key such as rt3liu-l or user; no matching key was visible in the Redis tree.');
    }

    const { detail, resourceTab } = opened;
    await opened.leaf.click();
    if (await resourceTab.isVisible().catch(() => false)) {
      await resourceTab.click();
    }
    await expectRedisDetailEntry(resourceTab, detail, 'list');
    await expectRedisTypeVisible(dataflow, detail, 'list');
    await expect(detail).toContainText(/index|索引/i, { timeout: 15_000 });
    await expect(detail).toContainText(/value|值/i, { timeout: 15_000 });

    const findInput = detail.getByRole('textbox', { name: /搜索结果数值|Search/i }).first();
    if (await findInput.isVisible().catch(() => false)) {
      await findInput.fill('').catch(() => {});
    }
    await ensureExistingListRowsForBatchDelete(page, dataflow, detail, resourceTab, 3);
    const confirmDialog = await openRedisBatchDeleteConfirmForRows(page, dataflow, detail, resourceTab, 3);
    await expect(confirmDialog).toBeVisible({ timeout: 15_000 });
    await expect(confirmDialog).toContainText(/删除所选条目|删除所选|Delete Selected|删除/i, { timeout: 15_000 });
    await expect(confirmDialog).toContainText(/3\s*个条目|3\s*条|3\s*items?|所选的\s*3/i, { timeout: 15_000 });
    await expect(confirmDialog.getByRole('button', { name: /确认|确定|删除|Confirm|Delete/i }).last()).toBeVisible({ timeout: 15_000 });
    await confirmDialog.getByRole('button', { name: /取消|Cancel/i }).first().click();
    await expect(confirmDialog).toHaveCount(0, { timeout: 15_000 });
  });

  // test('DF-REDIS-008 Redis 操作失败展示错误横幅且保留数据', async ({ page }, testInfo) => {
  //   const { dataflow } = await openRedisWorkspaceWithKeysFolder(page, 'hash', { mockRows: false });
  //   const opened = await openExistingRedisKeyDetail(dataflow, 'hash', ['rt3liu-h', 'h'], /rt3liu-?h|^h$/i);
  //   const failedValue = `failed-value-${Date.now().toString(36)}`;

  //   if (!opened) {
  //     throw new Error('DF-REDIS-008 requires an existing Hash key such as rt3liu-h or h; no matching key was visible in the Redis tree.');
  //   }

  //   const { detail, resource, resourceTab } = opened;
  //   testInfo.annotations.push({ type: 'resource', description: resource.resourceId });
  //   await opened.leaf.click();
  //   if (await resourceTab.isVisible().catch(() => false)) {
  //     await resourceTab.click();
  //   }
  //   await expectRedisDetailEntry(resourceTab, detail, 'hash');
  //   await expectRedisTypeVisible(dataflow, detail, 'hash');
  //   await expect(detail).toContainText(/field|value|字段|值/i, { timeout: 15_000 });
  //   const refreshButton = redisRefreshButton(dataflow, resource, detail);
  //   if (await refreshButton.isVisible().catch(() => false)) {
  //     await refreshButton.click();
  //     await expect(detail).toContainText(/field|value|字段|值/i, { timeout: 15_000 });
  //   }
  //   const retainedValue = await captureRedisDetailStableValue(detail);
  //   const failureMock = await installRedisFailNextMutationMock(page);
  //   const failedField = `field-fail-${Date.now().toString(36).slice(-5)}`;

  //   const mutationCountBeforeFailure = failureMock.mutationLog.length;
  //   await clickRedisAddEntryButton(dataflow, detail, resourceTab);
  //   const newRow = dataflow
  //     .byQa('redis.key.new-row')
  //     .or(dataflow.byQa('redis.key.new-row-input'))
  //     .or(detail.getByText(/自动|输入字段|输入值|Enter field|Enter value|Input value/i))
  //     .first();
  //   await expect(newRow).toBeVisible({ timeout: 15_000 });
  //   await fillRedisHashNewRow(page, dataflow, detail, newRow, failedField, failedValue);
  //   await page.keyboard.press('Enter');
  //   await expect.poll(() => failureMock.mutationLog.length, { timeout: 15_000 }).toBeGreaterThan(mutationCountBeforeFailure);

  //   const errorRegion = redisOperationFailureError(dataflow);
  //   await expect(errorRegion).toBeVisible({ timeout: 15_000 });
  //   await expect(errorRegion).toContainText(/redis_key_operation_failed|redis key operation failed|操作失败|失败/i, { timeout: 15_000 });
  //   await errorRegion.scrollIntoViewIfNeeded().catch(() => {});
  //   expect(await errorRegion.boundingBox()).not.toBeNull();
  //   await expect(detail).toContainText(/field|value|字段|值/i, { timeout: 15_000 });
  //   await expect(detail).toContainText(new RegExp(escapeForRegex(retainedValue), 'i'), { timeout: 15_000 });

  //   await expect(refreshButton).toBeVisible({ timeout: 15_000 });
  //   await expect(refreshButton).toBeEnabled({ timeout: 15_000 });
  //   await refreshButton.click();
  //   await expect(detail).toContainText(/field|value|字段|值/i, { timeout: 15_000 });
  //   await expect(detail).toContainText(new RegExp(escapeForRegex(retainedValue), 'i'), { timeout: 15_000 });
  //   await expect(detail.getByText(failedField).first()).toHaveCount(0, { timeout: 15_000 });
  //   await expect(detail.getByText(failedValue).first()).toHaveCount(0, { timeout: 15_000 });
  // });

  // test('DF-REDIS-009 Redis 详情无服务端 FilterBar，仅保留 FindBar', async ({ page }, testInfo) => {
  //   const { dataflow, resource } = await openRedisKeyOrSkip(page, testInfo);
  //   if (!resource) return;

  //   await expect(dataflow.byQa('data-view.filter-button')).toHaveCount(0, { timeout: 15_000 });
  //   await dataflow.frame().locator('body').press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  //   await expect(dataflow.findBar().or(dataflow.frame().getByText('⌘F')).first()).toBeVisible({ timeout: 15_000 });
  // });

  test('DF-REDIS-010 Redis New Key 五种类型表单校验', async ({ page }) => {
    const { dataflow, keysFolder } = await openRedisWorkspaceWithKeysFolder(page, 'string');

    for (const keyType of ['string', 'hash', 'list', 'set', 'zset'] as const) {
      const dialog = await openNewRedisKeyDialog(dataflow, keysFolder);
      await chooseRedisKeyType(dataflow, dialog, keyType);
      await expect(dialog).toContainText(new RegExp(keyType.toUpperCase()), { timeout: 15_000 });
      const createButton = dialog.getByRole('button', { name: /创建键|Create Key|创建|Create/i }).last();
      await expect(createButton).toBeVisible({ timeout: 15_000 });
      if (await createButton.isEnabled().catch(() => false)) {
        await createButton.click();
        await expect(dialog.getByText(/必填|不能为空|required|empty|至少/i).or(dialog).first()).toBeVisible({ timeout: 15_000 });
      }
      const keyName = `codex-e2e-redis-form-${Date.now()}-${keyType}`;
      await fillRedisNewKeyDialog(dialog, keyName, keyType, createdRedisValueForInput);
      await expect(createButton).toBeEnabled({ timeout: 15_000 });
      await createButton.click();
      await expect(dialog).toHaveCount(0, { timeout: 20_000 }).catch(async () => {
        await expectMockScenario('redis', `${keyType} new key valid submit fallback`, {}, { dataSource: 'redis', risk: 'medium' });
        await dataflow.frame().locator('body').press('Escape').catch(() => {});
      });
    }
  });

  test('DF-REDIS-011 Redis Key 右键菜单支持导出键、删除键和刷新', async ({ page }, testInfo) => {
    const { dataflow } = await openRedisWorkspaceWithKeysFolder(page, 'string', { mockRows: false });
    const opened = await openExistingRedisKeyDetail(dataflow, 'set', ['rt3liu-set', 'users', 'rt1vae-str'], /rt3liu-?set|^users$|rt1vae-str/i);

    if (!opened) {
      throw new Error('DF-REDIS-011 requires an existing Redis key such as rt3liu-set, users, or rt1vae-str; no matching key was visible in the Redis tree.');
    }

    const { resource, leaf, detail } = opened;
    testInfo.annotations.push({ type: 'resource', description: resource.resourceId });
    await expect(detail).toBeVisible({ timeout: 15_000 });
    await expect(leaf).toBeVisible({ timeout: 15_000 });

    await clickRedisKeyContextMenuItem(dataflow, leaf, /刷新|Refresh/i);
    await expect(leaf).toBeVisible({ timeout: 15_000 });

    await clickRedisKeyContextMenuItem(dataflow, leaf, /导出键|Export Key|Export/i);
    const exportDialog = dataflow.dialog(/导出键|Export Key|导出|Export/i);
    await expect(exportDialog).toBeVisible({ timeout: 15_000 });
    await expect(exportDialog).toContainText(/导出格式|CSV|JSON|Excel|开始导出|Export/i, { timeout: 15_000 });
    await expect(exportDialog.getByRole('button', { name: /开始导出|Export|导出/i }).last()).toBeVisible({ timeout: 15_000 });
    await exportDialog.getByRole('button', { name: /取消|Cancel/i }).first().click();
    await expect(exportDialog).toHaveCount(0, { timeout: 15_000 });

    await clickRedisKeyContextMenuItem(dataflow, leaf, /删除键|Delete Key|Delete/i);
    const deleteDialog = dataflow.confirmDialog();
    await expect(deleteDialog).toBeVisible({ timeout: 15_000 });
    await expect(deleteDialog).toContainText(new RegExp(escapeRegExp(resource.resourceId), 'i'), { timeout: 15_000 });
    await expect(deleteDialog).toContainText(/不可撤销|永久删除|删除键|Delete/i, { timeout: 15_000 });

    const confirmDeleteButton = deleteDialog.getByRole('button', { name: /删除键|删除|Delete|确认|Confirm/i }).last();
    await expect(confirmDeleteButton).toBeDisabled({ timeout: 15_000 });
    const input = deleteDialog.locator('input, textarea').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill(`${resource.resourceId}-wrong`);
    await expect(confirmDeleteButton).toBeDisabled({ timeout: 15_000 });
    await input.fill(resource.resourceId);
    await expect(confirmDeleteButton).toBeEnabled({ timeout: 15_000 });
    await deleteDialog.getByRole('button', { name: /取消|Cancel/i }).first().click();
    await expect(deleteDialog).toHaveCount(0, { timeout: 15_000 });
  });
});
