import { expect, type Page } from '@playwright/test';
import { type DataFlowPage, type DataFlowResourceType, type OpenedDataFlowResource } from '../../src/pages/dataflow.page.js';
import { type ManageableDataSourceType } from '../../src/pages/sealos-home.page.js';
import { openDataFlowFromDatabaseList } from './dataflow-flow.js';
import { openDataSourceWorkspace, openFirstResourceOfType } from './non-sql-dataflow-flow.js';

export type QueryEditorTarget = {
  dataSourceType: ManageableDataSourceType;
  resourceType: DataFlowResourceType;
  expectedEditorKind: 'sql' | 'mongodb' | 'redis';
};

type QueryEditorDataFlow = DataFlowPage;

type OpenedQueryEditorResource = {
  dataflow: DataFlowPage;
  home: unknown;
  resource: OpenedDataFlowResource;
  leaf: ReturnType<DataFlowPage['resourceLeaf']>;
};

const SQL_QUERY_TARGET: QueryEditorTarget = {
  dataSourceType: 'mysql',
  resourceType: 'table',
  expectedEditorKind: 'sql',
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function queryEditorEntry(dataflow: QueryEditorDataFlow, detail: ReturnType<QueryEditorDataFlow['resourceDetail']>, expectedEditorKind: QueryEditorTarget['expectedEditorKind']) {
  const editorLabel =
    expectedEditorKind === 'sql'
      ? /新建查询|查询|Query|SQL/i
      : expectedEditorKind === 'mongodb'
        ? /新建查询|查询|命令|Command|Mongo|Query/i
        : /新建查询|查询|命令|Command|Redis|Query/i;

  return detail
    .getByRole('button', { name: editorLabel })
    .or(dataflow.newQueryButton())
    .or(dataflow.tabBar().locator('button').last())
    .or(dataflow.frame().locator('button:has(svg.lucide-plus), button:has(svg[class*="plus" i])').first())
    .or(dataflow.frame().getByText(/新建一个查询|新建查询|new query/i).first())
    .or(dataflow.frame().getByRole('button', { name: editorLabel }))
    .first();
}

function directQueryEntry(dataflow: QueryEditorDataFlow, expectedEditorKind: QueryEditorTarget['expectedEditorKind']) {
  const editorLabel =
    expectedEditorKind === 'redis'
      ? /新建查询|查询|命令|Command|Redis|Query/i
      : /新建查询|查询|Query/i;

  return dataflow
    .newQueryButton()
    .or(dataflow.tabBar().locator('button').last())
    .or(dataflow.frame().locator('button:has(svg.lucide-plus), button:has(svg[class*="plus" i])').first())
    .or(dataflow.frame().getByRole('button', { name: editorLabel }))
    .first();
}

function keyDetailQueryEntry(dataflow: QueryEditorDataFlow, detail: ReturnType<QueryEditorDataFlow['resourceDetail']>, expectedEditorKind: QueryEditorTarget['expectedEditorKind']) {
  return queryEditorEntry(dataflow, detail, expectedEditorKind).or(directQueryEntry(dataflow, expectedEditorKind)).first();
}

function contextMenu(dataflow: QueryEditorDataFlow) {
  return dataflow
    .frame()
    .getByRole('menu')
    .or(dataflow.frame().locator('[role="menu"], [data-radix-menu-content], [data-slot="dropdown-menu-content"], .ant-dropdown, .semi-dropdown'))
    .first();
}

async function redisNodeForNewQuery(dataflow: QueryEditorDataFlow) {
  const semanticNode = dataflow
    .treeNode()
    .filter({ hasText: /test-db-redis|kubeblocks|mydb|codex_e2e|admin|^0$/i })
    .first();
  if (await semanticNode.isVisible().catch(() => false)) {
    return semanticNode;
  }

  const nodeText = dataflow.frame().getByText(/test-db-redis|kubeblocks|mydb|codex_e2e|admin|^0$/i).first();
  await expect(nodeText).toBeVisible({ timeout: 15_000 });
  return nodeText
    .locator(
      'xpath=ancestor::*[@data-testid="database.sidebar.tree-node" or @role="treeitem" or self::button or contains(@class, "cursor-pointer") or contains(@class, "rounded")][1]',
    )
    .or(nodeText)
    .first();
}

async function openRedisQueryFromWorkspace(page: Page, dataflow: QueryEditorDataFlow) {
  const directEntry = directQueryEntry(dataflow, 'redis');
  if (await directEntry.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await directEntry.click();
    return;
  }

  const node = await redisNodeForNewQuery(dataflow);
  await node.click({ button: 'right', timeout: 8_000 }).catch(async () => {
    await node.dispatchEvent('contextmenu').catch(() => {});
  });

  const menu = contextMenu(dataflow);
  const newQueryItem = menu
    .getByRole('menuitem', { name: /New Query|新建查询|查询/i })
    .or(menu.locator('[role="menuitem"], [data-slot*="menu-item"], .ant-dropdown-menu-item, .semi-dropdown-item, button').filter({ hasText: /New Query|新建查询|查询/i }))
    .first();
  if (await newQueryItem.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await newQueryItem.click();
    return;
  }

  await page.keyboard.press('Escape').catch(() => {});
  await dataflow.mainRegion().or(dataflow.frame().getByRole('main')).first().click({ force: true }).catch(() => {});
  await dataflow.frame().locator('body').press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K').catch(async () => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  });
}

async function resolveTextLeaf(dataflow: DataFlowPage, resourceId: string) {
  const leafPattern = new RegExp(`^\\s*${escapeRegExp(resourceId)}\\s*$`, 'i');
  const leafText = dataflow.databaseSidebar().getByText(leafPattern).first().or(dataflow.frame().getByText(leafPattern).first()).first();
  await expect(leafText).toBeVisible({ timeout: 15_000 });

  return leafText
    .locator(
      'xpath=ancestor::*[@data-testid="database.sidebar.tree-node" or @role="treeitem" or self::button or contains(@class, "cursor-pointer") or contains(@class, "rounded")][1]',
    )
    .or(leafText)
    .first();
}

async function expandTreeForTextLeaf(dataflow: DataFlowPage, candidates: readonly string[]) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    for (const candidate of candidates) {
      if (await dataflow.frame().getByText(new RegExp(`^\\s*${escapeRegExp(candidate)}\\s*$`, 'i')).first().isVisible().catch(() => false)) {
        return;
      }
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

    const sidebarButton = dataflow
      .frame()
      .locator('button')
      .filter({ hasNotText: /工作台|仪表盘|筛选|导出|查询|Query|Export|Filter/i })
      .first();
    if (await sidebarButton.isVisible().catch(() => false)) {
      await sidebarButton.click();
      continue;
    }

    break;
  }
}

