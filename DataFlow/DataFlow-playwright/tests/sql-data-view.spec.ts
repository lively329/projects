import { expect, test } from './fixtures.js';
import { SealosHomePage } from '../src/pages/sealos-home.page.js';
import type { FrameLocator, Page } from '@playwright/test';

const PASSWORD = '8f4c75ceb5b1a372f58f64ccefa675df';

type SqlRow = {
  type: number;
  check_ts: number;
};

type GetStorageUnitRowsPayload = {
  operationName?: string;
};

type DbListItem = {
  id: string;
  name: string;
  dbType: string;
  status: {
    label: string;
    value: string;
    color: string;
    backgroundColor: string;
    dotColor: string;
  };
  createTime: string;
  cpu: number;
  memory: number;
  totalCpu: number;
  totalMemory: number;
  storage: number;
  totalStorage: number;
  replicas: number;
  source: {
    hasSource: boolean;
    sourceName: string;
    sourceType: string;
  };
  remark: string;
  labels: Record<string, string>;
};

const SQL_ROWS: SqlRow[] = [
  { type: 1, check_ts: 1779720163 },
  { type: 7, check_ts: 1827937773 },
];

const DB_LIST_ROWS: DbListItem[] = [
  {
    id: '021056ac-a4c8-4f39-bc79-98e6f665a563',
    name: 'coze-studio-ixbuidnp-milvus',
    dbType: 'milvus',
    status: {
      label: 'Running',
      value: 'Running',
      color: '#039855',
      backgroundColor: '#EDFBF3',
      dotColor: '#039855',
    },
    createTime: '2026/05/22 18:16',
    cpu: 900,
    memory: 1408,
    totalCpu: 900,
    totalMemory: 1408,
    storage: 3,
    totalStorage: 3,
    replicas: 1,
    source: {
      hasSource: true,
      sourceName: 'coze-studio-ixbuidnp',
      sourceType: 'app_store',
    },
    remark: '',
    labels: {
      'cloud.sealos.io/deploy-on-sealos': 'coze-studio-ixbuidnp',
      'clusterdefinition.kubeblocks.io/name': 'milvus',
      'clusterversion.kubeblocks.io/name': 'milvus-2.4.5',
      'sealos-db-provider-cr': 'coze-studio-ixbuidnp-milvus',
    },
  },
  {
    id: '8c8e8bc6-77bd-4fb4-b010-a2c1a2c58678',
    name: 'coze-studio-ixbuidnp-mysql',
    dbType: 'apecloud-mysql',
    status: {
      label: 'Running',
      value: 'Running',
      color: '#039855',
      backgroundColor: '#EDFBF3',
      dotColor: '#039855',
    },
    createTime: '2026/05/22 18:16',
    cpu: 300,
    memory: 384,
    totalCpu: 300,
    totalMemory: 384,
    storage: 1,
    totalStorage: 1,
    replicas: 1,
    source: {
      hasSource: true,
      sourceName: 'coze-studio-ixbuidnp',
      sourceType: 'app_store',
    },
    remark: '',
    labels: {
      'cloud.sealos.io/deploy-on-sealos': 'coze-studio-ixbuidnp',
      'clusterdefinition.kubeblocks.io/name': 'apecloud-mysql',
      'clusterversion.kubeblocks.io/name': 'ac-mysql-8.0.30-1',
    },
  },
  {
    id: '6d0d4c84-fbcb-43bf-a0ac-b029bec7be1f',
    name: 'coze-studio-ixbuidnp-redis',
    dbType: 'redis',
    status: {
      label: 'Running',
      value: 'Running',
      color: '#039855',
      backgroundColor: '#EDFBF3',
      dotColor: '#039855',
    },
    createTime: '2026/05/22 18:16',
    cpu: 350,
    memory: 448,
    totalCpu: 350,
    totalMemory: 448,
    storage: 1,
    totalStorage: 1,
    replicas: 1,
    source: {
      hasSource: true,
      sourceName: 'coze-studio-ixbuidnp',
      sourceType: 'app_store',
    },
    remark: '',
    labels: {
      'cloud.sealos.io/deploy-on-sealos': 'coze-studio-ixbuidnp',
      'clusterdefinition.kubeblocks.io/name': 'redis',
      'clusterversion.kubeblocks.io/name': 'redis-7.0.6',
      'sealos-db-provider-cr': 'coze-studio-ixbuidnp-redis',
    },
  },
  {
    id: '36e08a97-2ce4-4ea5-8678-c11a628c674f',
    name: 'test-db-mb',
    dbType: 'mongodb',
    status: {
      label: 'Running',
      value: 'Running',
      color: '#039855',
      backgroundColor: '#EDFBF3',
      dotColor: '#039855',
    },
    createTime: '2026/05/22 14:30',
    cpu: 3000,
    memory: 2048,
    totalCpu: 15000,
    totalMemory: 10240,
    storage: 3,
    totalStorage: 15,
    replicas: 5,
    source: {
      hasSource: false,
      sourceName: '',
      sourceType: 'app_store',
    },
    remark: '',
    labels: {
      'clusterdefinition.kubeblocks.io/name': 'mongodb',
      'clusterversion.kubeblocks.io/name': 'mongodb-6.0',
      'sealos-db-provider-cr': 'test-db-mb',
    },
  },
  {
    id: 'fd4687ca-7c42-4813-8002-23c08096fdb9',
    name: 'xzy-maestro',
    dbType: 'postgresql',
    status: {
      label: 'Running',
      value: 'Running',
      color: '#039855',
      backgroundColor: '#EDFBF3',
      dotColor: '#039855',
    },
    createTime: '2026/05/07 12:12',
    cpu: 2000,
    memory: 4096,
    totalCpu: 2000,
    totalMemory: 4096,
    storage: 3,
    totalStorage: 3,
    replicas: 1,
    source: {
      hasSource: false,
      sourceName: '',
      sourceType: 'app_store',
    },
    remark: '',
    labels: {
      'clusterdefinition.kubeblocks.io/name': 'postgresql',
      'clusterversion.kubeblocks.io/name': 'postgresql-14.8.0',
      'sealos-db-provider-cr': 'xzy-maestro',
    },
  },
];

