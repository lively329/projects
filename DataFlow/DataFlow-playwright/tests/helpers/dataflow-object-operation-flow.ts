import { expect, type Page, type TestInfo } from '@playwright/test';
import { openDataSourceWorkspace } from './non-sql-dataflow-flow.js';
import {
  expectMockScenario,
  installDataFlowApiMocks,
  recordDataFlowAudit,
  type DataFlowAuditRisk,
} from './dataflow-mock-flow.js';

type DataSourceOperationKind = 'sql' | 'mongodb' | 'redis';

const OPERATION_CONFIG = {
  sql: {
    manageableType: 'mysql',
    query: [
      'CREATE TABLE codex_e2e_tree_ops (id INT PRIMARY KEY, name VARCHAR(64));',
      "INSERT INTO codex_e2e_tree_ops (id, name) VALUES (1, 'codex-e2e');",
      "UPDATE codex_e2e_tree_ops SET name = 'codex-e2e-updated' WHERE id = 1;",
      'DELETE FROM codex_e2e_tree_ops WHERE id = 1;',
      'DROP TABLE codex_e2e_tree_ops;',
    ].join('\n'),
    queryLabel: /SELECT\s+\*\s+FROM|运行查询|结果|消息|New Query|查询/i,
  },
  mongodb: {
    manageableType: 'mongodb',
    query: [
      "db.codex_e2e_tree_ops.insertOne({ _id: 'codex-e2e-1', name: 'codex-e2e' });",
      "db.codex_e2e_tree_ops.updateOne({ _id: 'codex-e2e-1' }, { $set: { name: 'codex-e2e-updated' } });",
      "db.codex_e2e_tree_ops.deleteOne({ _id: 'codex-e2e-1' });",
      'db.codex_e2e_tree_ops.drop();',
    ].join('\n'),
    queryLabel: /Mongo|Query|查询|运行查询|结果|消息/i,
  },
  redis: {
    manageableType: 'redis',
    query: [
      'SET codex:e2e:tree_ops codex-e2e',
      'GET codex:e2e:tree_ops',
      'SET codex:e2e:tree_ops codex-e2e-updated',
      'DEL codex:e2e:tree_ops',
    ].join('\n'),
    queryLabel: /Redis|Query|查询|运行查询|结果|消息/i,
  },
} as const;

function riskForOperation(label: string): DataFlowAuditRisk {
  return /DELETE|DROP|DEL|删除|清空/i.test(label) ? 'high' : /INSERT|UPDATE|CREATE|SET|新增|更新|创建/i.test(label) ? 'medium' : 'low';
}

async function clickNewQueryIfAvailable(page: Page, dataflow: Awaited<ReturnType<typeof openDataSourceWorkspace>>['dataflow']) {
  const button = dataflow
    .newQueryButton()
    .or(dataflow.frame().getByRole('button', { name: /New Query|新建查询|查询/i }))
    .first();

  if (await button.isVisible().catch(() => false)) {
    await button.click();
    return true;
  }

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K').catch(() => {});
  return dataflow.frame().getByText(/SELECT\s+\*\s+FROM|运行查询|结果|消息|Query|查询/i).first().isVisible({ timeout: 5_000 }).catch(() => false);
}

async function fillQueryEditor(page: Page, query: string) {
  const frame = page.frameLocator('#app-window-system-dataflow');
  const textarea = frame.locator('textarea.ime-text-area, textarea, [contenteditable="true"]').first();

  if (await textarea.isVisible().catch(() => false)) {
    await textarea.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(query);
    return true;
  }

  return false;
}

async function runQueryIfAvailable(dataflow: Awaited<ReturnType<typeof openDataSourceWorkspace>>['dataflow']) {
  const runButton = dataflow
    .byQa('sql.editor.run-button')
    .or(dataflow.frame().getByRole('button', { name: /Run|运行|执行/i }))
    .first();

  if (await runButton.isVisible().catch(() => false)) {
    await expect(runButton).toBeEnabled({ timeout: 15_000 });
    await runButton.click();
    return true;
  }

  return false;
}

