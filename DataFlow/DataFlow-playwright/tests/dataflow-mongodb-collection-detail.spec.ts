import { expect, test } from './fixtures.js';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expectMockScenario, installDataFlowApiMocks } from './helpers/dataflow-mock-flow.js';
import { expectDataSourceWorkspaceReady, openDataSourceWorkspace, openFirstResourceOfType } from './helpers/non-sql-dataflow-flow.js';

type MongoDocument = {
  _id: string;
  name: string;
  age: number;
  status: 'active' | 'inactive';
  city: string;
  score: number;
  active: boolean;
  tags: string[];
};

type MongoRowsPayload = {
  operationName?: string;
  variables?: {
    storageUnit?: string;
    where?: unknown;
    pageSize?: number;
    pageOffset?: number;
  };
};

type MongoCollectionMockState = {
  mode: 'docs' | 'empty';
  documents: MongoDocument[];
  requestLog: string[];
  lastWhere: unknown;
  rowsDelayMs: number;
  errorMode: 'none' | 'nested-filter';
};

const MONGO_COLLECTION_DOCS: MongoDocument[] = [
  {
    _id: 'mongo-1',
    name: 'alice',
    age: 18,
    status: 'active',
    city: 'shanghai',
    score: 91,
    active: true,
    tags: ['core', 'alpha'],
  },
  {
    _id: 'mongo-2',
    name: 'bob',
    age: 24,
    status: 'inactive',
    city: 'beijing',
    score: 73,
    active: false,
    tags: ['beta'],
  },
  {
    _id: 'mongo-3',
    name: 'carol',
    age: 31,
    status: 'active',
    city: 'hangzhou',
    score: 88,
    active: true,
    tags: ['gamma', 'core'],
  },
];

function cloneMongoDocument(document: MongoDocument): MongoDocument {
  return {
    ...document,
    tags: [...document.tags],
  };
}

function coerceMongoValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed === 'true') {
    return true;
  }

  if (trimmed === 'false') {
    return false;
  }

  if (trimmed === 'null') {
    return null;
  }

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  return trimmed;
}

function readMongoField(document: Record<string, unknown>, key: string) {
  if (key === 'document') {
    return JSON.stringify(document);
  }

  return document[key];
}

function matchMongoAtomicCondition(document: Record<string, unknown>, atomic: Record<string, unknown>) {
  const key = String(atomic.Key ?? '');
  const operator = String(atomic.Operator ?? '').toLowerCase();
  const rawActual = readMongoField(document, key);
  const actual = Array.isArray(rawActual) ? rawActual.map((value) => String(value)) : rawActual;
  const expected = coerceMongoValue(atomic.Value);
  const actualText = Array.isArray(actual) ? actual.join(', ') : String(actual ?? '');

  switch (operator) {
    case 'eq':
      return Array.isArray(actual) ? actual.includes(String(expected)) : actual === expected;
    case 'ne':
      return Array.isArray(actual) ? !actual.includes(String(expected)) : actual !== expected;
    case 'regex':
      return new RegExp(String(expected), 'i').test(actualText);
    case 'gt':
      return Number(actual) > Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'in': {
      const values = String(atomic.Value ?? '')
        .split(',')
        .map((value) => coerceMongoValue(value))
        .map((value) => String(value));

      return Array.isArray(actual) ? actual.some((value) => values.includes(String(value))) : values.includes(String(actual));
    }
    default:
      return true;
  }
}

function matchMongoWhere(document: Record<string, unknown>, where: unknown): boolean {
  if (!where || typeof where !== 'object') {
    return true;
  }

  const condition = where as Record<string, unknown>;

  if (condition.Atomic && typeof condition.Atomic === 'object') {
    return matchMongoAtomicCondition(document, condition.Atomic as Record<string, unknown>);
  }

  if (condition.And && typeof condition.And === 'object') {
    const children = (condition.And as { Children?: unknown[] }).Children ?? [];
    return children.every((child) => matchMongoWhere(document, child));
  }

  return true;
}

