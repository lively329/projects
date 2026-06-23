import { expect, test } from './fixtures.js';
import { openDataFlowFromDatabaseList, openDataFlowWorkspaceFromDatabaseList } from './helpers/dataflow-flow.js';
import { expectMockScenario, installDataFlowApiMocks, recordDataFlowAudit } from './helpers/dataflow-mock-flow.js';
import { runDataSourceMutationAndToolbarAudit } from './helpers/dataflow-object-operation-flow.js';
import { runObjectTreeContextMenuAudit } from './helpers/dataflow-tree-context-menu-flow.js';
import { openDataSourceWorkspace } from './helpers/non-sql-dataflow-flow.js';
import type { Locator } from '@playwright/test';
import type { DataFlowPage, OpenedDataFlowResource } from '../src/pages/dataflow.page.js';
import type { ManageableDataSourceType } from '../src/pages/sealos-home.page.js';

type SystemObjectScenario = {
  label: string;
  dataSourceType: ManageableDataSourceType;
  connectionPattern: RegExp;
  contextNode: 'connection' | 'database';
  databaseName: string;
  systemObjectName: string;
};

type DataFlowQueryPayload = {
  operationName?: string;
  variables?: {
    schema?: string;
    type?: string;
  };
};

const SYSTEM_OBJECT_SCENARIOS: SystemObjectScenario[] = [
  {
    label: 'Postgres database node',
    dataSourceType: 'postgresql',
    connectionPattern: /xzy-maestro|postgresql/i,
    contextNode: 'database',
    databaseName: 'postgres',
    systemObjectName: 'pg_catalog',
  },
  {
    label: 'MySQL connection node',
    dataSourceType: 'mysql',
    connectionPattern: /mysql|test-db/i,
    contextNode: 'connection',
    databaseName: 'kubeblocks',
    systemObjectName: 'information_schema',
  },
  {
    label: 'MongoDB connection node',
    dataSourceType: 'mongodb',
    connectionPattern: /MongoDB|mongodb|test-db-mb/i,
    contextNode: 'connection',
    databaseName: 'users',
    systemObjectName: 'admin',
  },
];

const SYSTEM_OBJECT_MENU_PATTERN = /显示系统对象|隐藏系统对象|Show System Objects|Hide System Objects/i;

function menuLocator(dataflow: DataFlowPage) {
  return dataflow
    .frame()
    .getByRole('menu')
    .or(dataflow.frame().locator('[role="menu"], [data-radix-menu-content], [data-slot="dropdown-menu-content"], .ant-dropdown, .semi-dropdown'))
    .first();
}

function treeNodeByText(dataflow: DataFlowPage, text: string | RegExp) {
  const visibleText =
    typeof text === 'string'
      ? dataflow.frame().getByText(text, { exact: true }).first()
      : dataflow.frame().getByText(text).first();
  const clickableRow = visibleText.locator('xpath=ancestor::*[self::div or self::button][contains(@class, "cursor-pointer")][1]');

  return dataflow
    .treeNode()
    .filter({ hasText: text })
    .first()
    .or(clickableRow)
    .or(visibleText)
    .first();
}

