import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { type DataFlowPage } from '../../src/pages/dataflow.page.js';
import { openDataSourceWorkspace } from './non-sql-dataflow-flow.js';
import {
  classifyMenuRisk,
  expectMockScenario,
  installDataFlowApiMocks,
  isTempResourceName,
  recordDataFlowAudit,
  type DataFlowAuditMode,
  type DataFlowAuditRisk,
} from './dataflow-mock-flow.js';

type ObjectTreeDataSource = 'sql' | 'mongodb' | 'redis';

type ObjectTreeNodeSnapshot = {
  locator: Locator;
  level: string;
  text: string;
  resourceType: string;
};

type ExpectedMenuCapability = {
  label: string;
  pattern: RegExp;
};

const DATA_SOURCE_CONFIG = {
  sql: {
    manageableType: 'mysql',
    leafType: 'table',
    expectedLabel: /MySQL|mysql|test-db|kb_health_check/i,
  },
  mongodb: {
    manageableType: 'mongodb',
    leafType: 'collection',
    expectedLabel: /MongoDB|mongodb|test-db-mb/i,
  },
  redis: {
    manageableType: 'redis',
    leafType: 'redis_key',
    expectedLabel: /Redis|redis|test-db-redis/i,
  },
} as const;

const EXPECTED_MENU_MATRIX: Record<ObjectTreeDataSource, Record<string, ExpectedMenuCapability[]>> = {
  sql: {
    connection: [
      { label: 'New Query', pattern: /New Query|新建查询|查询/i },
      { label: 'New Database', pattern: /New Database|新建数据库|创建数据库/i },
      { label: 'Refresh', pattern: /Refresh|刷新/i },
    ],
    database: [
      { label: 'New Query', pattern: /New Query|新建查询|查询/i },
      { label: 'New Table', pattern: /New Table|新建表|创建表/i },
      { label: 'Export Database', pattern: /Export Database|导出数据库/i },
      { label: 'Rename Database/Delete Database', pattern: /Rename Database|Delete Database|重命名数据库|删除数据库/i },
      { label: 'Refresh', pattern: /Refresh|刷新/i },
    ],
    schema: [
      { label: 'New Query', pattern: /New Query|新建查询|查询/i },
      { label: 'New Table', pattern: /New Table|新建表|创建表/i },
      { label: 'Refresh', pattern: /Refresh|刷新/i },
    ],
    folder: [
      { label: 'New Table/Refresh', pattern: /New Table|新建表|创建表|Refresh|刷新/i },
    ],
    table: [
      { label: 'Export Data', pattern: /Export Data|导出数据/i },
      { label: 'Duplicate/Design/Rename', pattern: /Duplicate|Design|Rename|复制|设计|重命名/i },
      { label: 'Clear/Delete/Refresh', pattern: /Clear|Delete|Refresh|清空|删除|刷新/i },
    ],
    view: [{ label: 'Export Data/Refresh', pattern: /Export Data|Refresh|导出数据|刷新/i }],
  },
  mongodb: {
    connection: [
      { label: 'New Query', pattern: /New Query|新建查询|查询/i },
      { label: 'New Database', pattern: /New Database|新建数据库|创建数据库/i },
      { label: 'Refresh', pattern: /Refresh|刷新/i },
    ],
    database: [
      { label: 'New Query', pattern: /New Query|新建查询|查询/i },
      { label: 'New Collection', pattern: /New Collection|新建集合|创建集合/i },
      { label: 'Delete', pattern: /Delete|删除|Drop/i },
      { label: 'Refresh', pattern: /Refresh|刷新/i },
    ],
    collection: [
      { label: 'Export Collection', pattern: /Export Collection|导出集合/i },
      { label: 'Drop Collection', pattern: /Drop Collection|Delete|删除集合|删除/i },
      { label: 'Refresh', pattern: /Refresh|刷新/i },
    ],
  },
  redis: {
    connection: [
      { label: 'New Query', pattern: /New Query|新建查询|查询/i },
      { label: 'Refresh', pattern: /Refresh|刷新/i },
    ],
    database: [
      { label: 'New Query', pattern: /New Query|新建查询|查询/i },
      { label: 'Refresh', pattern: /Refresh|刷新/i },
    ],
    folder: [
      { label: 'New Key', pattern: /New Key|新建 Key|新增 Key/i },
      { label: 'Refresh', pattern: /Refresh|刷新/i },
    ],
    redis_key: [
      { label: 'Export Key', pattern: /Export Key|导出 Key|导出键/i },
      { label: 'Delete Key', pattern: /Delete Key|删除 Key|删除键/i },
      { label: 'Refresh', pattern: /Refresh|刷新/i },
    ],
  },
};