const SQL_COLUMNS = [
  {
    Type: 'INT',
    Name: 'type',
    IsPrimary: true,
    IsForeignKey: false,
    ReferencedTable: null,
    ReferencedColumn: null,
    Length: null,
    Precision: null,
    Scale: null,
    __typename: 'Column',
  },
  {
    Type: 'BIGINT',
    Name: 'check_ts',
    IsPrimary: false,
    IsForeignKey: false,
    ReferencedTable: null,
    ReferencedColumn: null,
    Length: null,
    Precision: null,
    Scale: null,
    __typename: 'Column',
  },
] as const;

const TOOLBAR_INDEX = {
  addRow: 9,
  markDelete: 10,
  undo: 11,
  preview: 12,
  submit: 13,
} as const;

function sqlTableFrame(page: Page): FrameLocator {
  return page.frameLocator('#app-window-system-dataflow');
}

function dataRow(dataflow: FrameLocator, index: number) {
  return dataflow.locator('tbody tr').nth(index);
}

function toolbarButton(dataflow: FrameLocator, index: number) {
  return dataflow.locator('button').nth(index);
}

async function installSqlRowsMock(page: Page) {
  await page.route('**/api/query', async (route) => {
    let payload: GetStorageUnitRowsPayload | null = null;

    try {
      payload = route.request().postDataJSON() as GetStorageUnitRowsPayload;
    } catch {
      payload = null;
    }

    if (payload?.operationName !== 'GetStorageUnitRows') {
      await route.continue();
      return;
    }

    await route.fulfill({
      json: {
        data: {
          Row: {
            Columns: SQL_COLUMNS,
            Rows: SQL_ROWS.map((row) => [String(row.type), String(row.check_ts)]),
            DisableUpdate: false,
            TotalCount: SQL_ROWS.length,
            __typename: 'RowsResult',
          },
        },
      },
    });
  });
}

async function installDbListMock(page: Page) {
  await page.route('**/api/getDBList', async (route) => {
    await route.fulfill({
      json: {
        code: 200,
        message: 'Success',
        data: DB_LIST_ROWS,
      },
    });
  });
}

