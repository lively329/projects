import { expect, test } from './fixtures.js';
import {
  SQL_ROWS,
  SQL_TABLE_TOOLBAR_INDEX,
  enableNextSqlRowsFilterMock,
  enableNextSqlRowsDelayMock,
  openMockedSqlTable,
  sqlTableRow,
  sqlTableToolbarButton,
} from './helpers/sql-table-detail-flow.js';

test.describe('DataFlow SQL 表详情模块', () => {
  test('DF-SQLTABLE-001 SQL 表头展示列名、PK/FK、类型与排序入口', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);

    await expect(dataflow.getByText('kb_health_check [kubeblocks]', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.getByText('type', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.getByText('INT', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.getByText('PK', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.getByText('check_ts', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.getByText('BIGINT', { exact: true })).toBeVisible({ timeout: 15_000 });

    const checkTsMenu = dataflow.locator('button[aria-haspopup="menu"]').nth(1);
    await expect(checkTsMenu).toBeVisible({ timeout: 15_000 });
    await checkTsMenu.click();
    await expect(dataflow.getByRole('menu')).toContainText('升序 (ASC)', { timeout: 15_000 });
    await expect(dataflow.getByRole('menu')).toContainText('降序 (DESC)', { timeout: 15_000 });
  });

  test('DF-SQLTABLE-002 SQL 单列升序/降序/清除排序', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);

    async function openSortMenu() {
      const checkTsMenu = dataflow.locator('th').filter({ hasText: 'check_ts' }).locator('button[aria-haspopup="menu"]').first();
      await expect(checkTsMenu).toBeVisible({ timeout: 15_000 });
      const sortMenu = dataflow.getByRole('menu');

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await checkTsMenu.click({ force: true });
        if (await sortMenu.isVisible({ timeout: 2_000 }).catch(() => false)) {
          return sortMenu;
        }
        await dataflow.locator('table').click({ position: { x: 10, y: 10 }, force: true }).catch(() => {});
      }

      await expect(sortMenu).toBeVisible({ timeout: 5_000 });
      return sortMenu;
    }

    async function currentOrOpenSortMenu() {
      const sortMenu = dataflow.getByRole('menu');
      if (await sortMenu.isVisible().catch(() => false)) {
        return sortMenu;
      }

      return openSortMenu();
    }

    async function clearSort() {
      const sortMenu = await currentOrOpenSortMenu();
      await expect(sortMenu).toContainText('取消排序', { timeout: 15_000 });
      await sortMenu.getByRole('menuitem', { name: '取消排序' }).click({ force: true });
      await expect(dataflow.getByText('取消排序', { exact: true })).toHaveCount(0, { timeout: 15_000 });
    }

    let sortMenu = await openSortMenu();
    await expect(sortMenu).toContainText('升序 (ASC)', { timeout: 15_000 });
    await expect(sortMenu).toContainText('降序 (DESC)', { timeout: 15_000 });

    await dataflow.getByRole('menuitem', { name: '升序 (ASC)' }).click();
    await clearSort();

    sortMenu = await openSortMenu();
    await dataflow.getByRole('menuitem', { name: '降序 (DESC)' }).click();
    await clearSort();
  });

  test('DF-SQLTABLE-003 SQL 可见列隐藏后展示隐藏提示', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);

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

  test('DF-SQLTABLE-004 SQL 服务端筛选支持完整运算符集合', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);

    await dataflow.getByRole('button', { name: '筛选' }).click();
    const filterDialog = dataflow.getByRole('dialog', { name: '筛选数据表' });
    await expect(filterDialog).toBeVisible({ timeout: 15_000 });

    const operator = filterDialog.getByRole('combobox').nth(1);
    await operator.click();
    const operatorList = dataflow.getByRole('listbox');

    for (const operatorName of ['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IN', 'IS NULL', 'IS NOT NULL']) {
      await expect(operatorList).toContainText(operatorName, { timeout: 15_000 });
    }

    await operatorList.getByRole('option', { name: 'LIKE', exact: true }).click({ force: true });
    await expect(operator.locator('span[data-slot="select-value"]')).toHaveText('LIKE', { timeout: 15_000 });

    const valueInput = filterDialog.getByRole('textbox').last();
    await expect(valueInput).toBeVisible({ timeout: 15_000 });
    await valueInput.fill('1');
    await enableNextSqlRowsFilterMock(page, { field: 'type', operator: 'LIKE', value: '1' });
    await filterDialog.getByRole('button', { name: '应用' }).click();

    await expect(filterDialog).toHaveCount(0, { timeout: 15_000 });
    await expect(dataflow.getByRole('button', { name: /筛选\s*1/ })).toBeVisible({ timeout: 15_000 });
    await expect(sqlTableRow(dataflow, 0)).toContainText('1', { timeout: 15_000 });
    await expect(sqlTableRow(dataflow, 0)).toContainText(String(SQL_ROWS[0].check_ts), { timeout: 15_000 });
    await expect(dataflow.locator('tbody tr')).toHaveCount(1, { timeout: 15_000 });
  });

  test('DF-SQLTABLE-005 SQL 编辑单元格形成本地 changeset dirty 状态', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);

    const firstRow = sqlTableRow(dataflow, 0);
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
    await expect(sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.undo)).toBeEnabled({ timeout: 15_000 });
    await expect(sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.preview)).toBeEnabled({ timeout: 15_000 });
    await expect(sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.submit)).toBeEnabled({ timeout: 15_000 });
  });

  test('DF-SQLTABLE-006 SQL 主键列只读不可编辑', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);

    const firstRow = sqlTableRow(dataflow, 0);
    const primaryKeyCell = firstRow.locator('td').nth(1);
    const originalValue = (await primaryKeyCell.innerText()).trim();

    await primaryKeyCell.dblclick({ force: true });

    await expect(firstRow.locator('input[data-changeset-editor="true"]')).toHaveCount(0, { timeout: 15_000 });
    await expect(primaryKeyCell).toHaveText(originalValue, { timeout: 15_000 });
    await expect(sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.undo)).toBeDisabled({ timeout: 15_000 });
  });

  test('DF-SQLTABLE-007 SQL 新增行以 inserted 状态进入 pending changes', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);
    const insertedType = '99';
    const insertedCheckTs = '1999999999';

    await sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.addRow).click();

    const insertedRow = sqlTableRow(dataflow, 0);
    await expect(insertedRow).toHaveClass(/bg-blue-100\/20/, { timeout: 15_000 });
    const insertedTypeCell = insertedRow.locator('td').nth(1);
    const insertedCheckTsCell = insertedRow.locator('td').nth(2);
    let editor = insertedRow.locator('input[data-changeset-editor="true"]');

    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.fill(insertedType);
    await editor.press('Enter');

    await insertedCheckTsCell.dblclick({ force: true });
    editor = insertedCheckTsCell.locator('input[data-changeset-editor="true"]');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.fill(insertedCheckTs);
    await editor.press('Enter');

    await expect(insertedTypeCell).toHaveText(insertedType, { timeout: 15_000 });
    await expect(insertedCheckTsCell).toHaveText(insertedCheckTs, { timeout: 15_000 });
    await expect(sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.preview)).toBeEnabled({ timeout: 15_000 });
    await expect(sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.submit)).toBeEnabled({ timeout: 15_000 });

    await sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.preview).click();

    const previewDialog = dataflow.getByRole('dialog', { name: '待提交 SQL 预览' });
    await expect(previewDialog).toBeVisible({ timeout: 15_000 });
    await expect(previewDialog).toContainText('共有 1 项待提交更改，SQL 仅用于展示。', { timeout: 15_000 });
    await expect(previewDialog).toContainText('INSERT INTO "kb_health_check"', { timeout: 15_000 });
    await expect(previewDialog).toContainText(insertedType, { timeout: 15_000 });
    await expect(previewDialog).toContainText(insertedCheckTs, { timeout: 15_000 });
  });

  test('DF-SQLTABLE-008 SQL 批量标记删除不立即写库', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);

    const firstRow = sqlTableRow(dataflow, 0);

    await firstRow.locator('td').nth(0).click({ force: true });
    await expect(sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.markDelete)).toBeEnabled({ timeout: 15_000 });
    await sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.markDelete).click();

    await expect(firstRow).toHaveClass(/bg-red-100\/20/, { timeout: 15_000 });
    await expect(firstRow.locator('td').first()).toHaveClass(/line-through/, { timeout: 15_000 });
    await expect(sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.undo)).toBeEnabled({ timeout: 15_000 });
    await expect(sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.preview)).toBeEnabled({ timeout: 15_000 });
  });

  test('DF-SQLTABLE-009 SQL Undo 逐步撤销本地修改', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);

    const firstRow = sqlTableRow(dataflow, 0);
    const checkTsCell = firstRow.locator('td').nth(2);
    const originalValue = (await checkTsCell.innerText()).trim();
    const updatedValue = String(Number(originalValue) + 123);

    await firstRow.locator('td').nth(0).click({ force: true });
    await checkTsCell.dblclick({ force: true });

    const editor = checkTsCell.locator('input[data-changeset-editor="true"]');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.fill(updatedValue);
    await editor.press('Enter');

    await expect(checkTsCell).toHaveText(updatedValue, { timeout: 15_000 });
    await expect(sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.undo)).toBeEnabled({ timeout: 15_000 });
    await sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.undo).click();

    await expect(firstRow.locator('input[data-changeset-editor="true"]')).toHaveCount(0, { timeout: 15_000 });
    await expect(checkTsCell).toHaveText(originalValue, { timeout: 15_000 });
    await expect(checkTsCell).not.toHaveClass(/bg-green-100\/60/, { timeout: 15_000 });
    await expect(sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.undo)).toBeDisabled({ timeout: 15_000 });
  });

  test('DF-SQLTABLE-010 SQL 预览对话框展示将执行 SQL 和摘要', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);

    const firstRow = sqlTableRow(dataflow, 0);
    const firstCheckTsCell = firstRow.locator('td').nth(2);
    const originalCheckTs = (await firstCheckTsCell.innerText()).trim();
    const updatedCheckTs = String(Number(originalCheckTs) + 1000);
    const secondRowOriginalCheckTs = String(SQL_ROWS[1].check_ts);

    await firstRow.locator('td').nth(0).click({ force: true });
    await firstCheckTsCell.dblclick({ force: true });

    const editor = firstCheckTsCell.locator('input[data-changeset-editor="true"]');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.fill(updatedCheckTs);
    await editor.press('Enter');

    await expect(firstCheckTsCell).toHaveText(updatedCheckTs, { timeout: 15_000 });
    await firstRow.locator('td').nth(0).click({ force: true });

    await sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.addRow).click();

    const insertedRow = sqlTableRow(dataflow, 0);
    await expect(insertedRow).toHaveClass(/bg-blue-100\/20/, { timeout: 15_000 });
    await expect(insertedRow.locator('input[data-changeset-editor="true"]')).toBeVisible({ timeout: 15_000 });

    const deleteRow = sqlTableRow(dataflow, 2);
    await deleteRow.locator('td').nth(0).click({ force: true });
    await expect(sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.markDelete)).toBeEnabled({ timeout: 15_000 });
    await sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.markDelete).click();

    await expect(deleteRow).toHaveClass(/bg-red-100\/20/, { timeout: 15_000 });
    await expect(deleteRow.locator('td').first()).toHaveClass(/line-through/, { timeout: 15_000 });

    await sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.preview).click();

    const previewDialog = dataflow.getByRole('dialog', { name: '待提交 SQL 预览' });
    await expect(previewDialog).toBeVisible({ timeout: 15_000 });
    await expect(previewDialog).toContainText('共有 3 项待提交更改，SQL 仅用于展示。', { timeout: 15_000 });
    await expect(previewDialog).toContainText('INSERT INTO', { timeout: 15_000 });
    await expect(previewDialog).toContainText(
      `UPDATE "kb_health_check" SET "check_ts" = '${updatedCheckTs}' WHERE "type" = '1' AND "check_ts" = '${originalCheckTs}';`,
      { timeout: 15_000 },
    );
    await expect(previewDialog).toContainText(
      `DELETE FROM "kb_health_check" WHERE "type" = '7' AND "check_ts" = '${secondRowOriginalCheckTs}';`,
      { timeout: 15_000 },
    );
  });
  

  test('DF-SQLTABLE-011 SQL 提交二次确认与部分失败保留失败项', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);

    const firstRow = sqlTableRow(dataflow, 0);
    const firstCheckTsCell = firstRow.locator('td').nth(2);
    const updatedCheckTs = String(SQL_ROWS[0].check_ts + 2000);

    await firstRow.locator('td').nth(0).click({ force: true });
    await firstCheckTsCell.dblclick({ force: true });

    const editor = firstCheckTsCell.locator('input[data-changeset-editor="true"]');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.fill(updatedCheckTs);
    await editor.press('Enter');

    await sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.addRow).click();

    const insertedRow = sqlTableRow(dataflow, 0);
    await expect(insertedRow.locator('input[data-changeset-editor="true"]')).toBeVisible({ timeout: 15_000 });

    const deleteRow = sqlTableRow(dataflow, 2);
    await deleteRow.locator('td').nth(0).click({ force: true });
    await sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.markDelete).click();

    const submitButton = sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.submit);
    await expect(submitButton).toBeEnabled({ timeout: 15_000 });
    await submitButton.click();

    const dialog = dataflow.getByRole('alertdialog', { name: /要应用\s*3\s*项更改/ });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText('要应用 3 项更改吗？', { timeout: 15_000 });
    await expect(dialog).toContainText('修改 0 行，插入 1 行，删除 2 行。', { timeout: 15_000 });
    await dialog.getByRole('button', { name: '确认' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  });

  test('DF-SQLTABLE-012 SQL 有未提交修改时切换分页/排序/筛选/刷新触发丢弃确认', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);
    const undoButton = sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.undo);
    const previewButton = sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.preview);
    const submitButton = sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.submit);

    async function makeDirtyChange(offset: number) {
      const firstRow = sqlTableRow(dataflow, 0);
      const firstCheckTsCell = firstRow.locator('td').nth(2);
      const originalCheckTs = (await firstCheckTsCell.innerText()).trim();
      const updatedCheckTs = String(Number(originalCheckTs) + offset);

      await firstRow.locator('td').nth(0).click({ force: true });
      await firstCheckTsCell.dblclick({ force: true });

      const editor = firstCheckTsCell.locator('input[data-changeset-editor="true"]');
      await expect(editor).toBeVisible({ timeout: 15_000 });
      await editor.fill(updatedCheckTs);
      await editor.press('Enter');

      await expect(firstCheckTsCell).toHaveText(updatedCheckTs, { timeout: 15_000 });
      await expect(undoButton).toBeEnabled({ timeout: 15_000 });
      await expect(previewButton).toBeEnabled({ timeout: 15_000 });
      await expect(submitButton).toBeEnabled({ timeout: 15_000 });
    }

    async function expectDiscardDialog() {
      const dialog = dataflow
        .getByRole('alertdialog', { name: /要丢弃待提交更改吗/ })
        .or(dataflow.getByRole('dialog').filter({ hasText: /要丢弃待提交更改吗/ }))
        .first();

      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(dialog).toContainText(/你有\s*1\s*项未保存的更改。?要丢弃并继续吗/i, { timeout: 15_000 });
      await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(dialog.getByRole('button', { name: '丢弃', exact: true })).toBeVisible({ timeout: 15_000 });

      return dialog;
    }

    async function closeFilterDialogIfVisible() {
      const filterDialog = dataflow.getByRole('dialog', { name: '筛选数据表' });

      if (await filterDialog.isVisible().catch(() => false)) {
        const cancelButton = filterDialog.getByRole('button', { name: '取消', exact: true });
        if (await cancelButton.isVisible().catch(() => false)) {
          await cancelButton.click();
        } else {
          await page.keyboard.press('Escape');
        }
        await expect(filterDialog).toHaveCount(0, { timeout: 15_000 });
      }
    }

    async function applyFilter() {
      await dataflow.getByRole('button', { name: '筛选' }).click();

      const filterDialog = dataflow.getByRole('dialog', { name: '筛选数据表' });
      await expect(filterDialog).toBeVisible({ timeout: 15_000 });
      await expect(filterDialog).toContainText('筛选数据表', { timeout: 15_000 });
      await expect(filterDialog).toContainText('可见列', { timeout: 15_000 });
      await expect(filterDialog).toContainText('筛选条件', { timeout: 15_000 });
      await filterDialog.getByRole('button', { name: '应用' }).click();
    }

    async function triggerPaginationChange() {
      const nextPageButton = dataflow.getByRole('button', { name: /下一页|next/i }).first();

      if ((await nextPageButton.isVisible().catch(() => false)) && (await nextPageButton.isEnabled().catch(() => false))) {
        await nextPageButton.click();
        return;
      }

      const pageSizeCombobox = dataflow.getByRole('combobox').last();
      await expect(pageSizeCombobox).toBeVisible({ timeout: 15_000 });
      const currentPageSize = (await pageSizeCombobox.innerText().catch(() => '')).trim();
      await pageSizeCombobox.click();

      const targetPageSize = currentPageSize === '10' ? '20' : '10';
      const option = dataflow.getByRole('option', { name: targetPageSize, exact: true }).first();
      await expect(option).toBeVisible({ timeout: 15_000 });
      await option.click();
    }

    await makeDirtyChange(3000);

    await applyFilter();
    let discardDialog = await expectDiscardDialog();
    await discardDialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(discardDialog).toHaveCount(0, { timeout: 15_000 });
    await expect(undoButton).toBeEnabled({ timeout: 15_000 });
    await closeFilterDialogIfVisible();

    await applyFilter();
    discardDialog = await expectDiscardDialog();
    await discardDialog.getByRole('button', { name: '丢弃', exact: true }).click();
    await expect(discardDialog).toHaveCount(0, { timeout: 15_000 });
    await expect(dataflow.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });

    await makeDirtyChange(4000);

    await triggerPaginationChange();
    discardDialog = await expectDiscardDialog();
    await discardDialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(discardDialog).toHaveCount(0, { timeout: 15_000 });
    await expect(undoButton).toBeEnabled({ timeout: 15_000 });

    await triggerPaginationChange();
    discardDialog = await expectDiscardDialog();
    await discardDialog.getByRole('button', { name: '丢弃', exact: true }).click();
    await expect(discardDialog).toHaveCount(0, { timeout: 15_000 });
    await expect(dataflow.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });
  });

  test('DF-SQLTABLE-013 SQL 表详情 toolbar 刷新展示 loading 并保留已有数据', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);
    const tableDetail = dataflow.locator('[data-testid="sql.table.detail"]').or(dataflow.getByRole('main')).first();
    const toolbar = dataflow.locator('[data-testid="sql.table.toolbar"]').or(dataflow.locator('button').locator('xpath=ancestor::*[self::div or self::header][1]')).first();
    const refreshButton = dataflow.locator('[data-testid="sql.table.refresh-button"]').or(sqlTableToolbarButton(dataflow, SQL_TABLE_TOOLBAR_INDEX.refresh)).first();
    const firstRow = sqlTableRow(dataflow, 0);
    const secondRow = sqlTableRow(dataflow, 1);

    await expect(dataflow.getByText('kb_health_check [kubeblocks]', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(tableDetail).toBeVisible({ timeout: 15_000 });
    await expect(toolbar).toBeVisible({ timeout: 15_000 });
    await expect(refreshButton).toBeVisible({ timeout: 15_000 });
    await expect(firstRow).toContainText(String(SQL_ROWS[0].type), { timeout: 15_000 });
    await expect(firstRow).toContainText(String(SQL_ROWS[0].check_ts), { timeout: 15_000 });

    await enableNextSqlRowsDelayMock(page, 600);
    await refreshButton.click();

    await expect(
      tableDetail.locator('[data-qa-state~="loading"], [data-loading="true"], [aria-busy="true"], .animate-spin, [role="progressbar"]').first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(firstRow).toContainText(String(SQL_ROWS[0].check_ts), { timeout: 15_000 });
    await expect(secondRow).toContainText(String(SQL_ROWS[1].check_ts), { timeout: 15_000 });
    await expect(
      tableDetail.locator('[data-qa-state~="loading"], [data-loading="true"], [aria-busy="true"], [role="progressbar"]').first(),
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(firstRow).toContainText(String(SQL_ROWS[0].type), { timeout: 15_000 });
    await expect(firstRow).toContainText(String(SQL_ROWS[0].check_ts), { timeout: 15_000 });
    await expect(secondRow).toContainText(String(SQL_ROWS[1].type), { timeout: 15_000 });
    await expect(secondRow).toContainText(String(SQL_ROWS[1].check_ts), { timeout: 15_000 });
  });

  test('DF-SQLTABLE-014 SQL 表详情导出弹窗支持格式选择并触发导出', async ({ page }) => {
    const { dataflow } = await openMockedSqlTable(page);
    const exportButton = dataflow.locator('[data-testid="sql.table.export-button"]').or(dataflow.getByRole('button', { name: /导出|Export/i })).first();

    await expect(dataflow.getByText('kb_health_check [kubeblocks]', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(exportButton).toBeVisible({ timeout: 15_000 });
    await exportButton.click();

    const exportDialog = dataflow.getByRole('dialog').filter({ hasText: /导出|Export|CSV|JSON|SQL|Excel|XLSX/i }).first();
    await expect(exportDialog).toBeVisible({ timeout: 15_000 });

    for (const formatName of [/CSV/i, /JSON/i, /SQL/i, /Excel|XLSX/i]) {
      await expect(exportDialog).toContainText(formatName, { timeout: 15_000 });
    }

    const csvOption = exportDialog
      .getByRole('radio', { name: /CSV/i })
      .or(exportDialog.getByRole('option', { name: /CSV/i }))
      .or(exportDialog.getByRole('button', { name: /CSV/i }))
      .or(exportDialog.getByText(/CSV/i))
      .first();
    await expect(csvOption).toBeVisible({ timeout: 15_000 });
    await csvOption.click({ force: true });

    const confirmExportButton = exportDialog.getByRole('button', { name: /导出|Export|下载|Download|确认|确定/i }).last();
    await expect(confirmExportButton).toBeVisible({ timeout: 15_000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 }).catch(() => null);
    await confirmExportButton.click();
    await downloadPromise;
    await expect(exportDialog).toContainText(/导出完成|文件已下载|Export complete|downloaded/i, { timeout: 15_000 });
    await exportDialog.getByRole('button', { name: /关闭|Close/i }).first().click();
    await expect(exportDialog).toHaveCount(0, { timeout: 15_000 });
  });

  
});