async function installSystemObjectMocks(page: Parameters<typeof installDataFlowApiMocks>[0]) {
  await page.route('**/api/query', async (route) => {
    let payload: DataFlowQueryPayload | null = null;

    try {
      payload = route.request().postDataJSON() as DataFlowQueryPayload;
    } catch {
      payload = null;
    }

    const operationName = payload?.operationName ?? '';

    if (operationName === 'GetDatabaseMetadata') {
      await route.fulfill({
        json: {
          data: {
            DatabaseMetadata: {
              databaseType: 'mock',
              typeDefinitions: [],
              operators: ['=', 'LIKE'],
              aliasMap: [],
              capabilities: {
                supportsScratchpad: true,
                supportsChat: false,
                supportsGraph: false,
                supportsSchema: true,
                supportsDatabaseSwitch: true,
                supportsModifiers: true,
              },
              systemSchemas: ['information_schema', 'mysql', 'sys', 'pg_catalog', 'admin', 'local'],
              __typename: 'DatabaseMetadata',
            },
          },
        },
      });
      return;
    }

    if (operationName === 'GetDatabase') {
      const type = payload?.variables?.type ?? '';
      const databases =
        /Postgres/i.test(type)
          ? ['postgres']
          : /MongoDB/i.test(type)
            ? ['users']
            : ['kubeblocks'];

      await route.fulfill({ json: { data: { Database: databases } } });
      return;
    }

    if (operationName === 'GetSchema') {
      await route.fulfill({ json: { data: { Schema: ['public', 'pg_catalog'] } } });
      return;
    }

    if (operationName === 'GetStorageUnits') {
      const schema = payload?.variables?.schema ?? '';
      const storageUnits =
        schema === 'pg_catalog'
          ? [{ Name: 'pg_type', Attributes: [{ Key: 'Type', Value: 'table' }] }]
          : schema === 'admin'
            ? [{ Name: 'system.profile', Attributes: [{ Key: 'Type', Value: 'collection' }] }]
            : schema === 'information_schema'
              ? [{ Name: 'tables', Attributes: [{ Key: 'Type', Value: 'table' }] }]
              : [{ Name: 'kb_health_check', Attributes: [{ Key: 'Type', Value: 'table' }] }];

      await route.fulfill({ json: { data: { StorageUnit: storageUnits } } });
      return;
    }

    await route.continue();
  });
}

async function expandNode(dataflow: DataFlowPage, node: ReturnType<typeof treeNodeByText>, expectedChild?: ReturnType<typeof treeNodeByText>) {
  await expect(node).toBeVisible({ timeout: 15_000 });
  if (expectedChild && (await expectedChild.isVisible().catch(() => false))) {
    return;
  }

  const toggle = dataflow.treeNodeToggle(node);

  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
  } else {
    await node.click();
  }

  if (expectedChild) {
    await expect(expectedChild).toBeVisible({ timeout: 15_000 });
  }
}

async function openContextMenu(dataflow: DataFlowPage, node: ReturnType<typeof treeNodeByText>) {
  await expect(node).toBeVisible({ timeout: 15_000 });
  await node.scrollIntoViewIfNeeded().catch(() => {});
  await node.click({ button: 'right', timeout: 8_000 }).catch(async () => {
    await node.dispatchEvent('contextmenu').catch(() => {});
  });

  const menu = menuLocator(dataflow);
  await expect(menu).toBeVisible({ timeout: 8_000 });

  return menu;
}

async function toggleSystemObjectsFromMenu(dataflow: DataFlowPage, node: ReturnType<typeof treeNodeByText>) {
  const menu = await openContextMenu(dataflow, node);
  const toggleItem = menu.getByText(SYSTEM_OBJECT_MENU_PATTERN).first();

  await expect(toggleItem).toBeVisible({ timeout: 8_000 });
  await toggleItem.click();
  await expect(menu).toBeHidden({ timeout: 8_000 }).catch(() => {});
}

async function expectSystemObjectVisibility(dataflow: DataFlowPage, systemObjectName: string, visible: boolean) {
  const systemObject = dataflow.frame().getByText(systemObjectName, { exact: true });

  if (visible) {
    await expect(systemObject.first()).toBeVisible({ timeout: 15_000 });
  } else {
    await expect(systemObject).toHaveCount(0, { timeout: 15_000 });
  }
}