async function openTextResourceLeaf(dataflow: DataFlowPage, target: QueryEditorTarget, candidates: readonly string[]) {
  await expandTreeForTextLeaf(dataflow, candidates);

  for (const candidate of candidates) {
    const leafText = dataflow.frame().getByText(new RegExp(`^\\s*${escapeRegExp(candidate)}\\s*$`, 'i')).last();
    if (!(await leafText.isVisible().catch(() => false))) {
      continue;
    }

    const leaf = await resolveTextLeaf(dataflow, candidate);
    const resource: OpenedDataFlowResource = { resourceType: target.resourceType, resourceId: candidate };
    if (candidate === 'Keys' && target.resourceType === 'redis_key') {
      await expect(leaf).toBeVisible({ timeout: 15_000 });
      await leaf.scrollIntoViewIfNeeded().catch(() => {});
      await leaf.click({ force: true });
      await expect(dataflow.mainRegion().or(dataflow.frame().getByRole('main')).first()).toBeVisible({ timeout: 15_000 });
    } else {
      await dataflow.openTreeLeaf(leaf, dataflow.resourceLocators(resource).detail);
    }
    return { resource, leaf };
  }

  const sidebarText = await dataflow.frame().locator('body').innerText().catch(() => '');
  throw new Error(`No ${target.dataSourceType} ${target.resourceType} text leaf was visible. Tried: ${candidates.join(', ')}. Sidebar: ${sidebarText.slice(0, 500)}`);
}