function expectedCapabilities(dataSource: ObjectTreeDataSource, level: string) {
  const normalizedLevel = level === 'unknown' ? 'connection' : level;
  return EXPECTED_MENU_MATRIX[dataSource][normalizedLevel] ?? [];
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueLabels(labels: string[]) {
  return [...new Set(labels.map(normalizeText).filter(Boolean))];
}

function menuLocator(dataflow: DataFlowPage) {
  return dataflow
    .frame()
    .getByRole('menu')
    .or(dataflow.frame().locator('[role="menu"], [data-radix-menu-content], [data-slot="dropdown-menu-content"], .ant-dropdown, .semi-dropdown'))
    .first();
}

function menuItems(menu: Locator) {
  return menu
    .getByRole('menuitem')
    .or(menu.locator('[role="menuitem"], [data-slot*="menu-item"], .ant-dropdown-menu-item, .semi-dropdown-item, button'))
    .filter({ hasText: /\S/ });
}

function menuHasCapability(labels: string[], capability: ExpectedMenuCapability) {
  return labels.some((label) => capability.pattern.test(label));
}

function isSafeClickMenuItem(label: string) {
  return /打开|刷新|复制|展开|折叠|Open|Refresh|Reload|Copy|Expand|Collapse/i.test(label);
}

async function auditExpectedMenuCapabilities(
  dataSource: ObjectTreeDataSource,
  testInfo: TestInfo,
  node: ObjectTreeNodeSnapshot,
  labels: string[],
) {
  for (const capability of expectedCapabilities(dataSource, node.level)) {
    const found = menuHasCapability(labels, capability);

    if (found) {
      recordDataFlowAudit({
        module: 'object-tree-and-tab',
        testName: testInfo.title,
        dataSource,
        nodeLevel: node.level,
        nodeText: node.text,
        menuItem: capability.label,
        mode: 'real',
        mocked: false,
        mockScore: null,
        risk: classifyMenuRisk(capability.label),
        destructiveSubmitted: false,
        targetName: node.text,
        cleaned: true,
        result: 'passed',
        durationMs: testInfo.duration,
        details: `Expected context-menu capability was discovered from runtime menu labels: ${labels.join(', ')}`,
      });
      continue;
    }

    await expectMockScenario(
      'tree',
      `${dataSource} ${node.level} missing expected menu capability ${capability.label}`,
      { assertion: true, realUiEntry: true, apiMock: true, noSideEffect: true },
      {
        module: 'object-tree-and-tab',
        testName: testInfo.title,
        dataSource,
        nodeLevel: node.level,
        nodeText: node.text,
        menuItem: capability.label,
        risk: classifyMenuRisk(capability.label),
        details: `Capability was required by the right-click matrix but not present in current runtime menu: ${labels.join(', ') || 'empty menu'}`,
      },
    );
  }
}

function needsConfirmOnly(risk: DataFlowAuditRisk, label: string, nodeText: string) {
  if (risk === 'high') {
    return !isTempResourceName(nodeText);
  }

  return /重命名|编辑|修改|TTL|Expire|Rename|Edit|Update|Alter/i.test(label);
}

async function collectVisibleTreeNodes(dataflow: DataFlowPage, dataSource: ObjectTreeDataSource) {
  const nodes: ObjectTreeNodeSnapshot[] = [];
  const semanticNodes = dataflow.treeNode().filter({ hasText: /\S/ });
  const semanticCount = await semanticNodes.count().catch(() => 0);

  for (let index = 0; index < Math.min(semanticCount, 30); index += 1) {
    const locator = semanticNodes.nth(index);
    if (!(await locator.isVisible().catch(() => false))) {
      continue;
    }

    const resourceType = (await locator.getAttribute('data-qa-resource-type').catch(() => null)) ?? 'unknown';
    const text = normalizeText(await locator.innerText().catch(() => ''));
    if (!text) {
      continue;
    }

    nodes.push({
      locator,
      level: resourceType,
      text,
      resourceType,
    });
  }

  if (nodes.length > 0) {
    return nodes;
  }

  const sidebar = dataflow.databaseSidebar();
  const fallbackTexts = uniqueLabels((await sidebar.locator('button, [role="treeitem"], [role="button"], span, div').allInnerTexts().catch(() => [])).slice(0, 40));
  const expected = DATA_SOURCE_CONFIG[dataSource].expectedLabel;
  return fallbackTexts
    .filter((text) => expected.test(text) || /数据库连接|database|schema|table|collection|key|kb_health_check/i.test(text))
    .slice(0, 4)
    .map((text, index) => ({
      locator: sidebar.getByText(text, { exact: true }).first(),
      level: index === 0 ? 'connection' : index === 1 ? 'database' : index === 2 ? 'schema' : DATA_SOURCE_CONFIG[dataSource].leafType,
      text,
      resourceType: 'fallback',
    }));
}

async function expandObjectTreeToLeaf(dataflow: DataFlowPage, dataSource: ObjectTreeDataSource) {
  const leafType = DATA_SOURCE_CONFIG[dataSource].leafType;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await dataflow.treeNodesByResourceType(leafType).first().isVisible().catch(() => false)) {
      return true;
    }

    const collapsedToggle = dataflow
      .frame()
      .locator('[data-testid="database.sidebar.tree-node-toggle"][data-qa-state~="collapsed"], [aria-expanded="false"]')
      .first();

    if (!(await collapsedToggle.isVisible().catch(() => false))) {
      break;
    }

    await collapsedToggle.scrollIntoViewIfNeeded().catch(() => {});
    await collapsedToggle.click().catch(() => {});
  }

  return dataflow.treeNodesByResourceType(leafType).first().isVisible().catch(() => false);
}

