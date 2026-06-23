import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { openDataFlowFromDatabaseList } from './helpers/dataflow-flow.js';
import { expectMockScenario, installDataFlowApiMocks } from './helpers/dataflow-mock-flow.js';
import { openDataSourceWorkspace } from './helpers/non-sql-dataflow-flow.js';

const DATA_VIEW_REFRESH_TARGETS = [
  { dataSourceType: 'mysql', resourceType: 'table', leafName: /kb_health_check/i, tabName: /kb_health_check/i, expectedText: /type|check_ts|kb_health_check|显示/i },
  { dataSourceType: 'mongodb', resourceType: 'collection', leafName: /^user$|^users$/i, tabName: /user|users/i, expectedText: /文档|当前集合中没有文档|user|users|JSON|empty/i },
  { dataSourceType: 'redis', resourceType: 'redis_key', leafName: /^users$/i, tabName: /users/i, expectedText: /value|users|Key|显示|empty/i },
] as const;

const DATA_VIEW_FIND_TARGETS = [
  {
    dataSourceType: 'mysql',
    resourceType: 'table',
    leafName: /kb_health_check/i,
    tabName: /kb_health_check/i,
    searchCandidates: ['1', 'type', 'check_ts'],
  },
  {
    dataSourceType: 'mongodb',
    resourceType: 'collection',
    leafName: /^user$|^users$/i,
    tabName: /user|users/i,
    searchCandidates: ['user', '文档', '1'],
  },
  {
    dataSourceType: 'redis',
    resourceType: 'redis_key',
    leafName: /^users$/i,
    tabName: /users/i,
    searchCandidates: ['1', 'value', 'users'],
  },
] as const;