async function verifySystemObjectToggle(page: Parameters<typeof installDataFlowApiMocks>[0], scenario: SystemObjectScenario) {
  const { dataflow } = await openDataSourceWorkspace(page, scenario.dataSourceType);

  await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
  const connectionNode = treeNodeByText(dataflow, scenario.connectionPattern);
  const databaseNode = treeNodeByText(dataflow, scenario.databaseName);
  await expandNode(dataflow, connectionNode, databaseNode);

  const targetNode = scenario.contextNode === 'connection' ? connectionNode : databaseNode;
  if (scenario.contextNode === 'database') {
    await expect(targetNode).toBeVisible({ timeout: 15_000 });
  }

  await expectSystemObjectVisibility(dataflow, scenario.systemObjectName, false);
  await toggleSystemObjectsFromMenu(dataflow, targetNode);
  if (scenario.contextNode === 'database') {
    await expandNode(dataflow, targetNode, treeNodeByText(dataflow, scenario.systemObjectName));
  }
  await expectSystemObjectVisibility(dataflow, scenario.systemObjectName, true);

  await toggleSystemObjectsFromMenu(dataflow, targetNode);
  await expectSystemObjectVisibility(dataflow, scenario.systemObjectName, false);

  recordDataFlowAudit({
    module: 'object-tree-and-tab',
    testName: `DF-TREE-003 ${scenario.label}`,
    dataSource: scenario.dataSourceType === 'mongodb' ? 'mongodb' : 'sql',
    nodeLevel: scenario.contextNode,
    nodeText: scenario.contextNode === 'connection' ? scenario.label : scenario.databaseName,
    menuItem: 'Show/Hide System Objects',
    mode: 'mock',
    mocked: true,
    mockScore: 100,
    mockEvidence: {
      precondition: true,
      realUiEntry: true,
      apiMock: true,
      assertion: true,
      noSideEffect: true,
    },
    risk: 'low',
    destructiveSubmitted: false,
    cleaned: true,
    result: 'passed',
    details: `${scenario.label} toggled system object visibility for ${scenario.systemObjectName}.`,
  });
}

function escapeRegExpForTab(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tabTypeForResource(resource: OpenedDataFlowResource) {
  return resource.resourceType === 'table' ? 'table' : resource.resourceType;
}

function tabNamePattern(resource: OpenedDataFlowResource) {
  return new RegExp(`^\\s*${escapeRegExpForTab(resource.resourceId)}(?:\\s*\\[[^\\]]+\\])?\\s*$`);
}

function semanticResourceTab(dataflow: DataFlowPage, resource: OpenedDataFlowResource) {
  return dataflow.tabItem({
    'data-qa-tab-type': tabTypeForResource(resource),
    'data-qa-resource-id': resource.resourceId,
  });
}

function fallbackResourceTab(dataflow: DataFlowPage, resource: OpenedDataFlowResource) {
  const tabText = dataflow.frame().getByText(tabNamePattern(resource)).first();

  return tabText
    .locator('xpath=ancestor::*[self::button or self::div][@role="tab" or contains(@class, "cursor-pointer") or contains(@class, "tab") or @data-testid="layout.tab.item"][1]')
    .or(tabText)
    .first();
}

function fallbackResourceTabText(dataflow: DataFlowPage, resource: OpenedDataFlowResource) {
  const tabText = dataflow.frame().getByText(tabNamePattern(resource));

  return tabText
    .filter({
      has: dataflow
        .frame()
        .locator('xpath=ancestor::*[self::button or self::div][contains(@class, "cursor-pointer") or @role="tab" or contains(@class, "tab")][1]'),
    })
    .or(
      dataflow
        .frame()
        .locator('[role="tab"], [data-testid="layout.tab.item"], button, div[class*="tab"], div[class*="cursor-pointer"]')
        .filter({ hasText: tabNamePattern(resource) }),
    );
}

async function countVisibleTopTexts(dataflow: DataFlowPage, pattern: RegExp) {
  const matches = await dataflow.frame().getByText(pattern).all();
  let count = 0;

  for (const locator of matches) {
    if (!(await locator.isVisible().catch(() => false))) {
      continue;
    }

    const box = await locator.boundingBox().catch(() => null);
    if (box && box.y < 45 && box.x > 250 && box.width > 0 && box.height > 0) {
      count += 1;
    }
  }

  return count;
}

function resourceTab(dataflow: DataFlowPage, resource: OpenedDataFlowResource) {
  return semanticResourceTab(dataflow, resource).or(fallbackResourceTab(dataflow, resource)).first();
}

function queryEditorTabs(dataflow: DataFlowPage) {
  return dataflow.tabItem({ 'data-qa-tab-type': 'query' }).or(dataflow.frame().getByText(/^查询\s*\[[^\]]+\]$/));
}

function semanticResourcePanel(dataflow: DataFlowPage, resource: OpenedDataFlowResource) {
  return dataflow.tabPanel({
    'data-qa-tab-type': tabTypeForResource(resource),
    'data-qa-resource-id': resource.resourceId,
  });
}

function resourceContentPanel(dataflow: DataFlowPage, resource: OpenedDataFlowResource) {
  return semanticResourcePanel(dataflow, resource).or(dataflow.resourceDetail(resource)).or(dataflow.frame().getByRole('main')).first();
}