async function openRedisKeyLeaf(dataflow: DataFlowPage) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const semanticLeaf = dataflow.resourceLeaf({ 'data-qa-resource-type': 'redis_key' }).first();
    if (await semanticLeaf.isVisible().catch(() => false)) {
      const resourceId = await semanticLeaf.getAttribute('data-qa-resource-id');
      if (resourceId) {
        const resource: OpenedDataFlowResource = { resourceType: 'redis_key', resourceId };
        await dataflow.openTreeLeaf(semanticLeaf, dataflow.resourceLocators(resource).detail);
        return { resource, leaf: semanticLeaf };
      }
    }

    const keyText = dataflow.frame().getByText(/^codex:e2e:chart:data$/).first();
    if (await keyText.isVisible().catch(() => false)) {
      const leaf = await resolveTextLeaf(dataflow, 'codex:e2e:chart:data');
      const resource: OpenedDataFlowResource = { resourceType: 'redis_key', resourceId: 'codex:e2e:chart:data' };
      await dataflow.openTreeLeaf(leaf, dataflow.resourceLocators(resource).detail);
      return { resource, leaf };
    }

    const keysFolder = dataflow
      .databaseSidebar()
      .getByText(/^Keys$/)
      .last()
      .locator('xpath=ancestor::*[@data-testid="database.sidebar.tree-node" or @role="treeitem" or self::button or contains(@class, "cursor-pointer") or contains(@class, "rounded")][1]');
    if (await keysFolder.isVisible().catch(() => false)) {
      await keysFolder.click({ force: true });
      continue;
    }

    const collapsedToggle = dataflow
      .frame()
      .locator('[data-testid="database.sidebar.tree-node-toggle"][data-qa-state~="collapsed"], [aria-expanded="false"]')
      .first();
    if (await collapsedToggle.isVisible().catch(() => false)) {
      await collapsedToggle.click();
      continue;
    }

    break;
  }

  const sidebarText = await dataflow.frame().locator('body').innerText().catch(() => '');
  throw new Error(`No existing Redis key leaf was available for query editor validation. Sidebar: ${sidebarText.slice(0, 500)}`);
}