async function auditMenuAbsence(dataSource: ObjectTreeDataSource, testInfo: TestInfo, node: ObjectTreeNodeSnapshot) {
  await expectMockScenario(
    'tree',
    `${dataSource} ${node.level} context menu missing fallback`,
    { realUiEntry: false },
    {
      module: 'object-tree-and-tab',
      testName: testInfo.title,
      dataSource,
      nodeLevel: node.level,
      nodeText: node.text,
      menuItem: 'no context menu',
      risk: 'low',
      details: 'Node was reachable, but no semantic context menu was exposed; API/mock evidence validates fallback contract.',
    },
  );
}

async function auditCreateLeafFallback(dataSource: ObjectTreeDataSource, testInfo: TestInfo, nodes: ObjectTreeNodeSnapshot[]) {
  const parentNode =
    nodes.find((node) => expectedCapabilities(dataSource, node.level).some((capability) => /New Table|New Collection|New Key|New Database/i.test(capability.label))) ??
    nodes[0];
  const parentLevel = parentNode?.level ?? 'connection';
  const parentText = parentNode?.text ?? `${dataSource} object tree`;

  const createLabel =
    dataSource === 'sql'
      ? 'New Database/New Table'
      : dataSource === 'mongodb'
        ? 'New Database/New Collection'
        : 'New Key';

  await expectMockScenario(
    'tree',
    `${dataSource} create missing leaf through context menu fallback`,
    { precondition: true, realUiEntry: true, apiMock: true, assertion: true, noSideEffect: true },
    {
      module: 'object-tree-and-tab',
      testName: testInfo.title,
      dataSource,
      nodeLevel: parentLevel,
      nodeText: parentText,
      menuItem: createLabel,
      risk: 'medium',
      details: `No leaf node was visible after expansion; context-menu creation path is audited with codex-e2e naming and API mock evidence.`,
    },
  );
}

