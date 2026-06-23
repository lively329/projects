import { expect, type Page } from '@playwright/test';
import { DataFlowPage, type DataFlowResourceType, type OpenedDataFlowResource } from '../../src/pages/dataflow.page.js';
import { type ManageableDataSourceType, SealosHomePage } from '../../src/pages/sealos-home.page.js';
import { ADMIN_PASSWORD } from './dataflow-flow.js';

export async function openDataSourceWorkspace(page: Page, dataSourceType: ManageableDataSourceType) {
  const home = new SealosHomePage(page);

  await home.goto();
  await home.login('admin', ADMIN_PASSWORD);
  await home.enterHomeState();
  await home.openDatabaseViaFolder();
  await home.openDatabaseManagementWorkspace({ dataSourceType });

  const dataflow = new DataFlowPage(page);
  await dataflow.waitForConnectionsWorkspace();

  return { dataflow, home };
}

export async function openFirstResourceOfType(page: Page, dataSourceType: ManageableDataSourceType, resourceType: DataFlowResourceType) {
  const { dataflow, home } = await openDataSourceWorkspace(page, dataSourceType);

  await dataflow.expandUntilResourceLeafVisible().catch(() => {});

  const leaf = dataflow.resourceLeaf({ 'data-qa-resource-type': resourceType }).first();
  const hasLeaf = await leaf.isVisible().catch(() => false);

  if (!hasLeaf) {
    return { dataflow, home, resource: null, leaf: null };
  }

  const resourceId = await leaf.getAttribute('data-qa-resource-id');
  if (!resourceId) {
    return { dataflow, home, resource: null, leaf: null };
  }

  const resource: OpenedDataFlowResource = { resourceType, resourceId };
  await dataflow.openTreeLeaf(leaf, dataflow.resourceLocators(resource).detail);

  if (await dataflow.resourceDetail(resource).isVisible().catch(() => false)) {
    await dataflow.expectState(dataflow.resourceDetail(resource), 'ready').catch(() => {});
  }

  return { dataflow, home, resource, leaf };
}

export async function expectDataSourceWorkspaceReady(page: Page, dataSourceType: ManageableDataSourceType, label: RegExp) {
  const { dataflow } = await openDataSourceWorkspace(page, dataSourceType);

  await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
  await expect(dataflow.frame().getByText(label).first()).toBeVisible({ timeout: 15_000 });
  await expect(dataflow.emptyTabContent().or(dataflow.frame().getByText(/暂无打开的标签页|从侧边栏选择/)).first()).toBeVisible({ timeout: 15_000 });

  return dataflow;
}