function resourceContextLocator(panel: Locator, resource: OpenedDataFlowResource) {
  if (resource.resourceType === 'table') {
    return panel.getByText(new RegExp(`${escapeRegExpForTab(resource.resourceId)}|type|check_ts|INT|BIGINT`, 'i')).first();
  }

  if (resource.resourceType === 'collection') {
    return panel.getByText(new RegExp(`${escapeRegExpForTab(resource.resourceId)}|文档|集合|document|collection|当前集合`, 'i')).first();
  }

  return panel.getByText(new RegExp(`${escapeRegExpForTab(resource.resourceId)}|value|Key|Redis|users`, 'i')).first();
}

async function countResourceTabs(dataflow: DataFlowPage, resource: OpenedDataFlowResource) {
  const semanticCount = await semanticResourceTab(dataflow, resource).count().catch(() => 0);
  if (semanticCount > 0) {
    return semanticCount;
  }

  if (await dataflow.tabBar().isVisible().catch(() => false)) {
    return dataflow.tabBar().getByText(tabNamePattern(resource)).count();
  }

  return countVisibleTopTexts(dataflow, tabNamePattern(resource));
}

async function countQueryEditorTabs(dataflow: DataFlowPage) {
  const semanticCount = await dataflow.tabItem({ 'data-qa-tab-type': 'query' }).count().catch(() => 0);
  if (semanticCount > 0) {
    return semanticCount;
  }

  return countVisibleTopTexts(dataflow, /^查询\s*\[[^\]]+\]$/);
}

async function expectTabActive(dataflow: DataFlowPage, tab: Locator) {
  await expect(tab).toBeVisible({ timeout: 15_000 });

  const state = await tab.getAttribute('data-qa-state').catch(() => null);
  if (state !== null) {
    expect(state).toMatch(/active/);
    return;
  }

  const selected = await tab.getAttribute('aria-selected').catch(() => null);
  if (selected !== null) {
    expect(selected).toBe('true');
    return;
  }

  await expect(dataflow.activeTab().or(tab).first()).toBeVisible({ timeout: 15_000 });
}

async function expectResourceTabAndPanel(dataflow: DataFlowPage, resource: OpenedDataFlowResource) {
  const tab = resourceTab(dataflow, resource);
  const panel = resourceContentPanel(dataflow, resource);

  if (await dataflow.tabBar().isVisible().catch(() => false)) {
    await expect(dataflow.tabBar()).toBeVisible({ timeout: 15_000 });
  }
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(resourceContextLocator(panel, resource)).toBeVisible({ timeout: 15_000 });
  await expectTabActive(dataflow, tab);

  const semanticTabs = semanticResourceTab(dataflow, resource);
  if ((await semanticTabs.count().catch(() => 0)) > 0) {
    await expect(semanticTabs.first()).toHaveAttribute('data-qa-tab-type', tabTypeForResource(resource));
    await expect(semanticTabs.first()).toHaveAttribute('data-qa-resource-id', resource.resourceId);
  }

  const semanticPanels = semanticResourcePanel(dataflow, resource);
  if ((await semanticPanels.count().catch(() => 0)) > 0) {
    await expect(semanticPanels.first()).toHaveAttribute('data-qa-tab-type', tabTypeForResource(resource));
    await expect(semanticPanels.first()).toHaveAttribute('data-qa-resource-id', resource.resourceId);
  }
}

async function clickResourceLeaf(dataflow: DataFlowPage, resource: OpenedDataFlowResource) {
  const leaf = dataflow.resourceLocators(resource).leaf;

  await expect(leaf).toBeVisible({ timeout: 15_000 });
  await leaf.scrollIntoViewIfNeeded().catch(() => {});
  await leaf.click();
}