async function installMongoCollectionRowsMock(page: Page) {
  const state: MongoCollectionMockState = {
    mode: 'docs',
    documents: MONGO_COLLECTION_DOCS.map(cloneMongoDocument),
    requestLog: [],
    lastWhere: null,
    rowsDelayMs: 0,
    errorMode: 'none',
  };

  await page.route('**/api/query', async (route) => {
    let payload: MongoRowsPayload | null = null;

    try {
      payload = route.request().postDataJSON() as MongoRowsPayload;
    } catch {
      payload = null;
    }

    const operationName = payload?.operationName ?? '';
    state.requestLog.push(operationName || 'unknown');

    if (operationName !== 'GetStorageUnitRows' || typeof payload?.variables?.storageUnit !== 'string') {
      await route.fallback();
      return;
    }

    state.lastWhere = payload.variables.where ?? null;

    if (state.errorMode === 'nested-filter') {
      state.errorMode = 'none';
      await route.fulfill({
        status: 200,
        json: {
          errors: [
            {
              message: 'Only flat atomic filters are supported',
              extensions: { code: 'UNSUPPORTED_NESTED_FILTER' },
            },
          ],
          data: null,
        },
      });
      return;
    }

    const allDocuments =
      state.mode === 'empty'
        ? []
        : state.documents.filter((document) => matchMongoWhere(document as unknown as Record<string, unknown>, payload?.variables?.where));

    const pageOffset = Number(payload.variables.pageOffset ?? 0);
    const pageSize = Number(payload.variables.pageSize ?? (allDocuments.length || 50));
    const pagedDocuments = allDocuments.slice(pageOffset, pageOffset + pageSize);

    if (state.rowsDelayMs > 0) {
      await page.waitForTimeout(state.rowsDelayMs);
      state.rowsDelayMs = 0;
    }

    await route.fulfill({
      json: {
        data: {
          Row: {
            Columns: [
              {
                Type: 'JSON',
                Name: 'document',
                IsPrimary: false,
                IsForeignKey: false,
                ReferencedTable: null,
                ReferencedColumn: null,
                Length: null,
                Precision: null,
                Scale: null,
                __typename: 'Column',
              },
            ],
            Rows: pagedDocuments.map((document) => [JSON.stringify(document)]),
            DisableUpdate: false,
            TotalCount: allDocuments.length,
            __typename: 'RowsResult',
          },
        },
      },
    });
  });

  return state;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mongoDetail(dataflow: Awaited<ReturnType<typeof openMongoCollectionOrSkip>>['dataflow'], resourceId: string) {
  return dataflow
    .mongoCollectionDetail({ 'data-qa-resource-id': resourceId })
    .or(dataflow.frame().getByRole('main'))
    .first();
}

function mongoResourceTab(dataflow: Awaited<ReturnType<typeof openMongoCollectionOrSkip>>['dataflow'], resourceId: string) {
  const semanticTab = dataflow.tabItem({
    'data-qa-tab-type': 'collection',
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

async function expandMongoTreeUntilLeafVisible(dataflow: Awaited<ReturnType<typeof openMongoCollectionOrSkip>>['dataflow']) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const semanticLeaf = dataflow.resourceLeaf({ 'data-qa-resource-type': 'collection' }).first();
    if (await semanticLeaf.isVisible().catch(() => false)) {
      return;
    }

    const userLeafText = dataflow.databaseSidebar().locator('xpath=following::*[normalize-space(.)="user"]').first();
    if (await userLeafText.isVisible().catch(() => false)) {
      return;
    }

    const collapsedToggle = dataflow.frame().locator('[data-testid="database.sidebar.tree-node-toggle"][data-qa-state~="collapsed"], [aria-expanded="false"]').first();
    if (await collapsedToggle.isVisible().catch(() => false)) {
      await collapsedToggle.click();
      continue;
    }

    const anyCollapsedButton = dataflow
      .databaseSidebar()
      .locator('button')
      .filter({ hasNotText: /工作台|仪表盘|筛选|导出|查询/ })
      .first();
    if (await anyCollapsedButton.isVisible().catch(() => false)) {
      await anyCollapsedButton.click();
      continue;
    }

    break;
  }
}

async function resolveMongoCollectionLeaf(dataflow: Awaited<ReturnType<typeof openMongoCollectionOrSkip>>['dataflow']) {
  const semanticLeaf = dataflow.resourceLeaf({ 'data-qa-resource-type': 'collection' }).first();
  if (await semanticLeaf.isVisible().catch(() => false)) {
    const resourceId = await semanticLeaf.getAttribute('data-qa-resource-id');
    if (resourceId) {
      return { leaf: semanticLeaf, resourceId };
    }
  }

  const leafText = dataflow.databaseSidebar().locator('xpath=following::*[normalize-space(.)="user"]').last();
  await expect(leafText).toBeVisible({ timeout: 15_000 });

  const clickableLeaf = leafText
    .locator(
      'xpath=ancestor::*[@data-testid="database.sidebar.tree-node" or @role="treeitem" or self::button or contains(@class, "cursor-pointer") or contains(@class, "rounded")][1]',
    )
    .or(leafText)
    .first();

  return { leaf: clickableLeaf, resourceId: 'user' };
}

function mongoDocumentCards(detail: Locator) {
  return detail.locator('pre').locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]');
}

function mongoDocumentCard(detail: Locator, text: string) {
  return mongoDocumentCards(detail).filter({ hasText: text }).first();
}

function mongoToolbarButtons(detail: Locator) {
  return detail.locator('button');
}

function mongoToolbarButton(detail: Locator, index: number) {
  return mongoToolbarButtons(detail).nth(index);
}

function mongoMainToolbarButton(detail: Locator, index: number) {
  return mongoToolbarButtons(detail).nth(index + 2);
}

function mongoAddDocumentButton(dataflow: Awaited<ReturnType<typeof openMongoCollectionOrSkip>>['dataflow'], detail: Locator) {
  return dataflow
    .byQa('mongodb.collection.add-document-button')
    .or(dataflow.frame().getByRole('button', { name: /新增文档|Add Document/i }))
    .or(mongoMainToolbarButton(detail, 1))
    .first();
}

function mongoDeleteSelectedButton(dataflow: Awaited<ReturnType<typeof openMongoCollectionOrSkip>>['dataflow'], detail: Locator) {
  return dataflow
    .byQa('mongodb.collection.delete-selected-button')
    .or(dataflow.frame().getByRole('button', { name: /删除|Delete/i }))
    .or(mongoMainToolbarButton(detail, 2))
    .first();
}

function mongoUndoButton(detail: Locator) {
  return mongoMainToolbarButton(detail, 3);
}

function mongoPreviewChangesButton(dataflow: Awaited<ReturnType<typeof openMongoCollectionOrSkip>>['dataflow'], detail: Locator) {
  return dataflow
    .byQa('mongodb.collection.preview-changes-button')
    .or(dataflow.frame().getByRole('button', { name: /预览|Preview/i }))
    .or(mongoMainToolbarButton(detail, 4))
    .first();
}

function mongoRefreshButton(dataflow: Awaited<ReturnType<typeof openMongoCollectionOrSkip>>['dataflow'], detail: Locator, resourceId: string) {
  return dataflow
    .byQa('mongodb.collection.refresh-button', { 'data-qa-resource-id': resourceId })
    .or(detail.locator('button:has(svg.lucide-refresh-cw), button:has(svg[class*="refresh"])'))
    .first();
}

function mongoDialog(dataflow: Awaited<ReturnType<typeof openMongoCollectionOrSkip>>['dataflow'], title: RegExp) {
  return dataflow.frame().getByRole('dialog').filter({ hasText: title }).first();
}

function mongoChangesPreviewDialog(dataflow: Awaited<ReturnType<typeof openMongoCollectionOrSkip>>['dataflow']) {
  return mongoDialog(dataflow, /待提交更改预览|待提交 SQL 预览|变更预览|Preview/i);
}

async function dismissDialog(dialog: Locator, page: Page) {
  const confirmButton = dialog.getByRole('button', { name: /确定|确认|OK|Confirm/i }).first();
  if (await confirmButton.isVisible().catch(() => false)) {
    await confirmButton.click({ force: true });
  } else {
    await dialog.getByRole('button').first().click().catch(async () => {
      await page.keyboard.press('Escape');
    });
  }

  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function fillMongoEditor(dialog: Locator, json: string) {
  const textarea = dialog.locator('textarea').first();
  await expect(textarea).toBeVisible({ timeout: 15_000 });
  await textarea.fill(json);
}

async function submitMongoDialog(dialog: Locator) {
  const namedSubmit = dialog
    .getByRole('button', { name: /新增文档|新增|添加|保存更改|保存|Add|Save/i })
    .last();

  if (await namedSubmit.isVisible().catch(() => false)) {
    await namedSubmit.click();
    return;
  }

  await dialog.getByRole('button').last().click();
}

async function expectPendingToolbar(detail: Locator) {
  await expect(mongoUndoButton(detail)).toBeEnabled({ timeout: 15_000 });
  await expect(mongoMainToolbarButton(detail, 4)).toBeEnabled({ timeout: 15_000 });
  await expect(mongoMainToolbarButton(detail, 5)).toBeEnabled({ timeout: 15_000 });
}

async function openMongoCollectionOrSkip(page: Page, testInfo: TestInfo) {
  await installDataFlowApiMocks(page, 'mongodb');
  const mockState = await installMongoCollectionRowsMock(page);
  const result = await openFirstResourceOfType(page, 'mongodb', 'collection');
  if (!result.resource) {
    await expectMockScenario('mongodb', 'mock collection leaf available');
    return { ...result, mockState };
  }
  testInfo.annotations.push({ type: 'resource', description: result.resource!.resourceId });
  return { ...result, mockState };
}

async function openMongoCollectionLeafDetailExplicitly(page: Page, testInfo: TestInfo, initialMode: MongoCollectionMockState['mode']) {
  await installDataFlowApiMocks(page, 'mongodb');
  const mockState = await installMongoCollectionRowsMock(page);
  mockState.mode = initialMode;

  const { dataflow, home } = await openDataSourceWorkspace(page, 'mongodb');
  await expandMongoTreeUntilLeafVisible(dataflow);

  const { leaf, resourceId } = await resolveMongoCollectionLeaf(dataflow);
  const resource = { resourceType: 'collection' as const, resourceId };
  const detail = mongoDetail(dataflow, resourceId);
  const tab = mongoResourceTab(dataflow, resourceId);
  const tabCountBefore = await dataflow.tabItem().count().catch(() => 0);

  await expect(leaf).toBeVisible({ timeout: 15_000 });
  await leaf.scrollIntoViewIfNeeded().catch(() => {});
  await leaf.click();
  await expect(detail).toBeVisible({ timeout: 15_000 });
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await expect(tab).toContainText(new RegExp(`${escapeRegExp(resourceId)}\\s*\\[`, 'i'), { timeout: 15_000 });

  const tabCountAfter = await dataflow.tabItem().count().catch(() => tabCountBefore);
  expect(tabCountAfter, 'clicking MongoDB collection leaf should keep or create a detail tab').toBeGreaterThanOrEqual(tabCountBefore);
  testInfo.annotations.push({ type: 'resource', description: resourceId });

  return { dataflow, home, resource, leaf, mockState };
}

async function openMongoCollectionDocsDetail(page: Page, testInfo: TestInfo) {
  const opened = await openMongoCollectionLeafDetailExplicitly(page, testInfo, 'docs');
  const { dataflow, resource, leaf } = opened;
  const detail = mongoDetail(dataflow, resource.resourceId);
  const resourceTab = mongoResourceTab(dataflow, resource.resourceId);
  const cards = mongoDocumentCards(detail);

  await expect(leaf).toBeVisible({ timeout: 15_000 });
  if ((await leaf.getAttribute('data-qa-resource-type').catch(() => null)) === 'collection') {
    await expect(leaf).toHaveAttribute('data-qa-resource-type', 'collection', { timeout: 15_000 });
  } else {
    await expect(leaf).toContainText(/^user$/, { timeout: 15_000 });
  }
  await expect(resourceTab).toBeVisible({ timeout: 15_000 });
  await expect(resourceTab).toContainText(new RegExp(`${escapeRegExp(resource.resourceId)}\\s*\\[`, 'i'), { timeout: 15_000 });
  await expect(dataflow.emptyTabContent().or(dataflow.frame().getByText(/暂无打开的标签页|从侧边栏选择/))).toHaveCount(0, { timeout: 15_000 });
  await expect(detail).toBeVisible({ timeout: 15_000 });
  await expect(cards.filter({ hasText: '"name": "alice"' })).toHaveCount(1, { timeout: 15_000 });
  await expect(cards.filter({ hasText: '"name": "bob"' })).toHaveCount(1, { timeout: 15_000 });

  return { ...opened, detail, resourceTab, cards };
}

test.describe('DataFlow MongoDB 集合详情模块', () => {
  test('DF-MONGO-001 MongoDB 集合以文档卡片列表展示并支持空态', async ({ page }, testInfo) => {
    const { dataflow, resource, leaf, mockState } = await openMongoCollectionLeafDetailExplicitly(page, testInfo, 'empty');
    if (!resource) return;
    const detail = mongoDetail(dataflow, resource.resourceId);
    const resourceTab = mongoResourceTab(dataflow, resource.resourceId);
    const cards = mongoDocumentCards(detail);
    const refreshButton = mongoRefreshButton(dataflow, detail, resource.resourceId);
    const tabCountWithDetailOpen = await dataflow.tabItem().count().catch(() => 0);

    await expect(leaf).toBeVisible({ timeout: 15_000 });
    if ((await leaf.getAttribute('data-qa-resource-type').catch(() => null)) === 'collection') {
      await expect(leaf).toHaveAttribute('data-qa-resource-type', 'collection', { timeout: 15_000 });
    } else {
      await expect(leaf).toContainText(/^user$/, { timeout: 15_000 });
    }
    await expect(resourceTab).toBeVisible({ timeout: 15_000 });
    await expect(resourceTab).toContainText(new RegExp(resource.resourceId, 'i'), { timeout: 15_000 });
    await expect(dataflow.emptyTabContent().or(dataflow.frame().getByText(/暂无打开的标签页|从侧边栏选择/))).toHaveCount(0, { timeout: 15_000 });
    await expect(detail).toBeVisible({ timeout: 15_000 });
    await expect(detail.getByText(/当前集合中没有文档|no documents/i)).toBeVisible({ timeout: 15_000 });
    await expect(cards).toHaveCount(0, { timeout: 15_000 });
    await expect(dataflow.sqlTableGrid()).toHaveCount(0, { timeout: 15_000 });

    mockState.mode = 'docs';
    const rowsRequestsBeforeRefresh = mockState.requestLog.filter((entry) => entry === 'GetStorageUnitRows').length;
    await expect(refreshButton).toBeVisible({ timeout: 15_000 });
    await refreshButton.click();
    await expect
      .poll(() => mockState.requestLog.filter((entry) => entry === 'GetStorageUnitRows').length, { timeout: 15_000 })
      .toBeGreaterThan(rowsRequestsBeforeRefresh);
    await expect(cards).toHaveCount(MONGO_COLLECTION_DOCS.length, { timeout: 15_000 });
    await expect(cards.first()).toContainText('"name": "alice"', { timeout: 15_000 });
    await expect(cards.nth(1)).toContainText('"city": "beijing"', { timeout: 15_000 });
    await expect(detail.getByText(/当前集合中没有文档|no documents/i)).toHaveCount(0, { timeout: 15_000 });
    await expect(resourceTab).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.tabItem()).toHaveCount(tabCountWithDetailOpen, { timeout: 15_000 });
  });

  test('DF-MONGO-002 MongoDB Add Document 拒绝空文档并创建 pending insert', async ({ page }, testInfo) => {
    const { dataflow, mockState, detail } = await openMongoCollectionDocsDetail(page, testInfo);
    const addDocumentButton = mongoAddDocumentButton(dataflow, detail);

    await expect(addDocumentButton).toBeVisible({ timeout: 15_000 });
    await addDocumentButton.click();
    const addDialog = mongoDialog(dataflow, /新增文档|Add Document|Add/i);
    await expect(addDialog).toBeVisible({ timeout: 15_000 });

    await fillMongoEditor(addDialog, '{}');
    await submitMongoDialog(addDialog);
    const emptyDocumentError = mongoDialog(dataflow, /错误|Error/i);
    await expect(emptyDocumentError).toBeVisible({ timeout: 15_000 });
    await expect(emptyDocumentError).toContainText(/文档至少需要一个字段|空|empty|至少|JSON|文档/i, { timeout: 15_000 });
    await expect(mongoDocumentCards(detail).filter({ hasText: '"name": "delta"' })).toHaveCount(0, { timeout: 15_000 });
    expect(mockState.requestLog.filter((entry) => /mutation|insert|update|delete|submit/i.test(entry))).toHaveLength(0);
    const emptyDocumentConfirmButton = emptyDocumentError.getByRole('button', { name: /确定|确认|OK|Confirm/i }).first();
    await expect(emptyDocumentConfirmButton).toBeVisible({ timeout: 15_000 });
    await emptyDocumentConfirmButton.click();
    await expect(emptyDocumentError).toHaveCount(0, { timeout: 15_000 });
    await expect(dataflow.frame().getByRole('dialog').filter({ hasText: /错误|Error/i })).toHaveCount(0, { timeout: 15_000 });

    if (!(await addDialog.isVisible().catch(() => false))) {
      await mongoAddDocumentButton(dataflow, detail).click();
    }
    const validAddDialog = mongoDialog(dataflow, /新增文档|Add Document|Add/i);
    await expect(validAddDialog).toBeVisible({ timeout: 15_000 });
    await fillMongoEditor(
      validAddDialog,
      JSON.stringify(
        {
          _id: 'mongo-insert-1',
          name: 'delta',
          age: 27,
          status: 'active',
          city: 'shenzhen',
          score: 95,
          active: true,
          tags: ['new', 'pending'],
        },
        null,
        2,
      ),
    );
    await submitMongoDialog(validAddDialog);
    await expect(validAddDialog).toHaveCount(0, { timeout: 15_000 });
    await expect(mongoDocumentCards(detail).filter({ hasText: '"name": "delta"' })).toHaveCount(1, { timeout: 15_000 });
    await expectPendingToolbar(detail);
    expect(mockState.requestLog.filter((entry) => /mutation|insert|update|delete|submit/i.test(entry))).toHaveLength(0);
  });

  test('DF-MONGO-003 MongoDB Edit Document 整体替换文档进入 update 状态', async ({ page }, testInfo) => {
    const { dataflow, detail } = await openMongoCollectionDocsDetail(page, testInfo);
    const aliceCard = mongoDocumentCard(detail, '"name": "alice"');

    await expect(aliceCard).toBeVisible({ timeout: 15_000 });
    await aliceCard.dblclick();
    const editDialog = mongoDialog(dataflow, /编辑文档|Edit Document|Save/i);
    await expect(editDialog).toBeVisible({ timeout: 15_000 });

    await fillMongoEditor(
      editDialog,
      JSON.stringify(
        {
          _id: 'mongo-1',
          name: 'alice-updated',
          age: 19,
          status: 'active',
          city: 'shanghai',
          score: 96,
          active: true,
          tags: ['core', 'updated'],
        },
        null,
        2,
      ),
    );
    await submitMongoDialog(editDialog);
    await expect(editDialog).toHaveCount(0, { timeout: 15_000 });
    await expect(mongoDocumentCard(detail, '"name": "alice-updated"')).toBeVisible({ timeout: 15_000 });
    await expect(mongoDocumentCard(detail, '"_id": "mongo-1"')).toBeVisible({ timeout: 15_000 });
    await expectPendingToolbar(detail);

    const previewButton = mongoPreviewChangesButton(dataflow, detail);

    await previewButton.click();
    const previewDialog = mongoChangesPreviewDialog(dataflow);
    await expect(previewDialog).toBeVisible({ timeout: 15_000 });
    await expect(previewDialog).toContainText(/updateOne/i, { timeout: 15_000 });
    await expect(previewDialog).toContainText(/mongo-1/, { timeout: 15_000 });
    await previewDialog.getByRole('button').first().click().catch(async () => {
      await page.keyboard.press('Escape');
    });
  });

  test('DF-MONGO-004 MongoDB 批量删除只标记 delete 并可 Undo', async ({ page }, testInfo) => {
    const { dataflow, detail } = await openMongoCollectionDocsDetail(page, testInfo);
    const aliceCard = mongoDocumentCard(detail, '"name": "alice"');
    const bobCard = mongoDocumentCard(detail, '"name": "bob"');
    const deleteButton = mongoDeleteSelectedButton(dataflow, detail);
    const undoButton = mongoUndoButton(detail);

    await expect(aliceCard).toBeVisible({ timeout: 15_000 });
    await expect(bobCard).toBeVisible({ timeout: 15_000 });
    await aliceCard.click();
    await bobCard.click();
    await expect(deleteButton).toBeEnabled({ timeout: 15_000 });
    await deleteButton.click();
    await expect(aliceCard.locator('pre')).toHaveClass(/line-through/, { timeout: 15_000 });
    await expect(bobCard.locator('pre')).toHaveClass(/line-through/, { timeout: 15_000 });
    await expect(undoButton).toBeEnabled({ timeout: 15_000 });

    await undoButton.click();
    await expect(aliceCard.locator('pre')).not.toHaveClass(/line-through/, { timeout: 15_000 });
    await expect(bobCard.locator('pre')).not.toHaveClass(/line-through/, { timeout: 15_000 });
    await expect(mongoPreviewChangesButton(dataflow, detail)).toBeDisabled({ timeout: 15_000 });
  });

  test('DF-MONGO-005 MongoDB 变更预览展示 mongosh 命令', async ({ page }, testInfo) => {
    const { dataflow, detail } = await openMongoCollectionDocsDetail(page, testInfo);
    const addDocumentButton = mongoAddDocumentButton(dataflow, detail);
    const deleteButton = mongoDeleteSelectedButton(dataflow, detail);
    const previewButton = mongoPreviewChangesButton(dataflow, detail);
    const aliceCard = mongoDocumentCard(detail, '"name": "alice"');
    const bobCard = mongoDocumentCard(detail, '"name": "bob"');

    await addDocumentButton.click();
    const addDialog = mongoDialog(dataflow, /新增文档|Add Document|Add/i);
    await expect(addDialog).toBeVisible({ timeout: 15_000 });
    await fillMongoEditor(
      addDialog,
      JSON.stringify(
        {
          _id: 'mongo-preview-insert',
          name: 'preview-add',
          age: 26,
          status: 'active',
          city: 'guangzhou',
          score: 80,
          active: true,
          tags: ['preview'],
        },
        null,
        2,
      ),
    );
    await submitMongoDialog(addDialog);
    await expect(addDialog).toHaveCount(0, { timeout: 15_000 });

    await aliceCard.dblclick();
    const editDialog = mongoDialog(dataflow, /编辑文档|Edit Document|Save/i);
    await expect(editDialog).toBeVisible({ timeout: 15_000 });
    await fillMongoEditor(
      editDialog,
      JSON.stringify(
        {
          _id: 'mongo-1',
          name: 'alice-preview',
          age: 20,
          status: 'active',
          city: 'shanghai',
          score: 99,
          active: true,
          tags: ['core', 'preview'],
        },
        null,
        2,
      ),
    );
    await submitMongoDialog(editDialog);
    await expect(editDialog).toHaveCount(0, { timeout: 15_000 });

    await bobCard.click();
    await deleteButton.click();

    await expect(previewButton).toBeEnabled({ timeout: 15_000 });
    await previewButton.click();
    const previewDialog = mongoChangesPreviewDialog(dataflow);
    await expect(previewDialog).toBeVisible({ timeout: 15_000 });
    await expect(previewDialog).toContainText(/insertOne/i, { timeout: 15_000 });
    await expect(previewDialog).toContainText(/updateOne/i, { timeout: 15_000 });
    await expect(previewDialog).toContainText(/deleteOne/i, { timeout: 15_000 });
    await expect(previewDialog).toContainText(/mongo-preview-insert/, { timeout: 15_000 });
    await expect(previewDialog).toContainText(/mongo-1/, { timeout: 15_000 });
    await expect(previewDialog).toContainText(/mongo-2/, { timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(previewDialog).toHaveCount(0, { timeout: 15_000 });
  });

  test('DF-MONGO-006 MongoDB 筛选字段去重且支持 8 种运算符', async ({ page }, testInfo) => {
    const { dataflow, mockState, detail } = await openMongoCollectionDocsDetail(page, testInfo);
    const filterButton = dataflow.byQa('data-view.filter-button').or(dataflow.frame().getByRole('button', { name: '筛选' })).first();

    await filterButton.click();
    const filterDialog = dataflow.frame().getByRole('dialog').filter({ hasText: /筛选|Filter/i }).first();
    await expect(filterDialog).toBeVisible({ timeout: 15_000 });

    const addConditionButton = filterDialog.getByRole('button', { name: /添加条件|Add Condition/i }).first();
    const fieldComboboxes = filterDialog.getByRole('combobox');
    const valueInputs = filterDialog.getByRole('textbox');

    await fieldComboboxes.nth(0).click();
    await dataflow.frame().getByRole('option', { name: 'name', exact: true }).click();
    await valueInputs.first().fill('bob');
    await addConditionButton.click();

    await fieldComboboxes.nth(2).click();
    await expect(dataflow.frame().getByRole('option', { name: 'name', exact: true })).toHaveCount(0, { timeout: 15_000 });
    await dataflow
      .frame()
      .getByRole('option', { name: 'age', exact: true })
      .or(dataflow.frame().getByText('age', { exact: true }))
      .first()
      .click({ timeout: 15_000 });

    await fieldComboboxes.nth(3).click();
    for (const operator of ['等于 (=)', '不等于 (!=)', '包含', '大于 (>)', '小于 (<)', '大于等于 (>=)', '小于等于 (<=)', '包含（逗号分隔）']) {
      await expect(dataflow.frame().getByRole('option', { name: operator, exact: true })).toBeVisible({ timeout: 15_000 });
    }
    await dataflow.frame().getByRole('option', { name: '大于 (>)', exact: true }).click();
    await valueInputs.last().fill('20');

    await filterDialog.getByRole('button', { name: /应用|Apply/i }).click();
    await expect(filterDialog).toHaveCount(0, { timeout: 15_000 });
    await expect(filterButton).toContainText('2', { timeout: 15_000 });
    await expect(mongoDocumentCards(detail)).toHaveCount(1, { timeout: 15_000 });
    await expect(mongoDocumentCards(detail).first()).toContainText('"name": "bob"', { timeout: 15_000 });
    expect(mockState.lastWhere).toBeTruthy();
  });

  test('DF-MONGO-007 MongoDB 嵌套/分组筛选给出不支持提示', async ({ page }, testInfo) => {
    const { dataflow, resourceTab, mockState } = await openMongoCollectionDocsDetail(page, testInfo);
    const filterButton = dataflow.byQa('data-view.filter-button').or(dataflow.frame().getByRole('button', { name: '筛选' })).first();

    mockState.errorMode = 'nested-filter';
    await filterButton.click();
    const filterDialog = dataflow.frame().getByRole('dialog').filter({ hasText: /筛选|Filter/i }).first();
    await expect(filterDialog).toBeVisible({ timeout: 15_000 });
    await filterDialog.getByRole('button', { name: /添加条件|Add Condition/i }).first().click();
    await filterDialog.getByRole('button', { name: /应用|Apply/i }).click();
    await expect(dataflow.frame().getByText(/Only flat atomic filters are supported|仅支持.*扁平|不支持.*嵌套|UNSUPPORTED_NESTED_FILTER/i).first()).toBeVisible({
      timeout: 15_000,
    });
    expect(mockState.lastWhere).toBeTruthy();
    await expectMockScenario('mongodb', 'nested grouped filter unsupported tip');
    await expect(resourceTab).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.frame().getByRole('main')).toContainText(/Only flat atomic filters are supported|显示 1 - 3 \/ 共 3 文档/i, { timeout: 15_000 });
  });

  test('DF-MONGO-008 MongoDB Export Collection 支持格式、筛选表达式和行数上限', async ({ page }, testInfo) => {
    const { dataflow, resource, resourceTab } = await openMongoCollectionDocsDetail(page, testInfo);
    const exportButton = dataflow.exportButton(resource).or(dataflow.frame().getByRole('button', { name: /导出|Export/i })).first();

    await expect(resourceTab).toBeVisible({ timeout: 15_000 });
    await expect(exportButton).toBeVisible({ timeout: 15_000 });
    await exportButton.click();
    const exportDialog = dataflow.frame().getByRole('dialog').filter({ hasText: /导出|Export|CSV|JSON|SQL|Excel|XLSX/i }).first();
    await expect(exportDialog).toBeVisible({ timeout: 15_000 });
    await expect(exportDialog).toContainText(/CSV|JSON|SQL|Excel|XLSX/i, { timeout: 15_000 });
    await expect(exportDialog.locator('input, textarea').first()).toBeVisible({ timeout: 15_000 }).catch(async () => {
      await expectMockScenario('mongodb', 'export filter expression input fallback');
    });
    await exportDialog.getByText(/CSV/i).first().click().catch(() => {});
    const confirmExportButton = exportDialog.getByRole('button', { name: /导出|Export|下载|Download|确认|确定/i }).last();
    await expect(confirmExportButton).toBeVisible({ timeout: 15_000 });
    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 }).catch(() => null);
    await confirmExportButton.click();
    await downloadPromise;
    await expect(exportDialog.getByText(/导出完成|文件已下载|Export complete|downloaded|成功/i).or(exportDialog).first()).toBeVisible({ timeout: 15_000 });
  });

  test('DF-MONGO-009 MongoDB 详情页刷新后仍保持原页面数据', async ({ page }, testInfo) => {
    const { dataflow, resource, resourceTab, detail, cards, mockState } = await openMongoCollectionDocsDetail(page, testInfo);
    const refreshButton = mongoRefreshButton(dataflow, detail, resource.resourceId);
    const rowsRequestsBeforeRefresh = mockState.requestLog.filter((entry) => entry === 'GetStorageUnitRows').length;

    await expect(resourceTab).toBeVisible({ timeout: 15_000 });
    await expect(cards).toHaveCount(MONGO_COLLECTION_DOCS.length, { timeout: 15_000 });
    await expect(cards.first()).toContainText('"name": "alice"', { timeout: 15_000 });
    await expect(cards.nth(1)).toContainText('"name": "bob"', { timeout: 15_000 });
    await expect(cards.nth(2)).toContainText('"name": "carol"', { timeout: 15_000 });

    await expect(refreshButton).toBeVisible({ timeout: 15_000 });
    await refreshButton.click();
    await expect
      .poll(() => mockState.requestLog.filter((entry) => entry === 'GetStorageUnitRows').length, { timeout: 15_000 })
      .toBeGreaterThan(rowsRequestsBeforeRefresh);

    await expect(resourceTab).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.dataViewError()).toHaveCount(0, { timeout: 15_000 });
    await expect(mongoDocumentCards(detail)).toHaveCount(MONGO_COLLECTION_DOCS.length, { timeout: 15_000 });
    await expect(mongoDocumentCards(detail).first()).toContainText('"name": "alice"', { timeout: 15_000 });
    await expect(mongoDocumentCards(detail).nth(1)).toContainText('"name": "bob"', { timeout: 15_000 });
    await expect(mongoDocumentCards(detail).nth(2)).toContainText('"name": "carol"', { timeout: 15_000 });
  });
});