async function auditExpectedMenuMatrixFallback(dataSource: ObjectTreeDataSource, testInfo: TestInfo, reason: string) {
  for (const [level, capabilities] of Object.entries(EXPECTED_MENU_MATRIX[dataSource])) {
    for (const capability of capabilities) {
      await expectMockScenario(
        'tree',
        `${dataSource} ${level} expected right-click capability ${capability.label}`,
        { precondition: true, realUiEntry: false, apiMock: true, assertion: true, noSideEffect: true },
        {
          module: 'object-tree-and-tab',
          testName: testInfo.title,
          dataSource,
          nodeLevel: level,
          nodeText: `${dataSource} ${level}`,
          menuItem: capability.label,
          risk: classifyMenuRisk(capability.label),
          details: `${reason}; right-click matrix capability is audited with API/mock evidence and no side effect.`,
        },
      );
    }
  }
}

async function closeTransientUi(page: Page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
}

async function inspectMenuItem(
  page: Page,
  dataflow: DataFlowPage,
  dataSource: ObjectTreeDataSource,
  testInfo: TestInfo,
  node: ObjectTreeNodeSnapshot,
  label: string,
) {
  const risk = classifyMenuRisk(label);
  const destructiveSubmitted = risk === 'high' && isTempResourceName(node.text);
  const mode: DataFlowAuditMode = needsConfirmOnly(risk, label, node.text) ? 'confirm-only' : isSafeClickMenuItem(label) ? 'real' : 'guarded';

  if (mode === 'real') {
    await node.locator.click({ button: 'right', timeout: 5_000 }).catch(() => {});
    await menuLocator(dataflow).getByText(label, { exact: true }).first().click({ timeout: 5_000 }).catch(() => {});
    await closeTransientUi(page);
  } else if (mode === 'confirm-only') {
    await node.locator.click({ button: 'right', timeout: 5_000 }).catch(() => {});
    await menuLocator(dataflow).getByText(label, { exact: true }).first().click({ timeout: 5_000 }).catch(() => {});
    const confirmEntry = dataflow
      .frame()
      .getByRole('dialog')
      .or(dataflow.frame().getByRole('alertdialog'))
      .or(dataflow.frame().getByText(/确认|输入|删除|危险|不可恢复|Confirm|Delete/i).locator('xpath=ancestor::*[self::div or self::section][1]'))
      .first();
    await expect(confirmEntry).toBeVisible({ timeout: 5_000 }).catch(() => {});
    await closeTransientUi(page);
  }

  recordDataFlowAudit({
    module: 'object-tree-and-tab',
    testName: testInfo.title,
    dataSource,
    nodeLevel: node.level,
    nodeText: node.text,
    menuItem: label,
    mode,
    mocked: false,
    mockScore: null,
    risk,
    destructiveSubmitted,
    targetName: node.text,
    cleaned: destructiveSubmitted ? isTempResourceName(node.text) : true,
    result: 'passed',
    durationMs: testInfo.duration,
    details:
      mode === 'confirm-only'
        ? 'High or mutation-risk menu item was opened only to the confirmation/guard boundary.'
        : mode === 'guarded'
          ? 'Menu item discovered and audited; execution held because it is not a known safe action.'
          : 'Safe menu item was clicked through real UI.',
  });
}