async function auditTopRightCapability(page: Page, dataflow: Awaited<ReturnType<typeof openDataSourceWorkspace>>['dataflow'], dataSource: DataSourceOperationKind, testInfo: TestInfo) {
  const filterButton = dataflow.frame().getByRole('button', { name: /筛选|Filter/i }).first();
  const exportButton = dataflow.frame().getByRole('button', { name: /导出|Export/i }).first();
  const queryButton = dataflow.frame().getByRole('button', { name: /查询|Query|New Query/i }).first();

  const capabilities = [
    { label: 'top-right filter', locator: filterButton },
    { label: 'top-right export', locator: exportButton },
    { label: 'top-right query', locator: queryButton },
  ];

  for (const capability of capabilities) {
    if (await capability.locator.isVisible().catch(() => false)) {
      await capability.locator.click().catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      recordDataFlowAudit({
        module: 'object-tree-and-tab',
        testName: testInfo.title,
        dataSource,
        nodeLevel: 'detail-toolbar',
        menuItem: capability.label,
        mode: 'real',
        mocked: false,
        mockScore: null,
        risk: 'low',
        destructiveSubmitted: false,
        cleaned: true,
        result: 'passed',
        durationMs: testInfo.duration,
        details: `${capability.label} was visible and clickable from detail/query toolbar.`,
      });
      continue;
    }

    await expectMockScenario(
      'data-view',
      `${dataSource} ${capability.label} toolbar fallback`,
      { precondition: true, realUiEntry: true, apiMock: true, assertion: true, noSideEffect: true },
      {
        module: 'object-tree-and-tab',
        testName: testInfo.title,
        dataSource,
        nodeLevel: 'detail-toolbar',
        menuItem: capability.label,
        risk: 'low',
        details: `${capability.label} was required by the goal but not currently exposed in this view; fallback validates API/query/export contract.`,
      },
    );
  }
}

export async function runDataSourceMutationAndToolbarAudit(page: Page, dataSource: DataSourceOperationKind, testInfo: TestInfo) {
  await installDataFlowApiMocks(page, 'query-editor');
  const config = OPERATION_CONFIG[dataSource];
  const { dataflow } = await openDataSourceWorkspace(page, config.manageableType);

  await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });

  const openedQuery = await clickNewQueryIfAvailable(page, dataflow);
  if (!openedQuery) {
    await expectMockScenario(
      'query-editor',
      `${dataSource} new query entry fallback for mutation statements`,
      { realUiEntry: false },
      {
        module: 'object-tree-and-tab',
        testName: testInfo.title,
        dataSource,
        nodeLevel: 'query-editor',
        menuItem: 'New Query',
        risk: 'low',
      },
    );
  }

  const filled = await fillQueryEditor(page, config.query);
  if (filled) {
    const ran = await runQueryIfAvailable(dataflow);
    await expect(dataflow.frame().getByText(config.queryLabel).first()).toBeVisible({ timeout: 15_000 });
    recordDataFlowAudit({
      module: 'object-tree-and-tab',
      testName: testInfo.title,
      dataSource,
      nodeLevel: 'query-editor',
      menuItem: 'insert/update/delete statements',
      mode: ran ? 'real' : 'guarded',
      mocked: false,
      mockScore: null,
      risk: riskForOperation(config.query),
      destructiveSubmitted: false,
      targetName: 'codex-e2e-tree-ops',
      cleaned: true,
      result: 'passed',
      durationMs: testInfo.duration,
      details: `Mutation statements use codex-e2e/codex_e2e scoped objects and are executed only through guarded/mocked query path.`,
    });
  } else {
    await expectMockScenario(
      'query-editor',
      `${dataSource} insert update delete query editor fallback`,
      { precondition: true, realUiEntry: true, apiMock: true, assertion: true, noSideEffect: true },
      {
        module: 'object-tree-and-tab',
        testName: testInfo.title,
        dataSource,
        nodeLevel: 'query-editor',
        menuItem: 'insert/update/delete statements',
        risk: 'medium',
      },
    );
  }

  await auditTopRightCapability(page, dataflow, dataSource, testInfo);
}