async function openSqlTable(page: Page) {
  const home = new SealosHomePage(page);

  await installDbListMock(page);
  await installSqlRowsMock(page);
  await home.goto();
  await home.login('admin', PASSWORD);
  await home.enterHomeState();
  await home.openDatabaseViaFolder();
  await home.openDatabaseManagement({ verifyTableData: false });

  const dataflow = sqlTableFrame(page);
  await expect(dataflow.getByText('kb_health_check [kubeblocks]', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(dataflow.getByText('type', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(dataflow.getByText('check_ts', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(dataflow.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });
  await expect(dataflow.locator('tbody tr').nth(1)).toBeVisible({ timeout: 15_000 });

  return { dataflow };
}

test.describe('Sealos SQL data view', () => {
  test.describe('用例1：SQL 未提交修改以 Changeset 方式展示', () => {
    test('SQL 未提交修改以 Changeset 方式展示', async ({ page }) => {
      const { dataflow } = await openSqlTable(page);

      const firstRow = dataRow(dataflow, 0);
      const firstCheckTsCell = firstRow.locator('td').nth(2);
      const originalCheckTs = (await firstCheckTsCell.innerText()).trim();
      const updatedCheckTs = String(Number(originalCheckTs) + 1000);

      await firstRow.locator('td').nth(0).click({ force: true });
      await firstCheckTsCell.dblclick({ force: true });

      const editor = firstCheckTsCell.locator('input[data-changeset-editor="true"]');
      await expect(editor).toBeVisible({ timeout: 15_000 });
      await editor.fill(updatedCheckTs);
      await editor.press('Enter');
      await expect(firstCheckTsCell).toHaveText(updatedCheckTs, { timeout: 15_000 });
      await expect(firstCheckTsCell).toHaveClass(/bg-green-100\/60/, { timeout: 15_000 });

      await toolbarButton(dataflow, TOOLBAR_INDEX.addRow).click();

      const insertedRow = dataRow(dataflow, 0);
      await expect(insertedRow).toHaveClass(/bg-blue-100\/20/, { timeout: 15_000 });
      await expect(insertedRow.locator('input[data-changeset-editor="true"]')).toBeVisible({ timeout: 15_000 });

      const deleteRow = dataRow(dataflow, 2);
      await deleteRow.locator('td').nth(0).click({ force: true });
      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.markDelete)).toBeEnabled({ timeout: 15_000 });
      await toolbarButton(dataflow, TOOLBAR_INDEX.markDelete).click();

      await expect(deleteRow).toHaveClass(/bg-red-100\/20/, { timeout: 15_000 });
      await expect(deleteRow.locator('td').first()).toHaveClass(/line-through/, { timeout: 15_000 });

      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.undo)).toBeEnabled({ timeout: 15_000 });
      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.preview)).toBeEnabled({ timeout: 15_000 });
      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.submit)).toBeEnabled({ timeout: 15_000 });

      await toolbarButton(dataflow, TOOLBAR_INDEX.preview).click();
      const previewDialog = dataflow.getByRole('dialog', { name: '待提交 SQL 预览' });

      await expect(previewDialog).toBeVisible({ timeout: 15_000 });
      await expect(previewDialog).toContainText('共有 3 项待提交更改', { timeout: 15_000 });
      await expect(previewDialog).toContainText('INSERT INTO', { timeout: 15_000 });
      await expect(previewDialog).toContainText('DELETE FROM', { timeout: 15_000 });
    });
  });

  test.describe('用例2：SQL 主键列只读', () => {
    test('SQL 主键列只读', async ({ page }) => {
      const { dataflow } = await openSqlTable(page);

      const firstRow = dataRow(dataflow, 0);
      const primaryKeyCell = firstRow.locator('td').nth(1);
      const originalValue = (await primaryKeyCell.innerText()).trim();

      await primaryKeyCell.dblclick({ force: true });

      await expect(firstRow.locator('input[data-changeset-editor="true"]')).toHaveCount(0, { timeout: 15_000 });
      await expect(primaryKeyCell).toHaveText(originalValue, { timeout: 15_000 });
      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.undo)).toBeDisabled({ timeout: 15_000 });
    });
  });

  test.describe('用例3：SQL Undo 撤销本地修改', () => {
    test('SQL Undo 撤销本地修改', async ({ page }) => {
      const { dataflow } = await openSqlTable(page);

      const firstRow = dataRow(dataflow, 0);
      const checkTsCell = firstRow.locator('td').nth(2);
      const originalValue = (await checkTsCell.innerText()).trim();
      const updatedValue = String(Number(originalValue) + 123);

      await firstRow.locator('td').nth(0).click({ force: true });
      await checkTsCell.dblclick({ force: true });

      const editor = checkTsCell.locator('input[data-changeset-editor="true"]');
      await expect(editor).toBeVisible({ timeout: 15_000 });
      await editor.fill(updatedValue);
      await expect(editor).toHaveValue(updatedValue, { timeout: 15_000 });

      await editor.press('Enter');
      await expect(checkTsCell).toHaveText(updatedValue, { timeout: 15_000 });
      await expect(checkTsCell).toHaveClass(/bg-green-100\/60/, { timeout: 15_000 });
      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.undo)).toBeEnabled({ timeout: 15_000 });
      await toolbarButton(dataflow, TOOLBAR_INDEX.undo).click();

      await expect(firstRow.locator('input[data-changeset-editor="true"]')).toHaveCount(0, { timeout: 15_000 });
      await expect(checkTsCell).toHaveText(originalValue, { timeout: 15_000 });
      await expect(checkTsCell).not.toHaveClass(/bg-green-100\/60/, { timeout: 15_000 });
      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.undo)).toBeDisabled({ timeout: 15_000 });
    });
  });

  test.describe('用例4：SQL 批量标记删除', () => {
    test('SQL 批量标记删除', async ({ page }) => {
      const { dataflow } = await openSqlTable(page);

      const firstRow = dataRow(dataflow, 0);

      await firstRow.locator('td').nth(0).click({ force: true });
      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.markDelete)).toBeEnabled({ timeout: 15_000 });

      await toolbarButton(dataflow, TOOLBAR_INDEX.markDelete).click();

      await expect(firstRow).toHaveClass(/bg-red-100\/20/, { timeout: 15_000 });
      await expect(firstRow.locator('td').first()).toHaveClass(/line-through/, { timeout: 15_000 });
      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.undo)).toBeEnabled({ timeout: 15_000 });
      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.preview)).toBeEnabled({ timeout: 15_000 });
    });
  });

  test.describe('用例5：SQL 排序切换与清除排序', () => {
    test('SQL 排序切换与清除排序', async ({ page }) => {
      const { dataflow } = await openSqlTable(page);

      const checkTsMenu = dataflow.locator('button[aria-haspopup="menu"]').nth(1);
      await checkTsMenu.click();

      const sortMenu = dataflow.getByRole('menu');
      await expect(sortMenu).toContainText('升序 (ASC)', { timeout: 15_000 });
      await expect(sortMenu).toContainText('降序 (DESC)', { timeout: 15_000 });

      await dataflow.getByRole('menuitem', { name: '升序 (ASC)' }).click();
      await expect(dataflow.getByText('kb_health_check [kubeblocks]', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(dataflow.getByText('取消排序', { exact: true })).toBeVisible({ timeout: 15_000 });

      await dataflow.getByText('取消排序', { exact: true }).click({ force: true });
      await expect(dataflow.getByText('取消排序', { exact: true })).toHaveCount(0, { timeout: 15_000 });
    });
  });

  test.describe('用例6：SQL 列隐藏后提示列已隐藏', () => {
    test('SQL 列隐藏后提示列已隐藏', async ({ page }) => {
      const { dataflow } = await openSqlTable(page);

      await dataflow.getByRole('button', { name: '筛选' }).click();
      const filterDialog = dataflow.getByRole('dialog', { name: '筛选数据表' });

      await expect(filterDialog).toBeVisible({ timeout: 15_000 });
      await expect(filterDialog).toContainText('可见列', { timeout: 15_000 });
      await expect(filterDialog).toContainText('type', { timeout: 15_000 });
      await expect(filterDialog).toContainText('check_ts', { timeout: 15_000 });

      const checkTsVisibilityRow = filterDialog.locator('span[title="check_ts"]').locator('xpath=..');
      await checkTsVisibilityRow.click();
      await expect(filterDialog.getByRole('checkbox').nth(1)).toHaveAttribute('aria-checked', 'false', { timeout: 15_000 });
      await filterDialog.getByRole('button', { name: '应用' }).click();

      await expect(dataflow.getByText('check_ts', { exact: true })).toHaveCount(0, { timeout: 15_000 });
    });
  });

  test.describe('用例7：SQL 多条件筛选可独立删除单条条件', () => {
    test('SQL 多条件筛选可独立删除单条条件', async ({ page }) => {
      const { dataflow } = await openSqlTable(page);

      await dataflow.getByRole('button', { name: '筛选' }).click();
      const filterDialog = dataflow.getByRole('dialog', { name: '筛选数据表' });

      await expect(filterDialog).toBeVisible({ timeout: 15_000 });
      await filterDialog.getByRole('button', { name: '添加条件' }).click();

      await expect(filterDialog).toContainText('type', { timeout: 15_000 });
      await expect(filterDialog).toContainText('=', { timeout: 15_000 });

      const operator = filterDialog.getByRole('combobox').nth(1);
      await operator.click();
      const operatorList = dataflow.getByRole('listbox');
      await expect(operatorList).toContainText('LIKE', { timeout: 15_000 });
      await expect(operatorList).toContainText('NOT LIKE', { timeout: 15_000 });
      await expect(operatorList).toContainText('IN', { timeout: 15_000 });

      await operatorList.getByRole('option', { name: 'NOT LIKE' }).click();
      await expect(operator.locator('span[data-slot="select-value"]')).toHaveText('NOT LIKE', { timeout: 15_000 });

      await filterDialog.getByRole('button', { name: '应用' }).click();
      await expect(dataflow.getByText('kb_health_check [kubeblocks]', { exact: true })).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('用例8：SQL 运算符下拉可正确选择并生效', () => {
    test('SQL 运算符下拉可正确选择并生效', async ({ page }) => {
      const { dataflow } = await openSqlTable(page);

      await dataflow.getByRole('button', { name: '筛选' }).click();
      const filterDialog = dataflow.getByRole('dialog', { name: '筛选数据表' });
      await expect(filterDialog).toBeVisible({ timeout: 15_000 });

      const operator = filterDialog.getByRole('combobox').nth(1);
      await operator.click();
      const operatorList = dataflow.getByRole('listbox');
      await expect(operatorList).toContainText('=', { timeout: 15_000 });
      await expect(operatorList).toContainText('!=', { timeout: 15_000 });
      await expect(operatorList).toContainText('>', { timeout: 15_000 });
      await expect(operatorList).toContainText('>=', { timeout: 15_000 });
      await expect(operatorList).toContainText('LIKE', { timeout: 15_000 });
      await expect(operatorList).toContainText('IS NULL', { timeout: 15_000 });

      await operatorList.getByRole('option', { name: 'IS NOT NULL' }).click({ force: true });
      await expect(operator.locator('span[data-slot="select-value"]')).toHaveText('IS NOT NULL', { timeout: 15_000 });
    });
  });

  test.describe('用例9：SQL 预览对话框展示待执行 SQL', () => {
    test('SQL 预览对话框展示待执行 SQL', async ({ page }) => {
      const { dataflow } = await openSqlTable(page);

      const firstRow = dataRow(dataflow, 0);
      const firstCheckTsCell = firstRow.locator('td').nth(2);
      const originalCheckTs = (await firstCheckTsCell.innerText()).trim();
      const updatedCheckTs = String(Number(originalCheckTs) + 1000);

      await firstRow.locator('td').nth(0).click({ force: true });
      await firstCheckTsCell.dblclick({ force: true });

      const editor = firstCheckTsCell.locator('input[data-changeset-editor="true"]');
      await expect(editor).toBeVisible({ timeout: 15_000 });
      await editor.fill(updatedCheckTs);
      await editor.press('Enter');

      await toolbarButton(dataflow, TOOLBAR_INDEX.preview).click();

      const previewDialog = dataflow.getByRole('dialog', { name: '待提交 SQL 预览' });
      await expect(previewDialog).toBeVisible({ timeout: 15_000 });
      await expect(previewDialog).toContainText('共有 1 项待提交更改，SQL 仅用于展示。', { timeout: 15_000 });
      await expect(previewDialog).toContainText(
        `UPDATE "kb_health_check" SET "check_ts" = '${updatedCheckTs}' WHERE "type" = '1' AND "check_ts" = '${originalCheckTs}';`,
        { timeout: 15_000 },
      );
      await previewDialog.getByRole('button', { name: '关闭' }).click();
      await expect(previewDialog).toBeHidden({ timeout: 15_000 });

      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.undo)).toBeEnabled({ timeout: 15_000 });
      await toolbarButton(dataflow, TOOLBAR_INDEX.undo).click();
      await expect(firstCheckTsCell).toHaveText(originalCheckTs, { timeout: 15_000 });

      await toolbarButton(dataflow, TOOLBAR_INDEX.addRow).click();

      const insertedRow = dataRow(dataflow, 0);
      await expect(insertedRow).toHaveClass(/bg-blue-100\/20/, { timeout: 15_000 });
      await expect(insertedRow.locator('input[data-changeset-editor="true"]')).toBeVisible({ timeout: 15_000 });

      const deleteRow = dataRow(dataflow, 2);
      await deleteRow.locator('td').nth(0).click({ force: true });
      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.markDelete)).toBeEnabled({ timeout: 15_000 });
      await toolbarButton(dataflow, TOOLBAR_INDEX.markDelete).click();

      await expect(deleteRow).toHaveClass(/bg-red-100\/20/, { timeout: 15_000 });
      await expect(deleteRow.locator('td').first()).toHaveClass(/line-through/, { timeout: 15_000 });

      await toolbarButton(dataflow, TOOLBAR_INDEX.preview).click();
      await expect(previewDialog).toBeVisible({ timeout: 15_000 });
      await expect(previewDialog).toContainText('共有 3 项待提交更改，SQL 仅用于展示。', { timeout: 15_000 });
      await expect(previewDialog).toContainText('INSERT INTO', { timeout: 15_000 });
      await expect(previewDialog).toContainText('DELETE FROM', { timeout: 15_000 });
      await expect(previewDialog).toContainText(
        `DELETE FROM "kb_health_check" WHERE "type" = '1' AND "check_ts" = '${originalCheckTs}';`,
        { timeout: 15_000 },
      );
      await expect(previewDialog).toContainText(
        `DELETE FROM "kb_health_check" WHERE "type" = '7' AND "check_ts" = '1827937773';`,
        { timeout: 15_000 },
      );
    });
  });

  test.describe('用例10：SQL 提交后部分失败保留失败项', () => {
    test('SQL 提交后部分失败保留失败项', async ({ page }) => {
      const { dataflow } = await openSqlTable(page);

      const firstRow = dataRow(dataflow, 0);
      const firstCheckTsCell = firstRow.locator('td').nth(2);
      const originalCheckTs = (await firstCheckTsCell.innerText()).trim();
      const updatedCheckTs = String(Number(originalCheckTs) + 2000);

      await firstRow.locator('td').nth(0).click({ force: true });
      await firstCheckTsCell.dblclick({ force: true });

      const editor = firstCheckTsCell.locator('input[data-changeset-editor="true"]');
      await expect(editor).toBeVisible({ timeout: 15_000 });
      await editor.fill(updatedCheckTs);
      await editor.press('Enter');

      await toolbarButton(dataflow, TOOLBAR_INDEX.addRow).click();

      const insertedRow = dataRow(dataflow, 0);
      await expect(insertedRow.locator('input[data-changeset-editor="true"]')).toBeVisible({ timeout: 15_000 });

      const deleteRow = dataRow(dataflow, 2);
      await deleteRow.locator('td').nth(0).click({ force: true });
      await toolbarButton(dataflow, TOOLBAR_INDEX.markDelete).click();

      const submitButton = toolbarButton(dataflow, TOOLBAR_INDEX.submit);
      await expect(submitButton).toBeEnabled({ timeout: 15_000 });

      await submitButton.click();

      const dialog = dataflow.getByRole('alertdialog', { name: /要应用\s*3\s*项更改/ });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(dialog).toContainText('要应用 3 项更改吗？', { timeout: 15_000 });
      await expect(dialog).toContainText('修改 0 行，插入 1 行，删除 2 行。', { timeout: 15_000 });
      await dialog.getByRole('button', { name: '确认' }).click();
      await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    });
  });

  test.describe('用例11：SQL 有未提交修改时触发丢弃确认', () => {
    test('SQL 有未提交修改时触发丢弃确认', async ({ page }) => {
      const { dataflow } = await openSqlTable(page);

      const firstRow = dataRow(dataflow, 0);
      const firstCheckTsCell = firstRow.locator('td').nth(2);
      const originalCheckTs = (await firstCheckTsCell.innerText()).trim();
      const updatedCheckTs = String(Number(originalCheckTs) + 3000);

      await firstRow.locator('td').nth(0).click({ force: true });
      await firstCheckTsCell.dblclick({ force: true });

      const editor = firstCheckTsCell.locator('input[data-changeset-editor="true"]');
      await expect(editor).toBeVisible({ timeout: 15_000 });
      await editor.fill(updatedCheckTs);
      await editor.press('Enter');

      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.undo)).toBeEnabled({ timeout: 15_000 });

      await dataflow.getByRole('button', { name: '筛选' }).click();

      const filterDialog = dataflow.getByRole('dialog', { name: '筛选数据表' });
      await expect(filterDialog).toBeVisible({ timeout: 15_000 });
      await expect(filterDialog).toContainText('筛选数据表', { timeout: 15_000 });
      await expect(filterDialog).toContainText('可见列', { timeout: 15_000 });
      await expect(filterDialog).toContainText('筛选条件', { timeout: 15_000 });
      await filterDialog.getByRole('button', { name: '取消', exact: true }).click();

      await expect(toolbarButton(dataflow, TOOLBAR_INDEX.undo)).toBeEnabled({ timeout: 15_000 });
    });
  });
});
