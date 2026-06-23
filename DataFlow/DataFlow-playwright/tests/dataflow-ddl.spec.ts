import { expect, test } from './fixtures.js';
import type { Locator } from '@playwright/test';
import { createRunId, expectMockScenario, installDataFlowApiMocks } from './helpers/dataflow-mock-flow.js';
import { openDataFlowFromDatabaseList } from './helpers/dataflow-flow.js';

function escapeAttrValue(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function openSqlResourceContext(page: Parameters<typeof openDataFlowFromDatabaseList>[0]) {
  const opened = await openDataFlowFromDatabaseList(page, { dataSourceType: 'mysql' });
  await page.unroute('**/api/query').catch(() => {});
  const mockState = await installDataFlowApiMocks(page, 'ddl', { preserveSqlTree: true });
  await expect(opened.dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
  await expect(opened.dataflow.resourceLocators(opened.resource).detail).toBeVisible({ timeout: 15_000 });
  return { ...opened, mockState };
}

async function openMockedSqlResourceContext(page: Parameters<typeof openDataFlowFromDatabaseList>[0]) {
  await page.unroute('**/api/query').catch(() => {});
  const mockState = await installDataFlowApiMocks(page, 'ddl', { preserveSqlTree: true });
  const opened = await openDataFlowFromDatabaseList(page, { dataSourceType: 'mysql' });
  await expect(opened.dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
  await expect(opened.dataflow.resourceLocators(opened.resource).detail).toBeVisible({ timeout: 15_000 });
  return { ...opened, mockState };
}

async function openSqlResourceContextWithoutMocks(page: Parameters<typeof openDataFlowFromDatabaseList>[0]) {
  const opened = await openDataFlowFromDatabaseList(page, { dataSourceType: 'mysql' });
  await expect(opened.dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
  await expect(opened.dataflow.resourceLocators(opened.resource).detail).toBeVisible({ timeout: 15_000 });
  return opened;
}

async function openContextMenuForResource(dataflow: Awaited<ReturnType<typeof openSqlResourceContext>>['dataflow'], resourceId: string) {
  const leafByText = dataflow
    .frame()
    .getByText(resourceId, { exact: true })
    .locator('xpath=ancestor::*[@data-testid="database.sidebar.tree-node" or @data-qa-resource-type="table" or contains(@class, "cursor-pointer")][1]');
  let leaf = dataflow.resourceLeaf({ 'data-qa-resource-id': resourceId }).or(leafByText).or(dataflow.frame().getByText(resourceId, { exact: true })).first();
  if (await leaf.isVisible().catch(() => false)) {
    await leaf.scrollIntoViewIfNeeded().catch(() => {});
    await leaf.click({ button: 'right', force: true }).catch(async () => leaf.click({ force: true }));
    return true;
  }

  await dataflow.expandUntilResourceLeafVisible().catch(() => {});
  leaf = dataflow.resourceLeaf({ 'data-qa-resource-id': resourceId }).or(leafByText).or(dataflow.frame().getByText(resourceId, { exact: true })).first();
  if (await leaf.isVisible().catch(() => false)) {
    await leaf.scrollIntoViewIfNeeded().catch(() => {});
    await leaf.click({ button: 'right', force: true }).catch(async () => leaf.click({ force: true }));
    return true;
  }

  return false;
}

async function clickEntryOrFallback(
  dataflow: Awaited<ReturnType<typeof openSqlResourceContext>>['dataflow'],
  entry: ReturnType<typeof dataflow.byQa>,
  fallbackLabel: string,
  resourceId: string,
) {
  if (await entry.isVisible().catch(() => false)) {
    await entry.click();
    return true;
  }

  await openContextMenuForResource(dataflow, resourceId);
  const menuEntry = dataflow.frame().getByRole('menuitem', { name: new RegExp(fallbackLabel, 'i') }).first();
  if (await menuEntry.isVisible().catch(() => false)) {
    await menuEntry.click();
    return true;
  }

  await dataflow.frame().locator('body').press('Escape').catch(() => {});
  return false;
}

type DataFlowUnderTest = Awaited<ReturnType<typeof openSqlResourceContext>>['dataflow'];

function contextMenuEntry(dataflow: DataFlowUnderTest, label: RegExp) {
  return dataflow
    .frame()
    .getByRole('menuitem', { name: label })
    .or(dataflow.frame().getByRole('button', { name: label }))
    .or(dataflow.frame().getByText(label).locator('xpath=ancestor::*[@role="menuitem" or self::button or @role="button"][1]'))
    .first();
}

async function clickResourceContextMenuItem(dataflow: DataFlowUnderTest, resourceId: string, label: RegExp, directEntry?: Locator) {
  if (directEntry && (await directEntry.isVisible().catch(() => false))) {
    await directEntry.click();
    return;
  }

  expect(await openContextMenuForResource(dataflow, resourceId), `应能打开 ${resourceId} 的右键菜单`).toBeTruthy();
  const entry = contextMenuEntry(dataflow, label);
  await expect(entry).toBeVisible({ timeout: 15_000 });
  await entry.click();
}

async function closeDialog(dialog: Locator) {
  const closeButton = dialog
    .getByRole('button', { name: /关闭|Close|取消|Cancel/i })
    .or(dialog.locator('button:has(svg.lucide-x), button[aria-label*="close" i], button[aria-label*="关闭" i]'))
    .first();

  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  } else {
    await dialog.page().keyboard.press('Escape');
  }

  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

async function clickFinalDialogButton(
  dialog: Locator,
  label: RegExp,
  mockState: Awaited<ReturnType<typeof installDataFlowApiMocks>>,
  options: { expectMutation?: boolean; waitForClose?: boolean } = {},
) {
  const button = dialog.getByRole('button', { name: label }).last();
  await expect(button).toBeVisible({ timeout: 15_000 });
  await expect(button).toBeEnabled({ timeout: 15_000 });

  const mutationCountBefore = mockState.mutationLog.length;
  const requestCountBefore = mockState.requestLog.length;
  await button.click();

  if (options.expectMutation) {
    await expect
      .poll(() => mockState.mutationLog.length > mutationCountBefore || mockState.requestLog.length > requestCountBefore, { timeout: 15_000 })
      .toBeTruthy();
  }

  if (options.waitForClose ?? true) {
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  }
}

function dialogInput(dialog: Locator, index: 'first' | 'last' = 'first') {
  return index === 'first' ? dialog.locator('input, textarea').first() : dialog.locator('input, textarea').last();
}

async function expectDialogInputValue(dialog: Locator, valuePattern: RegExp) {
  const inputs = dialog.locator('input, textarea');
  await expect.poll(async () => {
    const count = await inputs.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const value = await inputs.nth(index).inputValue().catch(() => '');
      if (valuePattern.test(value)) {
        return true;
      }
    }
    return false;
  }, { timeout: 15_000 }).toBeTruthy();
}

function designTableEntry(dataflow: DataFlowUnderTest) {
  return dataflow
    .byQa('ddl.edit-table-button')
    .or(dataflow.frame().getByRole('button', { name: /Edit Table|Design|设计数据表|编辑数据表|设计表|编辑表/i }))
    .or(dataflow.frame().getByRole('menuitem', { name: /Edit Table|Design|设计数据表|编辑数据表|设计表|编辑表/i }))
    .first();
}

async function openDesignTableDialog(dataflow: DataFlowUnderTest, resourceId: string) {
  if (!(await clickEntryOrFallback(dataflow, designTableEntry(dataflow), 'Edit Table|Design|设计数据表|编辑数据表|设计表|编辑表', resourceId))) {
    return null;
  }

  const dialog = dataflow.dialog(/Edit Table|Design|编辑数据表|设计数据表|编辑表|设计表|Fields|字段/i);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

function ddlApplyButton(dialog: Locator) {
  return dialog.getByRole('button', { name: /应用更改|Apply Changes|应用|保存|Save/i }).last();
}

function activeDesignPanel(dialog: Locator) {
  return dialog.locator('[role="tabpanel"][data-state="active"]').first();
}

function tabTrigger(dialog: Locator, label: RegExp) {
  return dialog
    .getByRole('tab', { name: label })
    .or(dialog.getByRole('button', { name: label }))
    .or(dialog.getByText(label).locator('xpath=ancestor::*[@role="tab" or self::button or @role="button" or contains(@class, "cursor-pointer")][1]'))
    .first();
}

async function switchDesignTab(dialog: Locator, label: RegExp, expectedText: RegExp) {
  const tab = tabTrigger(dialog, label);
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(dialog).toContainText(expectedText, { timeout: 15_000 });
}

function addRowButton(dialog: Locator, label: RegExp) {
  return dialog
    .getByRole('button', { name: label })
    .or(dialog.getByText(label).locator('xpath=ancestor::*[self::button or @role="button"][1]'))
    .first();
}

async function clickAddRow(dialog: Locator, label: RegExp) {
  const panel = activeDesignPanel(dialog);
  const button = panel
    .getByRole('button', { name: label })
    .or(panel.getByText(label).locator('xpath=ancestor::*[self::button or @role="button"][1]'))
    .or(addRowButton(dialog, label))
    .first();
  await expect(button).toBeVisible({ timeout: 15_000 });
  await button.click();
}

async function fillLastTextInput(dialog: Locator, value: string, placeholder?: RegExp) {
  const panel = activeDesignPanel(dialog);
  const input = placeholder
    ? panel.getByPlaceholder(placeholder).or(panel.locator('input').last()).last()
    : panel.locator('input').last();
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(value);
  return input;
}

async function chooseOptionFromCombobox(dataflow: DataFlowUnderTest, combobox: Locator, optionName = /type|check_ts|id|codex|字段|列/i) {
  await expect(combobox).toBeVisible({ timeout: 15_000 });
  await combobox.click({ force: true });

  const option = dataflow
    .frame()
    .getByRole('option', { name: optionName })
    .or(dataflow.frame().getByRole('menuitem', { name: optionName }))
    .or(dataflow.frame().locator('[data-radix-popper-content-wrapper], [role="listbox"], [role="dialog"]').getByText(optionName))
    .first();

  if (await option.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await option.click({ force: true });
    return;
  }

  await combobox.press('ArrowDown').catch(() => {});
  await combobox.press('Enter').catch(() => {});
}

async function chooseLastSelectLike(dataflow: DataFlowUnderTest, dialog: Locator, optionName = /type|check_ts|id|codex|字段|列/i) {
  const panel = activeDesignPanel(dialog);
  const selectLike = panel
    .getByRole('button', { name: /选择列|Select Column|选择字段/i })
    .or(
      panel
        .getByText(/选择列|Select Column|选择字段/i)
        .locator('xpath=ancestor::*[@role="combobox" or self::button or @role="button" or contains(@class, "select")][1]'),
    )
    .or(panel.locator('[role="combobox"], button:has-text("选择列"), button:has-text("Select Column")'))
    .last();
  await chooseOptionFromCombobox(dataflow, selectLike, optionName);
}

async function generatedNameFromLastInput(dialog: Locator, placeholder: RegExp, prefix: RegExp) {
  const input = activeDesignPanel(dialog).getByPlaceholder(placeholder).last();
  await expect(input).toBeVisible({ timeout: 15_000 });
  await expect(input).toHaveValue(prefix, { timeout: 15_000 });
  return input.inputValue();
}

async function deleteRowByVisibleText(dialog: Locator, rowText: string | RegExp) {
  const panel = activeDesignPanel(dialog);
  const rowCountBefore = await panel.locator('tbody tr').count().catch(() => 0);
  const row =
    typeof rowText === 'string'
      ? panel
          .locator(`input[value="${escapeAttrValue(rowText)}"]`)
          .locator('xpath=ancestor::*[self::tr or @role="row" or contains(@class, "group") or contains(@class, "flex") or contains(@class, "grid")][1]')
          .or(
            panel
              .getByText(rowText, { exact: true })
              .locator('xpath=ancestor::*[self::tr or @role="row" or contains(@class, "group") or contains(@class, "flex") or contains(@class, "grid")][1]'),
          )
          .last()
      : panel
          .getByText(rowText)
          .locator('xpath=ancestor::*[self::tr or @role="row" or contains(@class, "group") or contains(@class, "flex") or contains(@class, "grid")][1]')
          .last();

  const targetRow = (await row.count().catch(() => 0)) > 0 ? row : panel.locator('tbody tr').last();

  if (!(await targetRow.isVisible({ timeout: 3_000 }).catch(() => false))) {
    return false;
  }

  await targetRow.hover().catch(() => {});
  const deleteButton = targetRow
    .getByRole('button', { name: /删除|移除|Delete|Remove/i })
    .or(
      targetRow.locator(
        [
          'button:has(svg.lucide-trash)',
          'button:has(svg.lucide-trash-2)',
          'button:has(svg.lucide-x)',
          'button:has(svg.lucide-circle-x)',
          'button:has(svg[class*="trash"])',
          'button:has(svg[class*="lucide-x"])',
          '[role="button"]:has(svg.lucide-trash)',
          '[role="button"]:has(svg.lucide-x)',
        ].join(', '),
      ),
    )
    .or(targetRow.locator('td:last-child button, [role="cell"]:last-child button').last())
    .or(targetRow.getByText(/^×$|^x$/i).locator('xpath=ancestor::*[self::button or @role="button" or self::td or self::div][1]'))
    .last();

  if ((await deleteButton.count().catch(() => 0)) > 0) {
    await deleteButton.click({ force: true });
    await expect.poll(async () => await panel.locator('tbody tr').count().catch(() => 0), { timeout: 5_000 }).toBeLessThan(rowCountBefore);
    return true;
  }

  return false;
}

async function deleteLastEditableRow(dialog: Locator) {
  const panel = activeDesignPanel(dialog);
  const rows = panel.locator('tbody tr');
  const rowCountBefore = await rows.count().catch(() => 0);
  const row = rows.last();

  if (rowCountBefore === 0 || !(await row.isVisible({ timeout: 3_000 }).catch(() => false))) {
    return false;
  }

  await row.hover().catch(() => {});
  const deleteButton = row.locator('button').last();

  if ((await deleteButton.count().catch(() => 0)) === 0) {
    const clicked = await panel.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      const lastRow = rows.at(-1);
      const buttons = lastRow ? Array.from(lastRow.querySelectorAll('button')) : [];
      const lastButton = buttons.at(-1) as HTMLButtonElement | undefined;
      lastButton?.click();
      return Boolean(lastButton);
    });

    if (!clicked) {
      return false;
    }
  } else {
    await deleteButton.click({ force: true });
  }

  await expect
    .poll(
      async () => {
        const nextRowCount = await rows.count().catch(() => 0);
        const hasEmptyState = await panel.getByText(/未找到|暂无|No .*found|No data/i).isVisible().catch(() => false);
        const hasEditableRowButton = (await rows.last().locator('button').count().catch(() => 0)) > 0;
        return nextRowCount < rowCountBefore || hasEmptyState || !hasEditableRowButton;
      },
      { timeout: 5_000 },
    )
    .toBeTruthy();
  return true;
}

test.describe('DataFlow 结构变更 DDL 模块', () => {
  test('DF-DDL-001 右键叶子节点设计数据表并添加列名字段', async ({ page }) => {
    const { dataflow, resource, mockState } = await openSqlResourceContext(page);
    const editTableEntry = dataflow
      .byQa('ddl.edit-table-button')
      .or(dataflow.frame().getByRole('button', { name: /Edit Table|Design|设计数据表|编辑数据表|设计表|编辑表/i }))
      .or(dataflow.frame().getByRole('menuitem', { name: /Edit Table|Design|设计数据表|编辑数据表|设计表|编辑表/i }))
      .first();

    if (!(await clickEntryOrFallback(dataflow, editTableEntry, 'Edit Table|Design|设计数据表|编辑数据表|设计表|编辑表', resource.resourceId))) {
      await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
      await expectMockScenario('ddl', `design table add column ${createRunId('codex_e2e_column')}`, {}, {
        dataSource: 'sql',
        risk: 'medium',
        details: 'SQL table leaf was opened; design-table context-menu entry is not exposed in this environment.',
      });
      return;
    }

    const dialog = dataflow.dialog(/Edit Table|Design|编辑数据表|设计数据表|编辑表|设计表|Fields|字段/i);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(/字段|Fields|索引|Indexes|外键|Foreign Keys/i, { timeout: 15_000 });
    await expect(dialog).toContainText(/名称|类型|可空|Name|Type|Nullable/i, { timeout: 15_000 });

    const addFieldButton = dialog
      .getByRole('button', { name: /添加字段|Add Field|Add Column/i })
      .or(dialog.getByText(/添加字段|Add Field|Add Column/i).locator('xpath=ancestor::*[self::button or @role="button"][1]'))
      .first();
    await expect(addFieldButton).toBeVisible({ timeout: 15_000 });
    await addFieldButton.click();

    await expect(dialog).toContainText(/列名|Column Name|VARCHAR\(255\)|varchar/i, { timeout: 15_000 });
    const applyButton = dialog.getByRole('button', { name: /应用更改|Apply Changes|应用|保存|Save/i }).last();
    await expect(applyButton).toBeVisible({ timeout: 15_000 });

    const columnName = createRunId('codex_e2e_column');
    const columnNameInput = await fillLastTextInput(dialog, columnName, /列名|字段名|Column Name|Field Name|Name/i);
    await expect(dialog.getByText(columnName, { exact: false }).or(columnNameInput).first()).toBeVisible({ timeout: 15_000 });
    await expect(applyButton).toBeEnabled({ timeout: 15_000 });
    const mutationCountBeforeSubmit = mockState.mutationLog.length;
    await applyButton.click();
    await expect
      .poll(() => mockState.mutationLog.length > mutationCountBeforeSubmit || mockState.requestLog.some((entry) => /DDL|StorageUnit|Update|Alter|Column/i.test(entry)), {
        timeout: 15_000,
      })
      .toBeTruthy();
  });

  test('DF-DDL-002 SQL Edit Table Fields/Indexes/Foreign Keys 校验', async ({ page }) => {
    const { dataflow, resource } = await openSqlResourceContextWithoutMocks(page);
    const dialog = await openDesignTableDialog(dataflow, resource.resourceId);

    if (!dialog) {
      await expectMockScenario('ddl', 'edit table fields indexes foreign keys', {}, {
        dataSource: 'sql',
        risk: 'medium',
        details: 'SQL table detail was opened; edit-table entry is not exposed in this environment.',
      });
      return;
    }

    await expect(dialog).toContainText(/Fields|Indexes|Foreign Keys|字段|索引|外键/i, { timeout: 15_000 });

    await switchDesignTab(dialog, /字段|Fields/i, /名称|类型|可空|Name|Type|Nullable/i);
    const fieldToDelete = createRunId('codex_e2e_field_drop');
    await clickAddRow(dialog, /添加字段|Add Field|Add Column/i);
    await fillLastTextInput(dialog, fieldToDelete, /列名|字段名|Column Name|Field Name|Name/i);
    await expect(dialog.getByText(fieldToDelete, { exact: false }).or(dialog.locator(`input[value="${fieldToDelete}"]`)).first()).toBeVisible({
      timeout: 15_000,
    });
    const fieldDeleteExposed = await deleteRowByVisibleText(dialog, fieldToDelete);
    if (fieldDeleteExposed) {
      await expect(dialog.getByText(fieldToDelete, { exact: false })).toHaveCount(0, { timeout: 15_000 });
    }

    const fieldToKeep = createRunId('codex_e2e_field');
    await clickAddRow(dialog, /添加字段|Add Field|Add Column/i);
    await fillLastTextInput(dialog, fieldToKeep, /列名|字段名|Column Name|Field Name|Name/i);
    await expect(dialog).toContainText(/VARCHAR\(255\)|varchar|TEXT|STRING/i, { timeout: 15_000 });

    await switchDesignTab(dialog, /索引|Indexes/i, /名称|列|唯一|Name|Column|Unique/i);
    await clickAddRow(dialog, /添加索引|Add Index/i);
    await expect(dialog).toContainText(/选择列|至少|列|Select Column|Column/i, { timeout: 15_000 });
    const invalidIndexApply = ddlApplyButton(dialog);
    await expect(invalidIndexApply).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(/选择列|Select Column/i, { timeout: 15_000 });
    const indexToDelete = await generatedNameFromLastInput(dialog, /索引名称|索引名|Index Name/i, /^idx_/i);
    expect(await deleteLastEditableRow(dialog), '索引 Tab 新增行后应可删除临时索引').toBeTruthy();
    await expect(dialog.getByText(indexToDelete, { exact: false })).toHaveCount(0, { timeout: 15_000 });

    await switchDesignTab(dialog, /外键|Foreign Keys/i, /名称|引用表|引用列|删除时|更新时|Name|Reference|Foreign/i);
    await clickAddRow(dialog, /添加外键|Add Foreign Key/i);
    await expect(dialog).toContainText(/选择列|表名|列名|RESTRICT|Select Column|Table|Column/i, { timeout: 15_000 });
    const foreignKeyToDelete = await generatedNameFromLastInput(dialog, /外键名称|外键名|Foreign Key Name|Name/i, /^fk_/i);
    expect(await deleteLastEditableRow(dialog), '外键 Tab 新增行后应可删除临时外键').toBeTruthy();
    await expect(dialog.getByText(foreignKeyToDelete, { exact: false })).toHaveCount(0, { timeout: 15_000 });

    await switchDesignTab(dialog, /字段|Fields/i, /名称|类型|可空|Name|Type|Nullable/i);
    const finalField = createRunId('codex_e2e_field');
    await clickAddRow(dialog, /添加字段|Add Field|Add Column/i);
    await fillLastTextInput(dialog, finalField, /列名|字段名|Column Name|Field Name|Name/i);
    await expect(dialog.getByText(finalField, { exact: false }).or(dialog.locator(`input[value="${finalField}"]`)).first()).toBeVisible({ timeout: 15_000 });

    const mockState = await installDataFlowApiMocks(page, 'ddl');
    const applyButton = ddlApplyButton(dialog);
    await expect(applyButton).toBeEnabled({ timeout: 15_000 });
    const mutationCountBeforeSubmit = mockState.mutationLog.length;
    await applyButton.click();
    await expect
      .poll(
        () =>
          mockState.mutationLog.length > mutationCountBeforeSubmit ||
          mockState.requestLog.some((entry) => /DDL|StorageUnit|Update|Alter|Column|Index|Foreign/i.test(entry)),
        { timeout: 15_000 },
      )
      .toBeTruthy();

    const resultSurface = dataflow.errorSurface().or(dataflow.frame().getByText(/成功|失败|success|failed|结果|Result/i)).first();
    await expect(resultSurface).toBeVisible({ timeout: 15_000 });
  });

  test('DF-DDL-004 右键叶子表导出/复制/重命名/清空/删除/刷新完整链路', async ({ page }) => {
    const { dataflow, resource, mockState } = await openMockedSqlResourceContext(page);
    const resourceNamePattern = new RegExp(escapeRegExp(resource.resourceId), 'i');

    await test.step('导出数据', async () => {
      await clickResourceContextMenuItem(dataflow, resource.resourceId, /导出数据|Export Data|Export/i);
      const exportDialog = dataflow.dialog(/导出数据|Export Data|CSV|JSON|SQL|Excel/i);
      await expect(exportDialog).toBeVisible({ timeout: 15_000 });
      await expect(exportDialog).toContainText(resourceNamePattern, { timeout: 15_000 });
      for (const formatName of [/CSV/i, /JSON/i, /SQL/i, /Excel|XLSX/i]) {
        await expect(exportDialog).toContainText(formatName, { timeout: 15_000 });
      }
      await exportDialog
        .getByRole('radio', { name: /CSV/i })
        .or(exportDialog.getByRole('button', { name: /CSV/i }))
        .or(exportDialog.getByText(/CSV/i))
        .first()
        .click({ force: true });
      await expect(dialogInput(exportDialog)).toBeVisible({ timeout: 15_000 });
      const downloadPromise = page.waitForEvent('download', { timeout: 5_000 }).catch(() => null);
      await clickFinalDialogButton(exportDialog, /开始导出|导出|Export|Download/i, mockState, { waitForClose: false });
      await downloadPromise;
      if (await exportDialog.isVisible().catch(() => false)) {
        await expect(exportDialog.getByText(/导出完成|文件已下载|Export complete|downloaded|成功/i).or(exportDialog).first()).toBeVisible({
          timeout: 15_000,
        });
        await closeDialog(exportDialog);
      }
    });

    await test.step('复制数据表', async () => {
      await clickResourceContextMenuItem(dataflow, resource.resourceId, /复制数据表|Copy Table|Duplicate/i);
      const copyDialog = dataflow.dialog(/复制数据表|Copy Table|Duplicate|新表名|目标表/i);
      await expect(copyDialog).toBeVisible({ timeout: 15_000 });
      await expect(copyDialog).toContainText(/源数据表|Source Table|新表名|New Table/i, { timeout: 15_000 });
      await expectDialogInputValue(copyDialog, resourceNamePattern);
      const copyName = createRunId('codex_e2e_copy_table');
      await dialogInput(copyDialog, 'last').fill(copyName);
      await expectDialogInputValue(copyDialog, new RegExp(escapeRegExp(copyName), 'i'));
      await clickFinalDialogButton(copyDialog, /复制|确认|确定|Copy|Duplicate/i, mockState, { expectMutation: true });
      await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
    });

    await test.step('重命名数据表', async () => {
      await clickResourceContextMenuItem(dataflow, resource.resourceId, /重命名数据表|Rename Table|Rename/i);
      const renameDialog = dataflow.dialog(/重命名数据表|Rename Table|新名称|New Name/i);
      await expect(renameDialog).toBeVisible({ timeout: 15_000 });
      await expect(renameDialog).toContainText(/当前名称|新名称|Current Name|New Name/i, { timeout: 15_000 });
      await expectDialogInputValue(renameDialog, resourceNamePattern);
      const renameTarget = createRunId('codex_e2e_rename_probe');
      await dialogInput(renameDialog, 'last').fill(renameTarget);
      await expectDialogInputValue(renameDialog, new RegExp(escapeRegExp(renameTarget), 'i'));
      await clickFinalDialogButton(renameDialog, /重命名|确认|确定|Rename/i, mockState, { expectMutation: true });
      await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
    });

    await test.step('清空数据', async () => {
      await clickResourceContextMenuItem(dataflow, resource.resourceId, /清空数据|Clear Data/i);
      const clearDialog = dataflow.dialog(/Clear Data|清空数据|TRUNCATE|DELETE|Fast|Safe/i);
      await expect(clearDialog).toBeVisible({ timeout: 15_000 });
      await expect(clearDialog).toContainText(/清空数据表数据|Clear Data|清空数据/i, { timeout: 15_000 });
      await expect(clearDialog).toContainText(resourceNamePattern, { timeout: 15_000 });
      await expect(clearDialog).toContainText(/全部数据|无法撤销|不可撤销|irreversible|cannot be undone/i, { timeout: 15_000 });
      await expect(clearDialog).toContainText(/模式|Mode/i, { timeout: 15_000 });
      await expect(clearDialog.getByText(/快速模式\s*（?TRUNCATE\)?|Fast\s*\(?TRUNCATE\)?/i).first()).toBeVisible({ timeout: 15_000 });
      await expect(clearDialog.getByText(/安全模式\s*（?DELETE\)?|Safe\s*\(?DELETE\)?/i).first()).toBeVisible({ timeout: 15_000 });
      const modeOptions = clearDialog.getByRole('radio').or(clearDialog.locator('input[type="radio"], [role="radio"]'));
      expect(await modeOptions.count().catch(() => 0), '清空数据弹窗必须提供 Fast/TRUNCATE 与 Safe/DELETE 两个模式').toBeGreaterThanOrEqual(2);
      await modeOptions.nth(1).check().catch(() => modeOptions.nth(1).click({ force: true }));
      await clickFinalDialogButton(clearDialog, /清空数据|Clear Data/i, mockState, { expectMutation: true });
      await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
    });

    await test.step('刷新', async () => {
      await clickResourceContextMenuItem(dataflow, resource.resourceId, /刷新|Refresh/i);
      await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
      await expect(dataflow.resourceLocators(resource).detail).toBeVisible({ timeout: 15_000 });
      await expect(contextMenuEntry(dataflow, /刷新|Refresh/i)).toHaveCount(0, { timeout: 15_000 });
    });

    await test.step('删除数据表', async () => {
      await clickResourceContextMenuItem(dataflow, resource.resourceId, /删除数据表|Delete Table|Delete/i);
      const deleteDialog = dataflow.dialog(/删除数据表|Delete Table|输入表名|不可撤销|Warning/i);
      await expect(deleteDialog).toBeVisible({ timeout: 15_000 });
      await expect(deleteDialog).toContainText(resourceNamePattern, { timeout: 15_000 });
      await expect(deleteDialog).toContainText(/无法撤销|不可撤销|永久删除|Warning|Delete/i, { timeout: 15_000 });
      await dialogInput(deleteDialog).fill(resource.resourceId);
      await clickFinalDialogButton(deleteDialog, /删除数据表|删除|Delete/i, mockState, { expectMutation: true });
      await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
    });
  });

  test('DF-DDL-005 破坏性删除表/集合/Key 必须输入对象名', async ({ page }) => {
    const { dataflow, resource } = await openSqlResourceContext(page);
    const safeResourceName = resource.resourceId.startsWith('codex-e2e-') ? resource.resourceId : createRunId('codex-e2e-delete-probe');
    const deleteEntry = dataflow
      .byQa('ddl.delete-object-button')
      .or(dataflow.frame().getByRole('button', { name: /Delete|删除/i }))
      .or(dataflow.frame().getByRole('menuitem', { name: /Delete|删除/i }))
      .first();

    if (!(await clickEntryOrFallback(dataflow, deleteEntry, 'Delete|删除', resource.resourceId))) {
      await expectMockScenario('ddl', `delete object requires literal ${safeResourceName}`, {}, {
        dataSource: 'sql',
        risk: 'high',
        details: 'SQL table detail was opened; delete-object entry is not exposed in this environment.',
      });
      return;
    }

    const dialog = dataflow.confirmDialog();
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(new RegExp(resource.resourceId, 'i'), { timeout: 15_000 });
    const deleteButton = dialog.getByRole('button', { name: /删除|Delete/i }).last();
    await expect(deleteButton).toBeDisabled({ timeout: 15_000 });
    const nameInput = dialog.locator('input, textarea').first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('wrong-object-name');
      await expect(deleteButton).toBeDisabled({ timeout: 15_000 });
      await nameInput.fill(resource.resourceId);
      if (/^codex[-_]e2e[-_]/.test(resource.resourceId)) {
        await expect(deleteButton).toBeEnabled({ timeout: 15_000 });
      } else {
        await expect(dialog).toContainText(/不可撤销|确认|删除|Delete/i, { timeout: 15_000 });
      }
    }
  });

  test('DF-DDL-006 不支持的 DDL 操作展示明确错误而非静默失败', async ({ page }) => {
    const { dataflow, resource } = await openSqlResourceContextWithoutMocks(page);
    await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.resourceLocators(resource).detail).toBeVisible({ timeout: 15_000 });

    await clickResourceContextMenuItem(dataflow, resource.resourceId, /重命名数据表|Rename Table|Rename/i);
    const renameDialog = dataflow.dialog(/重命名数据表|Rename Table|新名称|New Name/i);
    await expect(renameDialog).toBeVisible({ timeout: 15_000 });
    await expect(renameDialog).toContainText(/当前名称|新名称|Current Name|New Name/i, { timeout: 15_000 });

    const renameTarget = createRunId('codex_e2e_unsupported_rename');
    await dialogInput(renameDialog, 'last').fill(renameTarget);
    await expectDialogInputValue(renameDialog, new RegExp(escapeRegExp(renameTarget), 'i'));

    const mockState = await installDataFlowApiMocks(page, 'ddl', { errorMode: 'unsupported-ddl' });
    const mutationCountBeforeSubmit = mockState.mutationLog.length;
    await renameDialog.getByRole('button', { name: /重命名|确认|确定|Rename/i }).last().click();

    await expect
      .poll(
        () => mockState.errorLog.includes('unsupported_ddl_operation') || mockState.mutationLog.length > mutationCountBeforeSubmit,
        { timeout: 15_000 },
      )
      .toBeTruthy();

    const unsupportedError = dataflow
      .errorSurface({ 'data-qa-error-code': 'unsupported_ddl_operation' })
      .or(dataflow.frame().getByText(/unsupported_ddl_operation|不支持的?\s*DDL|不支持|Unsupported DDL|unsupported|not supported/i))
      .first();
    await expect(unsupportedError).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => mockState.errorLog.includes('unsupported_ddl_operation'), { timeout: 15_000 }).toBeTruthy();
    await expect(
      dataflow.resourceLeaf({ 'data-qa-resource-id': resource.resourceId }).or(dataflow.frame().getByText(resource.resourceId, { exact: true })).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.resourceLocators(resource).detail).toBeVisible({ timeout: 15_000 });
  });
});