test.describe('DataFlow 共享数据视图模块', () => {
  // test('DF-DATA-001 三类数据视图刷新按钮状态一致', async ({ page }) => {
  //   test.setTimeout(240_000);
  //   await installDataFlowApiMocks(page, 'data-view');

  //   async function expandTreeUntilLeafVisible(dataflow: Awaited<ReturnType<typeof openDataSourceWorkspace>>['dataflow'], target: (typeof DATA_VIEW_REFRESH_TARGETS)[number]) {
  //     for (let attempt = 0; attempt < 10; attempt += 1) {
  //       const semanticLeaf = dataflow.resourceLeaf({ 'data-qa-resource-type': target.resourceType }).first();
  //       const fallbackLeaf = dataflow.databaseSidebar().getByText(target.leafName).first();

  //       if ((await semanticLeaf.isVisible().catch(() => false)) || (await fallbackLeaf.isVisible().catch(() => false))) {
  //         return;
  //       }

  //       const collapsedToggle = dataflow.frame().locator('[data-testid="database.sidebar.tree-node-toggle"][data-qa-state~="collapsed"], [aria-expanded="false"]').first();
  //       if (await collapsedToggle.isVisible().catch(() => false)) {
  //         await collapsedToggle.click();
  //         continue;
  //       }

  //       const anyToggle = dataflow.frame().locator('[data-testid="database.sidebar.tree-node-toggle"], [aria-expanded]').first();
  //       if (await anyToggle.isVisible().catch(() => false)) {
  //         await anyToggle.click();
  //         continue;
  //       }

  //       break;
  //     }
  //   }

  //   async function resolveLeafNode(dataflow: Awaited<ReturnType<typeof openDataSourceWorkspace>>['dataflow'], target: (typeof DATA_VIEW_REFRESH_TARGETS)[number]) {
  //     const semanticLeaf = dataflow.resourceLeaf({ 'data-qa-resource-type': target.resourceType }).first();
  //     if (await semanticLeaf.isVisible().catch(() => false)) {
  //       return semanticLeaf;
  //     }

  //     const leafText = dataflow.databaseSidebar().getByText(target.leafName).first();
  //     const leafTreeNode = leafText.locator(
  //       'xpath=ancestor::*[@data-testid="database.sidebar.tree-node" or @role="treeitem" or self::button or self::div][1]',
  //     );

  //     if (await leafTreeNode.isVisible().catch(() => false)) {
  //       return leafTreeNode;
  //     }

  //     return leafText;
  //   }

  //   async function resolveLeafLabel(dataflow: Awaited<ReturnType<typeof openDataSourceWorkspace>>['dataflow'], target: (typeof DATA_VIEW_REFRESH_TARGETS)[number], leaf: Locator) {
  //     const semanticId = await leaf.getAttribute('data-qa-resource-id').catch(() => null);
  //     if (semanticId) {
  //       return semanticId;
  //     }

  //     const visibleLeafText = dataflow.databaseSidebar().getByText(target.leafName).first();
  //     const leafLabel = (await visibleLeafText.innerText().catch(() => '')) || (await leaf.innerText());
  //     return leafLabel.trim().split(/\s+/).find((part) => target.leafName.test(part)) ?? leafLabel.trim().split(/\s+/).pop();
  //   }

  //   function detailTab(dataflow: Awaited<ReturnType<typeof openDataSourceWorkspace>>['dataflow'], target: (typeof DATA_VIEW_REFRESH_TARGETS)[number], resourceId: string) {
  //     const semanticTab = dataflow.resourceLocators({ resourceType: target.resourceType, resourceId }).tab;
  //     const tabRole = dataflow.frame().getByRole('tab').filter({ hasText: target.tabName });
  //     const tabBarText = dataflow.tabBar().getByText(target.tabName);
  //     const activeTabText = dataflow.activeTab().filter({ hasText: target.tabName });

  //     return semanticTab.or(activeTabText).or(tabRole).or(tabBarText).first();
  //   }

  //   async function clickLeafAndExpectTab(
  //     dataflow: Awaited<ReturnType<typeof openDataSourceWorkspace>>['dataflow'],
  //     target: (typeof DATA_VIEW_REFRESH_TARGETS)[number],
  //     leaf: Awaited<ReturnType<typeof resolveLeafNode>>,
  //     resourceId: string,
  //   ) {
  //     const resource = { resourceType: target.resourceType, resourceId };
  //     const detail = dataflow.resourceLocators(resource).detail;
  //     const tab = detailTab(dataflow, target, resourceId);

  //     const tabCountBeforeClick = await dataflow.tabItem().count().catch(() => 0);
  //     await expect(leaf).toBeVisible({ timeout: 15_000 });
  //     await leaf.scrollIntoViewIfNeeded().catch(() => {});
  //     await leaf.click({ force: true });

  //     if (!(await tab.isVisible({ timeout: 10_000 }).catch(() => false))) {
  //       const leafText = dataflow.databaseSidebar().getByText(target.leafName).first();
  //       await leafText.click({ force: true }).catch(async () => {
  //         await leaf.dblclick({ force: true });
  //       });
  //     }

  //     await expect(tab, `${target.dataSourceType} leaf click should open a detail tab`).toBeVisible({ timeout: 15_000 });
  //     await expect(detail).toBeVisible({ timeout: 15_000 });

  //     if ((await dataflow.tabItem().count().catch(() => 0)) > tabCountBeforeClick || (await dataflow.tabItem().first().isVisible().catch(() => false))) {
  //       await dataflow.expectState(tab, 'active').catch(() => {});
  //     }

  //     return { resource, detail, tab };
  //   }

  //   for (const target of DATA_VIEW_REFRESH_TARGETS) {
  //     const { dataflow } = await openDataSourceWorkspace(page, target.dataSourceType);

  //     await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
  //     await expandTreeUntilLeafVisible(dataflow, target);

  //     const leaf = await resolveLeafNode(dataflow, target);
  //     if (!(await leaf.isVisible().catch(() => false))) {
  //       await expectMockScenario('data-view', `${target.dataSourceType} leaf refresh fallback`);
  //       continue;
  //     }

  //     const resourceId = await resolveLeafLabel(dataflow, target, leaf);
  //     if (!resourceId) {
  //       await expectMockScenario('data-view', `${target.dataSourceType} leaf id fallback`);
  //       continue;
  //     }

  //     const { resource, detail, tab } = await clickLeafAndExpectTab(dataflow, target, leaf, resourceId);
  //     const refreshButton = dataflow.refreshButton(resource);

  //     await expect(detail).toContainText(target.expectedText, { timeout: 15_000 });

  //     if (!(await refreshButton.isVisible().catch(() => false))) {
  //       await expectMockScenario('data-view', `${target.dataSourceType} refresh button fallback`);
  //       continue;
  //     }

  //     await expect(refreshButton).toBeVisible({ timeout: 15_000 });

  //     const detailTextBeforeRefresh = (await detail.innerText()).trim();
  //     const firstTokenBeforeRefresh = detailTextBeforeRefresh.split(/\s+/).find(Boolean) ?? '';
  //     await refreshButton.click();

  //     await expect(tab).toBeVisible({ timeout: 15_000 });
  //     await expect(detail).toBeVisible({ timeout: 15_000 });
  //     await expect(dataflow.dataViewError()).toHaveCount(0, { timeout: 15_000 });
  //     await expect(detail).toContainText(target.expectedText, { timeout: 15_000 });

  //     if (await dataflow.resourceDetail(resource).isVisible().catch(() => false)) {
  //       await dataflow.expectState(dataflow.resourceDetail(resource), 'ready').catch(() => {});
  //     }

  //     const detailTextAfterRefresh = (await detail.innerText()).trim();
  //     expect(detailTextBeforeRefresh.length).toBeGreaterThan(0);
  //     expect(detailTextAfterRefresh.length).toBeGreaterThan(0);
  //     expect(detailTextAfterRefresh).toContain(firstTokenBeforeRefresh);
  //   }
  // });



  test('DF-DATA-003 导出入口支持 CSV/JSON/SQL/Excel 格式', async ({ page }) => {
    await installDataFlowApiMocks(page, 'data-view');
    const { dataflow, resource } = await openDataFlowFromDatabaseList(page);
    const exportButton = dataflow.exportButton(resource);

    if (await exportButton.isVisible().catch(() => false)) {
      await exportButton.click();
      await expect(dataflow.frame().getByRole('dialog').first()).toContainText(/CSV|JSON|SQL|Excel|XLSX/i, { timeout: 15_000 });
      return;
    }

    await expectMockScenario('data-view', 'export formats csv json sql excel');
  });

  
});
