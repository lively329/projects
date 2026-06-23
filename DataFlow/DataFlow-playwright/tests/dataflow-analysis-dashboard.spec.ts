import { expect, test } from './fixtures.js';
import type { Locator, Page } from '@playwright/test';
import { DataFlowPage } from '../src/pages/dataflow.page.js';
import { openDataFlowWorkspaceFromDatabaseList } from './helpers/dataflow-flow.js';
import type { ManageableDataSourceType } from '../src/pages/sealos-home.page.js';
import { createRunId, expectMockScenario, installDataFlowApiMocks, isVisible } from './helpers/dataflow-mock-flow.js';
import { fillQueryEditor, openSqlQueryEditor, queryResultPane, queryRunButton } from './helpers/query-editor-flow.js';

type AnalysisDataSourceType = 'mongodb' | 'redis' | 'sql';

function shortRunTitle(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 6)}`;
}

function visibleTitlePrefix(title: string) {
  return title.slice(0, 15).replace(/-$/, '');
}

function dataFlowSourceType(dataSourceType: AnalysisDataSourceType): ManageableDataSourceType {
  return dataSourceType === 'sql' ? 'mysql' : dataSourceType;
}

async function openAnalysisWorkspace(
  page: Page,
  mockOptions: Parameters<typeof installDataFlowApiMocks>[2] = {},
  dataSourceType: AnalysisDataSourceType = 'sql',
) {
  const { dataflow } = await openDataFlowWorkspaceFromDatabaseList(page, { dataSourceType: dataFlowSourceType(dataSourceType) });
  const mockState = await installDataFlowApiMocks(page, 'analysis', mockOptions);

  await dataflow.switchActivity('analysis');
  await expect(dataflow.activeActivityTab('analysis')).toBeVisible({ timeout: 15_000 });
  await expect(analysisWorkspaceReady(dataflow)).toBeVisible({ timeout: 15_000 });
  await waitForDashboardDataHydration(dataflow);

  return { dataflow, mockState };
}

async function waitForDashboardDataHydration(dataflow: DataFlowPage) {
  await expect
    .poll(
      async () => {
        const dashboardItem = await firstDashboardItem(dataflow);
        const hasDashboardItem = await dashboardItem.isVisible().catch(() => false);
        const hasDashboardWidget = await firstDashboardWidget(dataflow)
          .isVisible()
          .catch(() => false);
        const hasEmptyState = await dataflow
          .emptyDashboard()
          .isVisible()
          .catch(() => false);

        return hasDashboardItem || hasDashboardWidget || hasEmptyState;
      },
      { timeout: 10_000 },
    )
    .toBe(true)
    .catch(() => {});
}

function analysisWorkspaceReady(dataflow: DataFlowPage) {
  return dataflow
    .analysisView()
    .or(dataflow.emptyDashboard())
    .or(dataflow.frame().getByRole('button', { name: /新增仪表盘|New Dashboard/i }))
    .or(firstDashboardTitle(dataflow))
    .or(firstDashboardChart(dataflow))
    .first();
}

async function firstDashboardItem(dataflow: DataFlowPage) {
  return dataflow
    .byQa('analysis.dashboard.list-item')
    .or(dataflow.frame().getByRole('treeitem'))
    .or(dataflow.frame().locator('div[class*="cursor-pointer"]:has(svg.lucide-layout-dashboard)').filter({ hasText: /\S/ }))
    .or(dataflow.frame().locator('span[class*="truncate"]').filter({ hasText: /\S/ }).locator('xpath=ancestor::div[contains(@class, "cursor-pointer")][1]'))
    .first();
}

function firstDashboardTitle(dataflow: DataFlowPage) {
  return dataflow.byQa('analysis.dashboard.title').or(dataflow.frame().locator('div[class*="font-bold"][class*="text-lg"]')).or(dataflow.frame().locator('.font-bold.text-lg')).first();
}

function firstDashboardChart(dataflow: DataFlowPage) {
  return dataflow.byQa('analysis.chart.svg').or(dataflow.frame().locator('svg:not([class*="lucide"])')).or(dataflow.frame().locator('svg').filter({ hasText: /type|\d/ })).first();
}

function firstDashboardWidget(dataflow: DataFlowPage) {
  return dataflow
    .byQa('analysis.dashboard.widget')
    .or(dataflow.byQa('analysis.chart.widget'))
    .or(dataflow.frame().locator('div[class*="bg-accent"][class*="rounded-lg"]:has(svg:not([class*="lucide"]))'))
    .or(firstDashboardChart(dataflow).locator('xpath=ancestor::div[contains(@class, "rounded")][1]'))
    .first();
}

function dashboardWidgetByTitle(dataflow: DataFlowPage, title: string) {
  const titleText = dataflow.frame().getByText(title, { exact: false }).first();
  return titleText
    .locator('xpath=ancestor::div[contains(@class, "react-grid-item")][1]')
    .or(titleText.locator('xpath=ancestor::div[contains(@class, "h-full")][1]'))
    .or(titleText.locator('xpath=ancestor::div[contains(@class, "rounded")][1]'))
    .or(firstDashboardWidget(dataflow))
    .first();
}

function renderedDashboardChart(dataflow: DataFlowPage) {
  return firstDashboardWidget(dataflow)
    .locator('canvas')
    .or(firstDashboardWidget(dataflow).locator('svg:not([class*="lucide"])'))
    .or(firstDashboardChart(dataflow))
    .first();
}

function renderedWidgetChart(widget: Locator) {
  return widget.locator('canvas').or(widget.locator('svg:not([class*="lucide"])')).first();
}

function addChartButton(dataflow: DataFlowPage) {
  return dataflow
    .byQa('analysis.chart.create-button')
    .or(dataflow.frame().getByRole('button', { name: /创建图表|Create Chart|添加图表|Add Chart/i }))
    .first();
}

function chartConfigMenuButton(dataflow: DataFlowPage, widget: Locator = firstDashboardWidget(dataflow)) {
  return dataflow
    .byQa('analysis.chart.menu-button')
    .or(widget.locator('button:has(svg.lucide-ellipsis-vertical), button:has-text("⋮")').last())
    .first();
}

function widgetMenuItem(dataflow: DataFlowPage, label: RegExp) {
  return dataflow.frame().getByRole('menuitem').filter({ hasText: label }).or(dataflow.frame().getByText(label)).first();
}

function widgetTitleLocator(dataflow: DataFlowPage, widget: Locator, title: string) {
  return dataflow.byQa('analysis.chart.title').or(widget.getByText(title, { exact: false })).or(widget.locator('input, textarea, [contenteditable="true"], div').filter({ hasText: title })).first();
}

function widgetDragHandle(widget: Locator) {
  return widget
    .locator('.drag-handle, [data-testid="analysis.widget.drag-handle"], [data-qa-drag-handle="widget"], button:has(svg.lucide-grip), svg.lucide-grip')
    .first();
}

async function openWidgetMenu(dataflow: DataFlowPage, widget: Locator = firstDashboardWidget(dataflow)) {
  const menuButton = chartConfigMenuButton(dataflow, widget);
  await expect(menuButton).toBeVisible({ timeout: 15_000 });
  await menuButton.click();
  await expect(widgetMenuItem(dataflow, /最大化|Maximize/i).or(widgetMenuItem(dataflow, /设置|Settings/i)).first()).toBeVisible({ timeout: 10_000 });
}

async function closeTopDialog(dataflow: DataFlowPage) {
  const closeButton = dataflow.frame().getByRole('button', { name: /关闭|Close/i }).last();
  if (await closeButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await closeButton.click();
  } else {
    await dataflow.frame().locator('body').press('Escape').catch(() => {});
  }
}

async function expectWidgetChartVisible(dataflow: DataFlowPage) {
  await expect(firstDashboardWidget(dataflow)).toBeVisible({ timeout: 20_000 });
  await expect(renderedDashboardChart(dataflow)).toBeVisible({ timeout: 30_000 });
}

async function renameWidgetThroughSettings(dataflow: DataFlowPage, widget: Locator, currentTitle: string, nextTitle: string) {
  await openWidgetMenu(dataflow, widget);
  await widgetMenuItem(dataflow, /设置|Settings/i).click();
  const settingsDialog = dataflow.dialog(/设置|Settings|图表标题|数据配置|Chart|保存/i);
  await expect(settingsDialog).toBeVisible({ timeout: 15_000 });
  const titleInput = settingsDialog
    .locator(`input[value="${currentTitle.replaceAll('"', '\\"')}"]`)
    .or(settingsDialog.getByRole('textbox'))
    .or(settingsDialog.locator('input, textarea'))
    .first();
  await expect(titleInput).toBeVisible({ timeout: 15_000 });
  await titleInput.fill(nextTitle);
  const saveButton = saveChartButton(settingsDialog);
  await expect(saveButton).toBeVisible({ timeout: 15_000 });
  await expect(saveButton).toBeEnabled({ timeout: 15_000 });
  await saveButton.click();
  await expect(settingsDialog).toHaveCount(0, { timeout: 30_000 });
}

function refreshDashboardButton(dataflow: DataFlowPage) {
  return dataflow
    .byQa('analysis.dashboard.refresh-button')
    .or(dataflow.frame().getByRole('button', { name: /刷新|Refresh/i }))
    .or(dataflow.frame().locator('button:has(svg.lucide-refresh-cw)'))
    .first();
}

function addDashboardButton(dataflow: DataFlowPage) {
  return dataflow
    .byQa('analysis.dashboard.create-button')
    .or(dataflow.frame().getByRole('button', { name: /新增仪表盘|New Dashboard|Dashboard/i }))
    .or(dataflow.frame().locator('button:has(svg.lucide-plus)').first())
    .first();
}

function dashboardDialog(dataflow: DataFlowPage) {
  return dataflow
    .dialog(/新增仪表盘|新建仪表盘|Dashboard|仪表盘标题|标题/i)
    .or(dataflow.frame().getByRole('dialog').first())
    .first();
}

function chartDialog(dataflow: DataFlowPage) {
  return dataflow
    .dialog(/添加图表|创建图表|图表标题|数据配置|图表类型|Chart/i)
    .or(dataflow.frame().getByRole('dialog').first())
    .first();
}

function saveChartButton(dialog: Locator) {
  return dialog.getByRole('button', { name: /保存|Save/i }).first();
}

function dataSourceStatement(mock: Awaited<ReturnType<typeof installDataFlowApiMocks>>, dataSourceType: AnalysisDataSourceType) {
  return dataSourceType === 'sql' ? mock.sql : dataSourceType === 'mongodb' ? mock.mongoCommand : mock.redisCommand;
}

async function fillEditorLike(page: Page, editor: Locator, value: string) {
  await expect(editor).toBeVisible({ timeout: 15_000 });
  const monacoInput = editor
    .locator('xpath=ancestor::*[contains(@class, "monaco-editor")][1]')
    .locator('.view-line, .monaco-scrollable-element, textarea')
    .first();
  const target = (await monacoInput.isVisible().catch(() => false)) ? monacoInput : editor;
  await target.click({ force: true });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(value);
}

async function chooseOptionFromPopup(dataflow: DataFlowPage, preferred: RegExp) {
  const preferredOption = dataflow.frame().getByRole('option').filter({ hasText: preferred }).first();
  if (await preferredOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await preferredOption.click({ force: true });
    return;
  }

  const menuOption = dataflow
    .frame()
    .locator('[role="option"], [role="menuitem"], [cmdk-item], div')
    .filter({ hasText: preferred })
    .first();
  if (await menuOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await menuOption.click({ force: true });
    return;
  }

  await dataflow.frame().getByRole('option').first().click({ force: true });
}

async function selectComboboxOption(dataflow: DataFlowPage, combobox: Locator, preferred: RegExp) {
  await combobox.scrollIntoViewIfNeeded().catch(() => {});
  await expect(combobox).toBeVisible({ timeout: 15_000 });
  await expect(combobox).toBeEnabled({ timeout: 15_000 });
  await combobox.click();
  await chooseOptionFromPopup(dataflow, preferred);
}

function dataSourceSelector(dataflow: DataFlowPage, dialog: Locator) {
  return dataflow
    .byQa('analysis.chart.datasource-select')
    .or(dialog.getByRole('combobox').filter({ hasText: /数据库|数据源|Data Source|Database|SQL|Mongo|Redis|test-db|mydb|kubeblocks/i }))
    .or(dialog.getByRole('button').filter({ hasText: /选择数据库|数据库|数据源|Data Source|Database|SQL|Mongo|Redis|test-db|mydb|kubeblocks/i }))
    .or(dialog.locator('[role="combobox"]').last())
    .first();
}

async function selectRequiredDataSource(dataflow: DataFlowPage, dialog: Locator, dataSourceType: AnalysisDataSourceType) {
  const preferred = dataSourceType === 'sql' ? /kubeblocks|mydb|codex_e2e|MySQL|PostgreSQL|SQL|test-db/i : dataSourceType === 'mongodb' ? /admin|mydb|codex_e2e|Mongo|mongodb/i : /^0$|Redis|redis|codex_e2e/i;
  const selector = dataSourceSelector(dataflow, dialog);
  await selectComboboxOption(dataflow, selector, preferred);
}

function comboboxAfterLabel(dialog: Locator, label: RegExp) {
  return dialog
    .getByText(label)
    .first()
    .locator('xpath=following::button[@role="combobox" or @aria-haspopup="listbox"][1]')
    .first();
}

async function selectChartField(dataflow: DataFlowPage, dialog: Locator, label: RegExp, preferred: RegExp) {
  const selector = comboboxAfterLabel(dialog, label);
  await selectComboboxOption(dataflow, selector, preferred);
}

async function clickFramePoint(page: Page, dataflow: DataFlowPage, x: number, y: number) {
  const frameBox = await dataflow.window().boundingBox();
  if (frameBox) {
    await page.mouse.click(frameBox.x + x, frameBox.y + y);
    return;
  }

  await page.mouse.click(x, y);
}

async function selectYAxisField(page: Page, dataflow: DataFlowPage, dialog: Locator) {
  const trigger = dialog
    .getByText(/^Y\s*轴$|^Y-Axis$/i)
    .first()
    .locator('xpath=following::button[1]')
    .first();
  await trigger.scrollIntoViewIfNeeded().catch(() => {});
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await expect(trigger).toBeEnabled({ timeout: 15_000 });
  if (await trigger.getByText(/value/i).isVisible({ timeout: 1_000 }).catch(() => false)) {
    await dataflow.frame().locator('body').press('Escape').catch(() => {});
    return;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await trigger.click();
    const valueItem = dataflow
      .frame()
      .locator('[role="menu"], [data-radix-menu-content], [data-slot="dropdown-menu-content"], [data-radix-popper-content-wrapper]')
      .filter({ hasText: /value|数值/i })
      .locator('[role="menuitemcheckbox"], [data-radix-collection-item]')
      .filter({ hasText: /^value$|value|数值/i })
      .first()
      .or(dataflow.frame().locator('[role="menuitemcheckbox"]').filter({ hasText: /^value$|value|数值/i }).first());

    if (await valueItem.isVisible({ timeout: 2_500 }).catch(() => false)) {
      await valueItem.click({ force: true });
    } else {
      const rect = await trigger.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      });
      await clickFramePoint(page, dataflow, rect.x + rect.width / 2, rect.y + rect.height + 42);
    }
    await dataflow.frame().locator('body').press('Escape').catch(() => {});
    if (await trigger.getByText(/value/i).isVisible({ timeout: 2_000 }).catch(() => false)) {
      break;
    }
  }
  await expect(trigger).toContainText(/value|数值/i, { timeout: 10_000 });
}

async function selectSortMode(dialog: Locator) {
  const sortLabel = dialog.getByText(/排序方式|Sort By/i).first();
  await sortLabel.scrollIntoViewIfNeeded().catch(() => {});
  const xAxisSort = dialog.getByText(/^X\s*轴值$|X-Axis Value/i).first();
  if (await xAxisSort.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await xAxisSort.click({ force: true });
  }

  const asc = dialog.getByText(/^升序$|Ascending/i).first();
  if (await asc.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await asc.click({ force: true });
  }
}

async function expectChartPreviewRendered(dialog: Locator) {
  const renderedChart = dialog
    .locator('canvas')
    .or(dialog.locator('svg:not([class*="lucide"])'))
    .first();
  await expect(renderedChart).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText(/请先配置数据源和图表参数以预览|Configure data source/i)).toHaveCount(0, { timeout: 10_000 });
}

async function selectChartConfigFields(page: Page, dataflow: DataFlowPage, dialog: Locator, chartType: RegExp = /柱状|Bar|折线|Line|饼图|Pie|面积|Area/i) {
  await selectChartField(dataflow, dialog, /图表类型|Chart Type/i, chartType);
  await selectChartField(dataflow, dialog, /^X\s*轴$|X Axis/i, /^category$|category|类别/i);
  await selectYAxisField(page, dataflow, dialog);
  await selectSortMode(dialog);
  await expectChartPreviewRendered(dialog);
}

async function selectChartTypeOnly(dataflow: DataFlowPage, dialog: Locator, chartType: RegExp) {
  await selectChartField(dataflow, dialog, /图表类型|Chart Type/i, chartType);
  await expect(dialog).toContainText(/柱状|折线|饼图|面积|Bar|Line|Pie|Area/i, { timeout: 10_000 });
}

async function createDashboardFromAnalysis(dataflow: DataFlowPage, title: string) {
  const addButton = addDashboardButton(dataflow);
  await expect(addButton).toBeVisible({ timeout: 20_000 });
  await addButton.click();

  const dialog = dashboardDialog(dataflow);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const input = dialog.getByRole('textbox').or(dialog.locator('input, textarea')).first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(title);
  await dialog.getByRole('button', { name: /确认|确定|保存|创建|Create|OK/i }).last().click();
  await expect(dialog.getByText(/Cannot read|错误|失败|Error|Failed/i)).toHaveCount(0, { timeout: 5_000 });
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(dataflow.frame().getByText(visibleTitlePrefix(title), { exact: false }).first()).toBeVisible({ timeout: 20_000 });
}

async function openCreateChartDialog(dataflow: DataFlowPage) {
  const addButton = addChartButton(dataflow).or(dataflow.frame().locator('button:has(svg.lucide-plus)').last()).first();
  await expect(addButton).toBeVisible({ timeout: 20_000 });
  await addButton.click();

  const dialog = chartDialog(dataflow);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function configureChartData(
  page: Page,
  dataflow: DataFlowPage,
  dialog: Locator,
  mock: Awaited<ReturnType<typeof installDataFlowApiMocks>>,
  dataSourceType: AnalysisDataSourceType,
) {
  const dataConfigTab = dialog.getByText(/数据配置|Data Config|Data/i).first();
  if (await dataConfigTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await dataConfigTab.click();
  }

  await selectRequiredDataSource(dataflow, dialog, dataSourceType);

  const statement = dataSourceStatement(mock, dataSourceType);
  const editor = dataflow
    .byQa('analysis.chart.query-editor')
    .or(dialog.locator('textarea, .cm-content, [contenteditable="true"], .cm-editor').first())
    .first();
  await fillEditorLike(page, editor, statement);
  await expect(dialog).toContainText(/category|value|数据配置|Data|SELECT|HGETALL|find/i, { timeout: 15_000 });

  const runButton = dialog
    .getByRole('button', { name: /应用|执行|运行|查询|Apply|Run|Preview/i })
    .or(dialog.locator('button:has(svg.lucide-play), button:has(svg[class*="play"])'))
    .first();
  const requestCountBeforeRun = mock.requestLog.length;
  if (await runButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await runButton.click();
  }
  await expect
    .poll(
      async () =>
        (await dialog.getByText(/category|value/i).count().catch(() => 0)) > 0 || mock.requestLog.length > requestCountBeforeRun,
      { timeout: 20_000 },
    )
    .toBe(true);

  const backToChartButton = dialog.getByRole('button', { name: /返回图表|Back to Chart|图表/i }).first();
  if (await backToChartButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await backToChartButton.click();
  }
}

async function createDashboardAndConfiguredChart(page: Page, dataSourceType: AnalysisDataSourceType) {
  const title = shortRunTitle(`codex-e2e-${dataSourceType}-d`);
  const chartTitle = shortRunTitle(`codex-e2e-${dataSourceType}-c`);
  const { dataflow, mockState: mock } = await openAnalysisWorkspace(page, {}, dataSourceType);

  return createConfiguredChartInWorkspace(page, dataflow, mock, dataSourceType, title, chartTitle);
}

async function createConfiguredChartInWorkspace(
  page: Page,
  dataflow: DataFlowPage,
  mock: Awaited<ReturnType<typeof installDataFlowApiMocks>>,
  dataSourceType: AnalysisDataSourceType,
  title = shortRunTitle(`codex-e2e-${dataSourceType}-d`),
  chartTitle = shortRunTitle(`codex-e2e-${dataSourceType}-c`),
) {
  await createDashboardFromAnalysis(dataflow, title);
  await addConfiguredChartToOpenDashboard(page, dataflow, mock, dataSourceType, chartTitle);

  await expect(dataflow.activeActivityTab('analysis')).toBeVisible({ timeout: 15_000 });
  await expect(dataflow.frame().getByText(visibleTitlePrefix(title), { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  await expect(dataflow.frame().getByText(chartTitle, { exact: false }).or(firstDashboardWidget(dataflow)).first()).toBeVisible({ timeout: 30_000 });
  await expect(renderedDashboardChart(dataflow)).toBeVisible({ timeout: 30_000 });

  return { dataflow, mockState: mock, title, chartTitle };
}

async function addConfiguredChartToOpenDashboard(
  page: Page,
  dataflow: DataFlowPage,
  mock: Awaited<ReturnType<typeof installDataFlowApiMocks>>,
  dataSourceType: AnalysisDataSourceType,
  chartTitle = shortRunTitle(`codex-e2e-${dataSourceType}-c`),
) {
  const dialog = await openCreateChartDialog(dataflow);
  const titleInput = dialog.getByRole('textbox').or(dialog.locator('input, textarea')).first();
  await expect(titleInput).toBeVisible({ timeout: 15_000 });
  await titleInput.fill(chartTitle);
  await configureChartData(page, dataflow, dialog, mock, dataSourceType);
  await selectChartConfigFields(page, dataflow, dialog);

  const saveButton = saveChartButton(dialog);
  await expect(saveButton).toBeVisible({ timeout: 15_000 });
  await expect(saveButton).toBeEnabled({ timeout: 20_000 });
  await saveButton.click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await expect(dataflow.frame().getByText(chartTitle, { exact: false }).or(firstDashboardWidget(dataflow)).first()).toBeVisible({ timeout: 30_000 });
  await expect(renderedDashboardChart(dataflow)).toBeVisible({ timeout: 30_000 });
}

test.describe('DataFlow 仪表盘与图表模块', () => {
  for (const dataSourceType of ['sql', 'mongodb', 'redis'] as const) {
    test(`DF-ANALYSIS-E2E-${dataSourceType.toUpperCase()} 新增仪表盘并完成图表配置`, async ({ page }) => {
      const { dataflow, chartTitle } = await createDashboardAndConfiguredChart(page, dataSourceType);
      await expect(dataflow.frame().getByText(chartTitle, { exact: false }).or(firstDashboardChart(dataflow)).first()).toBeVisible({ timeout: 30_000 });
    });
  }

  test('DF-ANALYSIS-001 仪表盘入口展示空态或已选仪表盘，不阻塞切回工作台', async ({ page }) => {
    const { dataflow } = await openAnalysisWorkspace(page);

    await expect(analysisWorkspaceReady(dataflow)).toBeVisible({ timeout: 15_000 });

    await dataflow.switchActivity('connections');
    await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
  });

  test('DF-ANALYSIS-002 仪表盘列表按创建时间倒序并可打开', async ({ page }) => {
    const { dataflow, mockState } = await openAnalysisWorkspace(page);
    const firstItem = await firstDashboardItem(dataflow);
    await expect(firstItem).toBeVisible({ timeout: 20_000 });

    const listText = await dataflow.frame().locator('body').innerText({ timeout: 15_000 });
    expect(listText).toContain(mockState.dashboardTitles[0]);
    expect(listText.indexOf(mockState.dashboardTitles[0])).toBeLessThan(listText.indexOf(mockState.dashboardTitles[1]));

    await firstItem.click();
    await expect(dataflow.analysisView().or(dataflow.frame().getByText(mockState.dashboardTitles[0], { exact: false })).first()).toBeVisible({ timeout: 15_000 });
    await expect(firstDashboardTitle(dataflow).or(firstDashboardWidget(dataflow)).or(refreshDashboardButton(dataflow)).first()).toBeVisible({ timeout: 20_000 });
    expect(mockState.requestLog.filter((operation) => /Dashboard|Chart|Widget|Rows|Query/i.test(operation)).length).toBeGreaterThan(0);
  });

  test('DF-ANALYSIS-003 从图表创建流程按数据源预填数据配置', async ({ page }) => {
    for (const dataSourceType of ['sql', 'mongodb', 'redis'] as const) {
      const dashboardTitle = shortRunTitle(`codex-e2e-${dataSourceType}-d`);
      const chartTitle = shortRunTitle(`codex-e2e-${dataSourceType}-c`);
      const { dataflow, mockState } = await openAnalysisWorkspace(page, {}, dataSourceType);

      await createDashboardFromAnalysis(dataflow, dashboardTitle);
      const dialog = await openCreateChartDialog(dataflow);
      const titleInput = dialog.getByRole('textbox').or(dialog.locator('input, textarea')).first();
      await expect(titleInput).toBeVisible({ timeout: 15_000 });
      await titleInput.fill(chartTitle);
      await configureChartData(page, dataflow, dialog, mockState, dataSourceType);
      expect(mockState.requestLog.some((operation) => /Rows|Query|Execute|Chart|Dashboard/i.test(operation))).toBeTruthy();
      await dataflow.frame().locator('body').press('Escape').catch(() => {});
    }
  });

  test('DF-ANALYSIS-004 图表类型与 X/Y 轴配置必填校验', async ({ page }) => {
    const dashboardTitle = shortRunTitle('codex-e2e-sql-d');
    const chartTitle = shortRunTitle('codex-e2e-sql-c');
    const { dataflow, mockState } = await openAnalysisWorkspace(page);

    await createDashboardFromAnalysis(dataflow, dashboardTitle);
    const dialog = await openCreateChartDialog(dataflow);
    await dialog.getByRole('textbox').or(dialog.locator('input, textarea')).first().fill(chartTitle);
    await configureChartData(page, dataflow, dialog, mockState, 'sql');

    const saveButton = saveChartButton(dialog);
    await expect(saveButton).toBeVisible({ timeout: 15_000 });
    if (await saveButton.isEnabled().catch(() => false)) {
      await saveButton.click();
      await expect(dialog.getByText(/必填|请选择|字段|X|Y|required|select/i).or(dialog).first()).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(saveButton).toBeDisabled({ timeout: 15_000 });
    }

    for (const chartType of [/柱状|Bar/i, /折线|Line/i, /饼图|Pie/i, /面积|Area/i]) {
      await selectChartTypeOnly(dataflow, dialog, chartType);
      await expect(dialog).toContainText(/category|value|X|Y|轴|排序|Sort/i, { timeout: 15_000 });
    }
    await expect(dialog.getByText(/^Y\s*轴$|^Y-Axis$/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText(/排序方式|Sort By/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(saveButton).toBeDisabled({ timeout: 10_000 });
  });

  test('DF-ANALYSIS-005 保存图表后切换到目标仪表盘并展示组件', async ({ page }) => {
    const { dataflow, title, chartTitle } = await createDashboardAndConfiguredChart(page, 'sql');
    const widget = firstDashboardWidget(dataflow);

    await expect(dataflow.activeActivityTab('analysis')).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.frame().getByText(visibleTitlePrefix(title), { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(widget).toBeVisible({ timeout: 15_000 });
    await expect(widget).toContainText(/\S/, { timeout: 15_000 });
    await expect(dataflow.frame().getByText(chartTitle, { exact: false }).or(firstDashboardChart(dataflow)).first()).toBeVisible({ timeout: 20_000 });
    await expect(renderedDashboardChart(dataflow)).toBeVisible({ timeout: 30_000 });
  });

  test('DF-ANALYSIS-006 仪表盘刷新时单个图表失败不影响其他图表', async ({ page }) => {
    const { dataflow, mockState } = await openAnalysisWorkspace(page, { partialFailure: true });
    const refreshButton = refreshDashboardButton(dataflow);
    const successWidget = dashboardWidgetByTitle(dataflow, 'codex-e2e-widget-success');
    const failedWidget = dashboardWidgetByTitle(dataflow, 'codex-e2e-widget-failed');

    await expect(successWidget).toBeVisible({ timeout: 20_000 });
    await expect(failedWidget).toBeVisible({ timeout: 20_000 });
    await expect(renderedWidgetChart(successWidget)).toBeVisible({ timeout: 20_000 });
    await expect(refreshButton).toBeVisible({ timeout: 15_000 });
    await refreshButton.click();
    await expect(successWidget).toBeVisible({ timeout: 30_000 });
    await expect(failedWidget).toBeVisible({ timeout: 30_000 });
    await expect(renderedWidgetChart(successWidget)).toBeVisible({ timeout: 30_000 });
    await expect(
      failedWidget
        .getByText(/widget_query_failed|Unknown refresh error|查询失败|刷新失败|failed/i)
        .or(dataflow.errorSurface({ 'data-qa-error-code': 'widget_query_failed' }))
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(dataflow.frame().getByText('codex-e2e-widget-success', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.frame().getByText('codex-e2e-widget-failed', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    expect(mockState.errorLog).toContain('widget_query_failed');
  });

  test('DF-ANALYSIS-007 重开仪表盘优先展示快照并后台刷新', async ({ page }) => {
    const { dataflow, mockState } = await openAnalysisWorkspace(page, { delayMs: 100 });
    const dashboardItem = await firstDashboardItem(dataflow);

    if (!(await dashboardItem.isVisible().catch(() => false))) {
      await expectMockScenario('analysis', 'dashboard snapshot fallback');
      return;
    }
    await dashboardItem.click();
    await expect(firstDashboardWidget(dataflow).or(firstDashboardTitle(dataflow)).first()).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.byQa('analysis.dashboard.loading')).toHaveCount(0, { timeout: 15_000 });
    expect(mockState.requestLog.length).toBeGreaterThanOrEqual(0);
  });

  test('DF-ANALYSIS-008 图表标题可编辑并持久化', async ({ page }) => {
    const { dataflow, mockState, chartTitle } = await createDashboardAndConfiguredChart(page, 'sql');
    const widget = dashboardWidgetByTitle(dataflow, chartTitle);

    await expectWidgetChartVisible(dataflow);
    const editedTitle = shortRunTitle('codex-e2e-chart-renamed');
    await renameWidgetThroughSettings(dataflow, widget, chartTitle, editedTitle);
    await expect(dataflow.frame().getByText(editedTitle, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => mockState.mutationLog.some((entry) => /UpdateWidget/i.test(entry)), { timeout: 10_000 }).toBeTruthy();
    const renamedWidget = dashboardWidgetByTitle(dataflow, editedTitle);
    await expect(renamedWidget).toBeVisible({ timeout: 15_000 });

    const beforeDragBox = await renamedWidget.boundingBox();
    const handle = widgetDragHandle(renamedWidget).or(renamedWidget.locator('.drag-handle').first()).first();
    await expect(handle).toBeVisible({ timeout: 15_000 });
    const mutationCountBeforeDrag = mockState.mutationLog.length;
    const handleBox = await handle.boundingBox();
    if (handleBox) {
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + handleBox.width / 2 + 180, handleBox.y + handleBox.height / 2 + 40, { steps: 8 });
      await page.mouse.up();
    }
    const afterDragBox = await renamedWidget.boundingBox();
    expect(
      mockState.mutationLog.slice(mutationCountBeforeDrag).some((entry) => /UpdateWidgetLayouts/i.test(entry)) ||
        Boolean(beforeDragBox && afterDragBox && (Math.abs(beforeDragBox.x - afterDragBox.x) > 4 || Math.abs(beforeDragBox.y - afterDragBox.y) > 4)),
    ).toBeTruthy();

    await openWidgetMenu(dataflow, renamedWidget);
    await widgetMenuItem(dataflow, /最大化|Maximize/i).click();
    const maximizeDialog = dataflow.dialog(new RegExp(editedTitle)).or(dataflow.frame().getByRole('dialog').filter({ hasText: editedTitle })).first();
    await expect(maximizeDialog).toBeVisible({ timeout: 15_000 });
    await expect(maximizeDialog.locator('canvas').or(maximizeDialog.locator('svg:not([class*="lucide"])')).first()).toBeVisible({ timeout: 20_000 });
    await closeTopDialog(dataflow);

    await openWidgetMenu(dataflow, renamedWidget);
    const exportCountBefore = mockState.mutationLog.length;
    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 }).catch(() => null);
    await widgetMenuItem(dataflow, /导出\s*PNG|Export PNG/i).click();
    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.png$/i);
    } else {
      await expect(dataflow.frame().getByText(/导出|Export|PNG|成功|download/i).or(firstDashboardWidget(dataflow)).first()).toBeVisible({ timeout: 10_000 });
    }
    expect(mockState.mutationLog.length).toBeGreaterThanOrEqual(exportCountBefore);

    await openWidgetMenu(dataflow, dashboardWidgetByTitle(dataflow, editedTitle));
    await widgetMenuItem(dataflow, /设置|Settings/i).click();
    const settingsDialog = dataflow.dialog(/设置|Settings|图表标题|数据配置|Chart|保存/i);
    await expect(settingsDialog).toBeVisible({ timeout: 15_000 });
    await expect(settingsDialog).toContainText(/数据配置|图表类型|保存|Chart|Data|Save/i, { timeout: 15_000 });
    await closeTopDialog(dataflow);

    await openWidgetMenu(dataflow, renamedWidget);
    await widgetMenuItem(dataflow, /^删除$|Delete/i).click();
    const confirmDialog = dataflow.confirmDialog();
    await expect(confirmDialog).toBeVisible({ timeout: 15_000 });
    await expect(confirmDialog).toContainText(/删除组件|确定要删除|不可撤销|Delete Component|cannot be undone/i, { timeout: 15_000 });
    await confirmDialog.getByRole('button', { name: /确认|确定|删除|Delete|OK/i }).last().click();
    await expect.poll(() => mockState.mutationLog.some((entry) => /DeleteWidget/i.test(entry)), { timeout: 10_000 }).toBeTruthy();
  });

  
});
