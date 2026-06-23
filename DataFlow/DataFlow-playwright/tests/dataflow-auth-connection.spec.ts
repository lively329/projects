import { expect, test } from './fixtures.js';
import { DataFlowPage } from '../src/pages/dataflow.page.js';
import { loginAndOpenDatabaseList, openDataFlowFromDatabaseList } from './helpers/dataflow-flow.js';
import { expectMockScenario } from './helpers/dataflow-mock-flow.js';

test.describe('DataFlow 登录与连接模块', () => {
  test('DF-AUTH-001 从 Sealos 连接入口免配置进入 DataFlow', async ({ page }) => {
    const { dataflow, resource } = await openDataFlowFromDatabaseList(page);

    await expect(dataflow.window()).toBeVisible({ timeout: 15_000 });
    await dataflow.waitForConnectionsWorkspace();
    await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.resourceLocators(resource).leaf).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.resourceLocators(resource).detail).toBeVisible({ timeout: 15_000 });
  });

  test('DF-AUTH-002 刷新页面后恢复登录态', async ({ page }) => {
    const { home } = await openDataFlowFromDatabaseList(page, { verifyTableData: false });

    await page.reload({ waitUntil: 'load' });
    await expect(page).not.toHaveURL(/\/signin(?:\/|$)/, { timeout: 15_000 });
    await home.enterHomeState();
    await home.openDatabaseViaFolder();
    await expect(home.databaseWindowLocator()).toBeVisible({ timeout: 15_000 });

    const result = await home.openDatabaseManagement({ verifyTableData: false });
    const dataflow = new DataFlowPage(page);

    await dataflow.waitForConnectionsWorkspace();
    await expect(dataflow.byQa('auth.bootstrap.error')).toHaveCount(0, { timeout: 15_000 });
    await expect(dataflow.resourceLocators(result.resource).detail).toBeVisible({ timeout: 15_000 });
  });

  test('DF-AUTH-003 直接访问无凭证 URL 时给出明确错误', async ({ page }) => {
    await page.goto('https://dbprovider.192.168.10.70.nip.io/dbs', { waitUntil: 'load' });

    const jumpDialog = page
      .getByRole('alertdialog', { name: /Jump Notification/i })
      .or(page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: /This application is not allowed to be used alone/i }))
      .first();

    await expect(page).toHaveURL(/dbprovider\.192\.168\.10\.70\.nip\.io\/dbs/i, { timeout: 15_000 });
    await expect(jumpDialog).toBeVisible({ timeout: 15_000 });
    await expect(jumpDialog).toContainText('Jump Notification', { timeout: 15_000 });
    await expect(jumpDialog).toContainText('This application is not allowed to be used alone.', { timeout: 15_000 });
    await expect(jumpDialog).toContainText('Click OK to go to Sealos Desktop for use.', { timeout: 15_000 });
    await expect(jumpDialog.getByRole('button', { name: /Discard/i })).toBeVisible({ timeout: 15_000 });
    await expect(jumpDialog.getByRole('button', { name: /Confirm/i })).toBeVisible({ timeout: 15_000 });
  });

  test('DF-AUTH-004 不支持的数据源类型展示明确错误', async ({ page }) => {
    const unsupportedDatabaseName = 'codex-e2e-unsupported-milvus';
    const unsupportedType = 'milvus';

    await page.route('**/api/getDBList', async (route) => {
      await route.fulfill({
        json: {
          code: 200,
          message: 'Success',
          data: [
            {
              id: 'codex-e2e-unsupported-db',
              name: unsupportedDatabaseName,
              dbType: unsupportedType,
              status: {
                label: '异常',
                value: 'Failed',
                color: '#D92D20',
                backgroundColor: '#FEF3F2',
                dotColor: '#D92D20',
              },
              createTime: '2026/05/28 00:00',
              cpu: 100,
              memory: 128,
              totalCpu: 100,
              totalMemory: 128,
              storage: 1,
              totalStorage: 1,
              replicas: 1,
              conditions: [
                {
                  lastTransitionTime: '2026-05-28T00:00:00Z',
                  message: `不支持的数据源类型: ${unsupportedType}`,
                  reason: 'UnsupportedDataSourceType',
                  status: 'False',
                  type: 'Ready',
                },
              ],
              isDiskSpaceOverflow: false,
              source: {
                hasSource: false,
                sourceName: '',
                sourceType: 'manual',
              },
              remark: 'codex-e2e unsupported datasource mock',
              labels: {
                'clusterdefinition.kubeblocks.io/name': unsupportedType,
                'sealos-db-provider-cr': unsupportedDatabaseName,
              },
            },
          ],
        },
      });
    });

    await loginAndOpenDatabaseList(page);

    const databaseFrame = page.frameLocator('#app-window-system-dbprovider');
    const unsupportedRow = databaseFrame.locator('tbody tr').filter({ hasText: unsupportedDatabaseName }).first();
    const dataManagementButton = unsupportedRow.getByRole('button', { name: /数据管理|Data Management|Manage Data/i });

    await expect(unsupportedRow).toBeVisible({ timeout: 15_000 });
    await expect(unsupportedRow).toContainText(unsupportedType, { timeout: 15_000 });
    await expect(unsupportedRow).toContainText(/异常|Failed|Error/i, { timeout: 15_000 });
    await expect(dataManagementButton).toBeVisible({ timeout: 15_000 });
    await expect(dataManagementButton).toBeDisabled({ timeout: 15_000 });
    await expect(new DataFlowPage(page).window()).toHaveCount(0, { timeout: 3_000 });

    await expectMockScenario(
      'auth',
      'unsupported datasource type error',
      {
        precondition: true,
        realUiEntry: true,
        apiMock: true,
        assertion: true,
        noSideEffect: true,
      },
      {
        module: 'auth-connection',
        testName: 'DF-AUTH-004 不支持的数据源类型展示明确错误',
        dataSource: 'unknown',
        nodeLevel: 'database-list-row',
        nodeText: unsupportedDatabaseName,
        details: 'Mocked unsupported milvus datasource, asserted database error status, disabled management entry, and no DataFlow side effect.',
      },
    );
  });

 
});