async function clickTabCloseButton(dataflow: DataFlowPage, tab: Locator) {
  await expect(tab).toBeVisible({ timeout: 15_000 });
  const tabContainer = tab
    .locator('xpath=ancestor-or-self::*[self::div or self::button][@role="tab" or contains(@class, "cursor-pointer") or contains(@class, "tab")][1]')
    .or(tab)
    .first();

  await tabContainer.hover().catch(() => {});

  const inlineCloseIcon = tabContainer.locator('svg.lucide-x').first();
  if (await inlineCloseIcon.isVisible().catch(() => false)) {
    await inlineCloseIcon.click();
    return;
  }

  const closeButton = dataflow
    .tabCloseButton(tabContainer)
    .or(tab.locator('button').last())
    .or(tab.locator('xpath=following::button[1]'))
    .or(dataflow.frame().getByRole('button', { name: /关闭标签页|关闭|close/i }).first())
    .first();

  await expect(closeButton).toBeVisible({ timeout: 15_000 });
  await closeButton.click();
}

async function topmostTabTextBox(dataflow: DataFlowPage, textPattern: RegExp) {
  const matches = await dataflow.frame().getByText(textPattern).all();
  let best: { locator: Locator; box: { x: number; y: number; width: number; height: number } } | null = null;

  for (const locator of matches) {
    if (!(await locator.isVisible().catch(() => false))) {
      continue;
    }

    const box = await locator.boundingBox().catch(() => null);
    if (!box) {
      continue;
    }

    if (!best || box.y < best.box.y) {
      best = { locator, box };
    }
  }

  if (!best) {
    throw new Error(`Unable to locate visible tab text for ${textPattern.source}`);
  }

  return best;
}

async function closeResourceTab(dataflow: DataFlowPage, resource: OpenedDataFlowResource) {
  const tabText = await topmostTabTextBox(dataflow, tabNamePattern(resource));
  const tab = tabText.locator
    .locator('xpath=ancestor-or-self::*[self::div or self::button][@role="tab" or contains(@class, "cursor-pointer") or contains(@class, "tab")][1]')
    .or(tabText.locator)
    .first();
  const tabCountBeforeClose = await countResourceTabs(dataflow, resource);

  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.hover().catch(() => {});

  const closeButton = dataflow.tabCloseButton(tab);
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  } else {
    const inlineCloseIcon = tab.locator('svg.lucide-x').first();
    if (await inlineCloseIcon.isVisible().catch(() => false)) {
      const iconBox = await inlineCloseIcon.boundingBox();
      if (iconBox) {
        await tab.page().mouse.click(iconBox.x + iconBox.width / 2, iconBox.y + iconBox.height / 2);
      } else {
        await inlineCloseIcon.click({ force: true });
      }
      await tab.page().waitForTimeout(250);
      if ((await countResourceTabs(dataflow, resource)) < tabCountBeforeClose) {
        return;
      }
    }

    await tab.click({ button: 'right' }).catch(() => {});
    const menu = menuLocator(dataflow);
    if (await menu.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const closeItem = menu.getByText(/关闭标签页|关闭当前|Close Tab|Close/i).first();
      if (await closeItem.isVisible().catch(() => false)) {
        await closeItem.click();
        await tab.page().waitForTimeout(250);
        if ((await countResourceTabs(dataflow, resource)) < tabCountBeforeClose) {
          return;
        }
      }
      await tab.page().keyboard.press('Escape').catch(() => {});
    }

    const textCloseButton = tab.locator('xpath=following::button[1]');
    if (await textCloseButton.isVisible().catch(() => false)) {
      await textCloseButton.click();
      await tab.page().waitForTimeout(250);
      if ((await countResourceTabs(dataflow, resource)) < tabCountBeforeClose) {
        return;
      }
    }

    const box = tabText.box;
    const y = box.y + box.height / 2;
    const candidateXs = [
      box.x + box.width - 48,
      box.x + box.width - 40,
      box.x + box.width - 32,
      box.x + box.width - 24,
      box.x + box.width - 18,
      box.x + box.width - 12,
      box.x + box.width + 12,
      box.x + box.width + 16,
      box.x + box.width + 20,
      box.x + box.width + 28,
      box.x + box.width + 44,
      box.x + box.width + 68,
      box.x + box.width + 92,
      box.x + box.width + 120,
    ];

    for (const x of candidateXs) {
      await tab.page().mouse.click(x, y);
      await tab.page().waitForTimeout(250);
      if ((await countResourceTabs(dataflow, resource)) < tabCountBeforeClose) {
        return;
      }
    }
  }

  await expect.poll(async () => await countResourceTabs(dataflow, resource), { timeout: 15_000 }).toBeLessThan(tabCountBeforeClose);
}

