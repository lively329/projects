import { expect, type Page } from '@playwright/test';
import { DataFlowPage, type OpenedDataFlowResource } from '../../src/pages/dataflow.page.js';
import { type ManageableDataSourceType, SealosHomePage } from '../../src/pages/sealos-home.page.js';

export const ADMIN_PASSWORD = '8f4c75ceb5b1a372f58f64ccefa675df';

export type OpenDataFlowResult = {
  dataflow: DataFlowPage;
  home: SealosHomePage;
  resource: OpenedDataFlowResource;
};

export type OpenDataFlowWorkspaceResult = {
  dataflow: DataFlowPage;
  home: SealosHomePage;
  dataSourceType: ManageableDataSourceType;
};

export async function loginAndOpenDatabaseList(page: Page) {
  const home = new SealosHomePage(page);

  await home.goto();
  await home.login('admin', ADMIN_PASSWORD);
  await home.enterHomeState();
  await home.openDatabaseViaFolder();
  await expect(home.databaseWindowLocator()).toBeVisible({ timeout: 15_000 });

  return home;
}

export async function openDataFlowFromDatabaseList(
  page: Page,
  options: { verifyTableData?: boolean; dataSourceType?: ManageableDataSourceType } = {},
): Promise<OpenDataFlowResult> {
  const home = await loginAndOpenDatabaseList(page);
  const result = await home.openDatabaseManagement(options);
  const dataflow = new DataFlowPage(page);

  await dataflow.waitForConnectionsWorkspace();

  return { dataflow, home, resource: result.resource };
}

export async function openDataFlowWorkspaceFromDatabaseList(
  page: Page,
  options: { dataSourceType?: ManageableDataSourceType } = {},
): Promise<OpenDataFlowWorkspaceResult> {
  const home = await loginAndOpenDatabaseList(page);
  const result = await home.openDatabaseManagementWorkspace({ dataSourceType: options.dataSourceType });
  const dataflow = new DataFlowPage(page);

  await dataflow.waitForConnectionsWorkspace();

  return { dataflow, home, dataSourceType: result.dataSourceType };
}