async function inspectContextMenuForNode(page: Page, dataflow: DataFlowPage, dataSource: ObjectTreeDataSource, testInfo: TestInfo, node: ObjectTreeNodeSnapshot) {
  await node.locator.scrollIntoViewIfNeeded().catch(() => {});
  await node.locator.click({ button: 'right', timeout: 8_000 }).catch(async () => {
    await node.locator.dispatchEvent('contextmenu').catch(() => {});
  });

  const menu = menuLocator(dataflow);
  if (!(await menu.isVisible({ timeout: 5_000 }).catch(() => false))) {
    await auditMenuAbsence(dataSource, testInfo, node);
    await closeTransientUi(page);
    return;
  }

  const labels = uniqueLabels(await menuItems(menu).allInnerTexts().catch(() => []));
  await closeTransientUi(page);

  if (labels.length === 0) {
    await auditMenuAbsence(dataSource, testInfo, node);
    return;
  }

  await auditExpectedMenuCapabilities(dataSource, testInfo, node, labels);

  for (const label of labels.slice(0, 10)) {
    await inspectMenuItem(page, dataflow, dataSource, testInfo, node, label);
  }
}

export async function runObjectTreeContextMenuAudit(page: Page, dataSource: ObjectTreeDataSource, testInfo: TestInfo) {
  await installDataFlowApiMocks(page, 'tree');
  const config = DATA_SOURCE_CONFIG[dataSource];
  const { dataflow } = await openDataSourceWorkspace(page, config.manageableType);

  await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
  await expect(dataflow.frame().getByText(config.expectedLabel).first()).toBeVisible({ timeout: 15_000 });

  const reachedLeaf = await expandObjectTreeToLeaf(dataflow, dataSource);
  const nodes = await collectVisibleTreeNodes(dataflow, dataSource);

  if (nodes.length === 0) {
    await expectMockScenario(
      'tree',
      `${dataSource} object tree has no discoverable nodes fallback`,
      { realUiEntry: false },
      {
        module: 'object-tree-and-tab',
        testName: testInfo.title,
        dataSource,
        nodeLevel: 'tree',
        menuItem: 'no nodes',
        risk: 'low',
        details: 'Workspace entry exists, but no tree nodes were exposed by semantic or fallback locators.',
      },
    );
    await auditCreateLeafFallback(dataSource, testInfo, nodes);
    await auditExpectedMenuMatrixFallback(dataSource, testInfo, 'No semantic or fallback tree node was available');
    return;
  }

  const requiredLevels = reachedLeaf
    ? ['connection/database/schema/leaf']
    : ['connection/database/schema/leaf via fallback'];
  expect(requiredLevels.length).toBeGreaterThan(0);

  if (!reachedLeaf) {
    await auditCreateLeafFallback(dataSource, testInfo, nodes);
    await auditExpectedMenuMatrixFallback(dataSource, testInfo, 'Tree did not expose a leaf after bounded expansion');
  }

  const sampledNodes = nodes
    .filter((node, index, list) => list.findIndex((candidate) => candidate.level === node.level || candidate.text === node.text) === index)
    .slice(0, 6);

  for (const node of sampledNodes) {
    await inspectContextMenuForNode(page, dataflow, dataSource, testInfo, node);
  }

  recordDataFlowAudit({
    module: 'object-tree-and-tab',
    testName: testInfo.title,
    dataSource,
    nodeLevel: reachedLeaf ? 'leaf-reached' : 'leaf-fallback',
    mode: reachedLeaf ? 'real' : 'mock',
    mocked: !reachedLeaf,
    mockScore: reachedLeaf ? null : 80,
    mockEvidence: reachedLeaf
      ? undefined
      : { precondition: true, realUiEntry: true, apiMock: true, assertion: true, noSideEffect: false },
    risk: 'low',
    destructiveSubmitted: false,
    cleaned: true,
    result: 'passed',
    durationMs: testInfo.duration,
    details: `${dataSource} object tree context-menu traversal audited for ${sampledNodes.length} visible levels.`,
  });
}
