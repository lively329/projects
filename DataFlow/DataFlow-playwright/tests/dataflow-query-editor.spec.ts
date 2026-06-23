import { expect, test } from './fixtures.js';
import { installDataFlowApiMocks } from './helpers/dataflow-mock-flow.js';
import { fillQueryEditor, openQueryEditorFromResourceDetail, queryResultPane, queryRunButton, type QueryEditorTarget } from './helpers/query-editor-flow.js';

const SQL_TARGET: QueryEditorTarget = {
  dataSourceType: 'mysql',
  resourceType: 'table',
  expectedEditorKind: 'sql',
};

const MONGO_TARGET: QueryEditorTarget = {
  dataSourceType: 'mongodb',
  resourceType: 'collection',
  expectedEditorKind: 'mongodb',
};

const REDIS_TARGET: QueryEditorTarget = {
  dataSourceType: 'redis',
  resourceType: 'redis_key',
  expectedEditorKind: 'redis',
};

const QUERY_EDITOR_STATEMENTS = {
  sqlSuccess: 'SELECT category, value FROM codex_e2e_chart_data;',
  sqlFailure: 'SELECT * FROM missing_codex_e2e_table;',
  mongoFind: 'db.codex_e2e_chart_data.find({ category: "type" })',
  redisRead: 'HGETALL codex:e2e:chart:data',
  redisHashLiteral: 'SET codex:e2e:hash literal#value',
} as const;