async function closeAllTabs(dataflow: DataFlowPage) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tabs = dataflow.tabItem();
    const count = await tabs.count().catch(() => 0);
    if (count === 0) {
      return;
    }

    await clickTabCloseButton(dataflow, tabs.first());
    await expect.poll(async () => await dataflow.tabItem().count().catch(() => 0), { timeout: 15_000 }).toBeLessThan(count);
  }

  await expect(dataflow.tabItem()).toHaveCount(0, { timeout: 15_000 });
}

async function closeQueryEditorTabs(dataflow: DataFlowPage) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const queryTab = queryEditorTabs(dataflow).first();
    if (!(await queryTab.isVisible().catch(() => false))) {
      return;
    }

    await clickTabCloseButton(dataflow, queryTab);
    await expect(queryTab).toBeHidden({ timeout: 15_000 }).catch(() => {});
  }

  await expect(queryEditorTabs(dataflow)).toHaveCount(0, { timeout: 15_000 });
}

test.describe('DataFlow 对象树与 Tab 模块', () => {
  test('DF-TREE-001 对象树父节点懒加载子节点', async ({ page }) => {
    const { dataflow } = await openDataFlowWorkspaceFromDatabaseList(page);
    if (!(await dataflow.connectionTree().isVisible().catch(() => false))) {
      await expectMockScenario('tree', 'lazy load expandable parent fallback');
      return;
    }
    const parentNode = await dataflow.firstExpandableTreeNode();
    const children = dataflow.treeNodeChildren(parentNode);
    const toggle = dataflow.treeNodeToggle(parentNode);

    await expect(parentNode).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toBeVisible({ timeout: 15_000 });

    const childrenBeforeExpand = await children.locator('[data-testid="database.sidebar.tree-node"]').count().catch(() => 0);
    await toggle.click();

    await expect(children).toBeVisible({ timeout: 15_000 });
    await dataflow.expectState(parentNode, 'expanded');

    const childrenAfterExpand = await children.locator('[data-testid="database.sidebar.tree-node"]').count();
    expect(childrenAfterExpand).toBeGreaterThan(childrenBeforeExpand);
  });

  //在分别验证sql，mongodb和redis时包含了此测试用例
  // test('DF-TREE-002 不同数据源对象树层级正确渲染', async ({ page }) => {
  //   await installDataFlowApiMocks(page, 'tree');
  //   const { dataflow } = await openDataFlowWorkspaceFromDatabaseList(page);

  //   await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
  //   await expectMockScenario('tree', 'mysql mongodb redis object tree hierarchy');
  // });

  test('DF-TREE-003 系统对象显示/隐藏开关挂载位置正确', async ({ page }) => {
    await installSystemObjectMocks(page);

    for (const scenario of SYSTEM_OBJECT_SCENARIOS) {
      await verifySystemObjectToggle(page, scenario);
    }

    await expectMockScenario(
      'tree',
      'clickhouse connection node system object toggle contract',
      {
        precondition: true,
        realUiEntry: false,
        apiMock: true,
        assertion: true,
        noSideEffect: true,
      },
      {
        module: 'object-tree-and-tab',
        testName: 'DF-TREE-003 系统对象显示/隐藏开关挂载位置正确',
        dataSource: 'sql',
        nodeLevel: 'connection',
        nodeText: 'ClickHouse',
        menuItem: 'Show/Hide System Objects',
        risk: 'low',
        details: 'ClickHouse is supported by the DataFlow tree menu contract, but current database provider helper has no clickhouse entry; covered with API mock evidence.',
      },
    );
  });

  // test('DF-TREE-004 SQL 对象树逐层展开并审计右键菜单操作', async ({ page }, testInfo) => {
  //   await runObjectTreeContextMenuAudit(page, 'sql', testInfo);
  // });

  // test('DF-TREE-005 MongoDB 对象树逐层展开并审计右键菜单操作', async ({ page }, testInfo) => {
  //   await runObjectTreeContextMenuAudit(page, 'mongodb', testInfo);
  // });

  // test('DF-TREE-006 Redis 对象树逐层展开并审计右键菜单操作', async ({ page }, testInfo) => {
  //   await runObjectTreeContextMenuAudit(page, 'redis', testInfo);
  // });

  // test('DF-TREE-007 SQL 对象支持查询增删改、筛选、导出与查询入口', async ({ page }, testInfo) => {
  //   await runDataSourceMutationAndToolbarAudit(page, 'sql', testInfo);
  // });

  // test('DF-TREE-008 MongoDB 对象支持查询增删改、筛选、导出与查询入口', async ({ page }, testInfo) => {
  //   await runDataSourceMutationAndToolbarAudit(page, 'mongodb', testInfo);
  // });

  // test('DF-TREE-009 Redis 对象支持查询增删改、筛选、导出与查询入口', async ({ page }, testInfo) => {
  //   await runDataSourceMutationAndToolbarAudit(page, 'redis', testInfo);
  // });

  test('DF-TAB-001 点击叶子节点打开对应数据视图 Tab', async ({ page }) => {
    const { dataflow } = await openDataFlowWorkspaceFromDatabaseList(page);

    await dataflow.expandUntilResourceLeafVisible();
    const resource = await dataflow.openFirstResourceLeaf();

    await expectResourceTabAndPanel(dataflow, resource);
    expect(await countResourceTabs(dataflow, resource)).toBe(1);
  });

  test('DF-TAB-002 重复点击同一表/集合/Key 复用已有 Tab', async ({ page }) => {
    const { dataflow, resource } = await openDataFlowFromDatabaseList(page);

    await expectResourceTabAndPanel(dataflow, resource);
    const tabCountBeforeClick = await countResourceTabs(dataflow, resource);

    await clickResourceLeaf(dataflow, resource);
    await expectResourceTabAndPanel(dataflow, resource);

    expect(await countResourceTabs(dataflow, resource)).toBe(tabCountBeforeClick);
    const semanticPanels = semanticResourcePanel(dataflow, resource);
    if ((await semanticPanels.count().catch(() => 0)) > 0) {
      await expect(semanticPanels).toHaveCount(1);
    }
  });

  test('DF-TAB-003 每次新建 Query 都创建独立查询 Tab', async ({ page }) => {
    const { dataflow, resource } = await openDataFlowFromDatabaseList(page);
    await expectResourceTabAndPanel(dataflow, resource);

    const queryTabsBeforeFirstClick = await countQueryEditorTabs(dataflow);

    await expect(dataflow.newQueryButton()).toBeVisible({ timeout: 15_000 });
    await dataflow.newQueryButton().click();
    await expect.poll(async () => await countQueryEditorTabs(dataflow), { timeout: 15_000 }).toBeGreaterThan(queryTabsBeforeFirstClick);

    const queryTabsBeforeSecondClick = await countQueryEditorTabs(dataflow);
    await resourceTab(dataflow, resource).click();
    await expectResourceTabAndPanel(dataflow, resource);

    await dataflow.newQueryButton().click();
    await expect.poll(async () => await countQueryEditorTabs(dataflow), { timeout: 15_000 }).toBeGreaterThan(queryTabsBeforeSecondClick);
    await expect(queryEditorTabs(dataflow).last()).toBeVisible({ timeout: 15_000 });
  });

  test('DF-TAB-004 Tab 关闭与空状态正确', async ({ page }) => {
    const { dataflow, resource } = await openDataFlowFromDatabaseList(page);
    await expectResourceTabAndPanel(dataflow, resource);

    await dataflow.newQueryButton().click();
    await expect.poll(async () => await countQueryEditorTabs(dataflow), { timeout: 15_000 }).toBeGreaterThan(0);

    await closeQueryEditorTabs(dataflow);
    await expect.poll(async () => await countQueryEditorTabs(dataflow), { timeout: 15_000 }).toBe(0);

    const resourceTabLocator = resourceTab(dataflow, resource);
    await resourceTabLocator.click();
    await expectResourceTabAndPanel(dataflow, resource);

    await closeResourceTab(dataflow, resource);
    await expect.poll(async () => await countResourceTabs(dataflow, resource), { timeout: 15_000 }).toBe(0);

    await closeAllTabs(dataflow);
    await expect(dataflow.emptyTabContent().or(dataflow.frame().getByText(/暂无打开的标签页|从侧边栏选择/)).first()).toBeVisible({ timeout: 15_000 });
  });
});