async function openStrictResourceLeaf(page: Page, target: QueryEditorTarget): Promise<OpenedQueryEditorResource> {
  if (target.dataSourceType === 'mysql' && target.resourceType === 'table') {
    const opened = await openDataFlowFromDatabaseList(page, { dataSourceType: 'mysql' });
    const leaf = await resolveTextLeaf(opened.dataflow, opened.resource.resourceId);
    return { ...opened, leaf };
  }

  if (target.dataSourceType === 'mongodb' && target.resourceType === 'collection') {
    const opened = await openDataSourceWorkspace(page, 'mongodb');
    const { resource, leaf } = await openTextResourceLeaf(opened.dataflow, target, ['user', 'codex_e2e_chart_data', 'kb_health_check']);
    return { ...opened, resource, leaf };
  }

  if (target.dataSourceType === 'redis' && target.resourceType === 'redis_key') {
    const opened = await openDataSourceWorkspace(page, 'redis');
    await expect(opened.dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
    const leaf = await redisNodeForNewQuery(opened.dataflow);
    const resource: OpenedDataFlowResource = { resourceType: 'redis_key', resourceId: 'redis-direct-query' };
    return { ...opened, resource, leaf };
  }

  const opened = await openFirstResourceOfType(page, target.dataSourceType, target.resourceType);
  if (!opened.resource || !opened.leaf) {
    throw new Error(`No ${target.dataSourceType} ${target.resourceType} leaf node was available for query editor validation.`);
  }

  return {
    dataflow: opened.dataflow,
    home: opened.home,
    resource: opened.resource,
    leaf: opened.leaf,
  };
}

export async function openQueryEditorFromResourceDetail(page: Page, target: QueryEditorTarget) {
  const opened = await openStrictResourceLeaf(page, target);

  const { dataflow, resource } = opened;
  const locators = dataflow.resourceLocators(resource);
  const detail = dataflow.resourceDetail(resource).or(locators.detail).first();
  const tab = locators.tab;
  const redisDirectQueryContext = target.dataSourceType === 'redis' && resource.resourceId === 'redis-direct-query';

  await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
  await expect(opened.leaf).toBeVisible({ timeout: 15_000 });
  if (redisDirectQueryContext) {
    await expect(dataflow.mainRegion().or(dataflow.frame().getByRole('main')).first()).toBeVisible({ timeout: 15_000 });
  } else {
    await expect(detail).toBeVisible({ timeout: 15_000 });
    await expect(tab, `${target.dataSourceType} ${target.resourceType} detail tab must be open before query editor`).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.emptyTabContent().or(dataflow.frame().getByText(/暂无打开的标签页|从侧边栏选择/)).first()).toBeHidden({ timeout: 15_000 });
  }

  const entry =
    target.dataSourceType === 'redis'
      ? keyDetailQueryEntry(dataflow, detail, target.expectedEditorKind)
      : redisDirectQueryContext
        ? directQueryEntry(dataflow, target.expectedEditorKind)
        : queryEditorEntry(dataflow, detail, target.expectedEditorKind);
  if (redisDirectQueryContext) {
    await openRedisQueryFromWorkspace(page, dataflow);
  } else {
    await expect(entry, `${target.expectedEditorKind} query editor entry must be visible from the opened detail context`).toBeVisible({ timeout: 15_000 });
    await entry.click();
  }
  await expect(dataflow.queryEditor().or(dataflow.frame().getByText(/SELECT\s+\*\s+FROM|运行查询以查看结果|结果|消息|查询|命令/i)).first()).toBeVisible({
    timeout: 15_000,
  });

  return { ...opened, detail, tab };
}

export async function openSqlQueryEditor(page: Page) {
  return openQueryEditorFromResourceDetail(page, SQL_QUERY_TARGET);
}

export function queryEditorTextArea(dataflow: QueryEditorDataFlow) {
  return dataflow.queryEditorInput();
}

export function queryRunButton(dataflow: QueryEditorDataFlow) {
  return dataflow.byQa('sql.editor.run-button')
    .or(dataflow.byQa('query.editor.run-button'))
    .or(dataflow.frame().getByRole('button', { name: /运行|执行|Run|Execute/i }))
    .or(dataflow.frame().locator('button:has(svg.lucide-play), button:has(svg[class*="play" i]), button:has(svg[data-lucide="play"])'))
    .or(dataflow.frame().locator('[data-slot="tooltip-trigger"]:has(svg.lucide-play), [data-slot="tooltip-trigger"]:has(svg[class*="play" i])'))
    .first();
}

export function queryResultPane(dataflow: QueryEditorDataFlow) {
  return dataflow.byQa('sql.editor.result-pane').or(dataflow.frame().getByText(/运行查询以查看结果|结果|消息/).locator('xpath=ancestor::*[self::div or self::main][1]')).first();
}

export async function fillQueryEditor(dataflow: QueryEditorDataFlow, query: string) {
  const visibleEditor = dataflow
    .byQa('sql.editor.view')
    .or(dataflow.byQa('query.editor.view'))
    .or(dataflow.frame().locator('.monaco-editor, .cm-editor, [contenteditable="true"], textarea:not([aria-hidden="true"])'))
    .first();
  await expect(visibleEditor).toBeVisible({ timeout: 15_000 });
  await visibleEditor.click({ force: true });
  await dataflow.frame().locator('body').press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
  if (query.length > 0) {
    await dataflow.frame().locator('body').type(query);
  } else {
    await dataflow.frame().locator('body').press('Backspace').catch(() => {});
  }
}