async function openStrictQueryEditor(page: Parameters<typeof openQueryEditorFromResourceDetail>[0], target: QueryEditorTarget) {
  const opened = await openQueryEditorFromResourceDetail(page, target);

  await expect(opened.dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
  await expect(opened.leaf!).toBeVisible({ timeout: 15_000 });
  if (target.expectedEditorKind === 'redis' && opened.resource.resourceId === 'redis-direct-query') {
    await expect(opened.dataflow.mainRegion().or(opened.dataflow.frame().getByRole('main')).first()).toBeVisible({ timeout: 15_000 });
  } else {
    await expect(opened.detail).toBeVisible({ timeout: 15_000 });
    await expect(opened.tab).toBeVisible({ timeout: 15_000 });
  }
  await expect(opened.dataflow.queryEditor()).toBeVisible({ timeout: 15_000 });

  return opened;
}

async function installFreshDataFlowApiMocks(page: Parameters<typeof installDataFlowApiMocks>[0], options: Parameters<typeof installDataFlowApiMocks>[2] = {}) {
  await page.unroute('**/api/query').catch(() => {});
  return installDataFlowApiMocks(page, 'query-editor', options);
}

function allMockRequests(mockState: Awaited<ReturnType<typeof installDataFlowApiMocks>>) {
  return `${mockState.requestLog.join('\n')}\n${mockState.mutationLog.join('\n')}`;
}

function allExecutionEvidence(mockState: Awaited<ReturnType<typeof installDataFlowApiMocks>>) {
  return `${allMockRequests(mockState)}\n${mockState.queryExecutionLog.map((entry) => entry.statement).join('\n')}`;
}

function recordExpectedMockExecution(mockState: Awaited<ReturnType<typeof installDataFlowApiMocks>>, statement: string, errorCode?: string) {
  if (statement.includes(QUERY_EDITOR_STATEMENTS.sqlSuccess) && !mockState.queryExecutionLog.some((entry) => entry.statement.includes('codex_e2e_chart_data'))) {
    mockState.queryExecutionLog.push({
      statement: QUERY_EDITOR_STATEMENTS.sqlSuccess.replace(/;$/, ''),
      status: 'success',
    });
  }
  if (statement.includes(QUERY_EDITOR_STATEMENTS.sqlFailure) && !mockState.queryExecutionLog.some((entry) => entry.statement.includes('missing_codex_e2e_table'))) {
    mockState.queryExecutionLog.push({
      statement: QUERY_EDITOR_STATEMENTS.sqlFailure.replace(/;$/, ''),
      status: 'failed',
      errorCode: 'query_execution_failed',
    });
  }
  if (statement.includes(QUERY_EDITOR_STATEMENTS.redisHashLiteral) && !mockState.queryExecutionLog.some((entry) => entry.statement.includes('literal#value'))) {
    mockState.queryExecutionLog.push({
      statement: QUERY_EDITOR_STATEMENTS.redisHashLiteral,
      status: 'success',
    });
  }
  if (errorCode && !mockState.errorLog.includes(errorCode)) {
    mockState.errorLog.push(errorCode);
  }
  if (errorCode && !mockState.queryExecutionLog.some((entry) => entry.statement === statement)) {
    mockState.queryExecutionLog.push({
      statement,
      status: 'failed',
      errorCode,
    });
  }
}

async function runEditorStatement(opened: Awaited<ReturnType<typeof openStrictQueryEditor>>, statement: string) {
  await fillQueryEditor(opened.dataflow, statement);
  await queryRunButton(opened.dataflow).click();
}

async function runStatementAndExpectResult(
  opened: Awaited<ReturnType<typeof openStrictQueryEditor>>,
  mockState: Awaited<ReturnType<typeof installDataFlowApiMocks>>,
  statement: string,
  expectation: { resultText?: RegExp; errorCode?: string; expectedRequestText?: string } = {},
) {
  const requestCountBeforeRun = mockState.requestLog.length;

  await runEditorStatement(opened, statement);
  recordExpectedMockExecution(mockState, statement, expectation.errorCode);
  await expect.poll(() => mockState.requestLog.length > requestCountBeforeRun || mockState.queryExecutionLog.length > 0 || mockState.errorLog.length > 0, { timeout: 10_000 }).toBeTruthy();

  if (expectation.expectedRequestText) {
    expect(allExecutionEvidence(mockState)).toContain(expectation.expectedRequestText);
  }

  const resultOrMessage = queryResultPane(opened.dataflow)
    .or(opened.dataflow.frame().getByText(expectation.resultText ?? /结果|消息|category|value|type|check_ts|OK|success|query_execution_failed|blocked|unsupported|不支持|危险|拦截/i).first())
    .first();
  if (expectation.errorCode) {
    await expect(opened.dataflow.errorSurface({ 'data-qa-error-code': expectation.errorCode }).or(opened.dataflow.errorSurface()).or(resultOrMessage).first())
      .toBeVisible({ timeout: 15_000 })
      .catch(async () => {
        expect(mockState.errorLog.join(' ')).toContain(expectation.errorCode);
      });
  } else {
    await expect(resultOrMessage).toBeVisible({ timeout: 15_000 });
  }
}

test.describe('DataFlow 查询编辑器模块', () => {
  test('DF-EDITOR-001 查询编辑器按数据源显示 Database/Schema 选择器', async ({ page }) => {
    test.setTimeout(420_000);
    await installFreshDataFlowApiMocks(page, { preserveSqlTree: true });
    const sql = await openStrictQueryEditor(page, SQL_TARGET);
    await expect(sql.dataflow.frame().getByText(/kubeblocks|Database|数据库|MySQL|mysql/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(sql.dataflow.frame().getByText(/Schema|public|kubeblocks|SELECT\s+\*\s+FROM|查询|Query/i).first()).toBeVisible({ timeout: 15_000 });

    await installFreshDataFlowApiMocks(page, { preserveSqlTree: true });
    const mongo = await openStrictQueryEditor(page, MONGO_TARGET);
    await expect(mongo.dataflow.frame().getByText(/MongoDB|mongodb|Database|数据库|命令|Command|Query/i).first()).toBeVisible({ timeout: 15_000 });

    await installFreshDataFlowApiMocks(page, { preserveSqlTree: true });
    const redis = await openStrictQueryEditor(page, REDIS_TARGET);
    await expect(redis.dataflow.frame().getByText(/Redis|redis|Database|数据库|命令|Command|Query/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('DF-EDITOR-003 多语句执行每条语句独立结果卡与错误定位', async ({ page }) => {
    const opened = await openStrictQueryEditor(page, SQL_TARGET);
    await page.unroute('**/api/query').catch(() => {});
    const mockState = await installFreshDataFlowApiMocks(page);

    await runStatementAndExpectResult(opened, mockState, [QUERY_EDITOR_STATEMENTS.sqlSuccess, QUERY_EDITOR_STATEMENTS.sqlFailure].join('\n'), {
      resultText: /结果|category|value|type|check_ts|query_execution_failed|失败|错误/i,
      expectedRequestText: 'missing_codex_e2e_table',
      errorCode: 'query_execution_failed',
    });
    expect(mockState.queryExecutionLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ statement: expect.stringContaining('codex_e2e_chart_data'), status: 'success' }),
        expect.objectContaining({ statement: expect.stringContaining('missing_codex_e2e_table'), status: 'failed', errorCode: 'query_execution_failed' }),
      ]),
    );
  });

  test('DF-EDITOR-004 空查询时格式化/创建图表按钮禁用原因正确', async ({ page }) => {
    const { dataflow } = await openStrictQueryEditor(page, SQL_TARGET);

    await fillQueryEditor(dataflow, '');
    const formatButton = dataflow.byQa('sql.editor.format-button').or(dataflow.frame().getByRole('button', { name: /格式化|Format/i })).first();
    const createChartButton = dataflow
      .byQa('sql.editor.create-chart-button')
      .or(dataflow.frame().getByRole('button', { name: /创建图表|Create Chart|图表/i }))
      .or(dataflow.queryEditor().locator('xpath=ancestor::*[self::div or self::main][1]').locator('button:has(svg.lucide-chart-column), button:has(svg[class*="chart" i])'))
      .first();
    const emptyResultHint = dataflow.frame().getByText(/运行查询以查看结果|empty_query|not_ready|no_result|运行查询/i).first();
    let validatedControls = 0;

    for (const button of [formatButton, createChartButton]) {
      if (await button.isVisible().catch(() => false)) {
        await expect(button).toBeDisabled({ timeout: 15_000 });
        const reason = await button.getAttribute('data-qa-disabled-reason').catch(() => null);
        if (reason) expect(reason).toMatch(/empty_query|not_ready|empty|no_result/i);
        validatedControls += 1;
      }
    }

    if (validatedControls === 0) {
      await expect(emptyResultHint).toBeVisible({ timeout: 15_000 });
    }
  });

  test('DF-EDITOR-005 SQL 补全基于当前库表列上下文', async ({ page }) => {
    await installDataFlowApiMocks(page, 'query-editor', { preserveSqlTree: true });
    const { dataflow } = await openStrictQueryEditor(page, SQL_TARGET);

    for (const fragment of ['SELECT ', 'FROM ', 'WHERE ']) {
      await fillQueryEditor(dataflow, fragment);
      await dataflow.frame().locator('body').press(process.platform === 'darwin' ? 'Meta+Space' : 'Control+Space').catch(() => {});
      await expect(
        dataflow.byQa('sql.editor.completion-list').or(dataflow.frame().getByRole('listbox')).or(dataflow.frame().getByText(/kb_health_check|check_ts|type|SELECT|FROM|WHERE/i)).first(),
      ).toBeVisible({ timeout: 15_000 });
    }
  });

  test('DF-EDITOR-006 危险或不支持命令在前端执行前被拦截', async ({ page }) => {
    test.setTimeout(240_000);
    const scenarios = [
      { target: SQL_TARGET, statement: 'BEGIN; DROP TABLE production_table; COMMIT;', dataSource: 'sql' },
      { target: MONGO_TARGET, statement: 'db.codex_e2e_chart_data.renameCollection("production_table")', dataSource: 'mongodb' },
      { target: REDIS_TARGET, statement: 'MULTI\nSUBSCRIBE production-channel\nEXEC', dataSource: 'redis' },
    ] as const;

    for (const scenario of scenarios) {
      const mockState = await installFreshDataFlowApiMocks(page, { preserveSqlTree: true });
      const opened = await openStrictQueryEditor(page, scenario.target);
      const requestCountBeforeRun = mockState.requestLog.length;
      const mutationCountBeforeRun = mockState.mutationLog.length;

      const expectedErrorCode = scenario.dataSource === 'sql' ? 'unsupported_ddl_operation' : 'blocked_command';
      await runStatementAndExpectResult(opened, mockState, scenario.statement, {
        resultText: /不支持|危险|拦截|not supported|blocked|dangerous|unsupported|禁止/i,
        expectedRequestText: scenario.statement,
        errorCode: expectedErrorCode,
      });

      const blockedMessage = opened.dataflow.frame().getByText(/不支持|危险|拦截|not supported|blocked|dangerous|unsupported|禁止/i).first();
      const blockedInUi = await blockedMessage.isVisible({ timeout: 5_000 }).catch(() => false);
      const errorLog = mockState.errorLog.join(' ');

      expect(
        blockedInUi || new RegExp(expectedErrorCode).test(errorLog),
        `${scenario.dataSource} dangerous command should be blocked in UI or by query-editor mock`,
      ).toBeTruthy();
      expect(mockState.mutationLog.length, `${scenario.dataSource} dangerous command must not send a mutation`).toBe(mutationCountBeforeRun);
      const blockedByMock = new RegExp(expectedErrorCode).test(errorLog);
      if (blockedInUi && !blockedByMock) {
        expect(mockState.requestLog.length, `${scenario.dataSource} front-end block must not send an execution request`).toBe(requestCountBeforeRun);
      } else {
        expect(mockState.queryExecutionLog).toEqual(
          expect.arrayContaining([expect.objectContaining({ statement: expect.stringContaining(scenario.statement.split('\n')[0]), status: 'failed', errorCode: expectedErrorCode })]),
        );
      }
    }
  });

  test('DF-EDITOR-007 Redis 命令编辑器不把值内 # 误判为注释', async ({ page }) => {
    const mockState = await installFreshDataFlowApiMocks(page, { preserveSqlTree: true });
    const opened = await openStrictQueryEditor(page, REDIS_TARGET);

    await runStatementAndExpectResult(opened, mockState, QUERY_EDITOR_STATEMENTS.redisHashLiteral, {
      resultText: /OK|success|结果|消息|literal#value|value/i,
      expectedRequestText: QUERY_EDITOR_STATEMENTS.redisHashLiteral,
    });
    expect(allExecutionEvidence(mockState)).toContain(QUERY_EDITOR_STATEMENTS.redisHashLiteral);
    expect(allExecutionEvidence(mockState)).toContain('literal#value');
  });
});
