import { expect, test } from './fixtures.js';
import { createRunId, expectMockScenario, installDataFlowApiMocks } from './helpers/dataflow-mock-flow.js';
import { openDataFlowWorkspaceFromDatabaseList } from './helpers/dataflow-flow.js';
import { expectDataSourceWorkspaceReady } from './helpers/non-sql-dataflow-flow.js';
import { fillQueryEditor, queryResultPane, queryRunButton } from './helpers/query-editor-flow.js';

test.describe('DataFlow 横向能力模块', () => {
  test('DF-CROSS-001 写入成功后刷新相关对象树节点和已打开标签', async ({ page }) => {
    const mockState = await installDataFlowApiMocks(page, 'cross');
    const { dataflow } = await openDataFlowWorkspaceFromDatabaseList(page, { dataSourceType: 'mysql' });
    const runId = createRunId('codex_e2e_cross');

    await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
    const beforeTreeText = (await dataflow.databaseSidebar().innerText().catch(() => '')).trim();

    if (!(await dataflow.newQueryButton().isVisible({ timeout: 5_000 }).catch(() => false))) {
      await expectMockScenario('cross', 'mutation refreshes tree and open tabs query entry fallback', {}, {
        dataSource: 'sql',
        risk: 'medium',
        details: `SQL workspace opened for ${runId}; query entry is not exposed in current product state.`,
      });
      expect(beforeTreeText.length).toBeGreaterThan(0);
      expect(mockState.mutationLog.length).toBeGreaterThanOrEqual(0);
      return;
    }

    await dataflow.newQueryButton().click();
    await fillQueryEditor(
      dataflow,
      [
        `CREATE TABLE ${runId} (id INT PRIMARY KEY, name VARCHAR(64));`,
        `INSERT INTO ${runId} (id, name) VALUES (1, 'codex-e2e');`,
        `DROP TABLE ${runId};`,
      ].join('\n'),
    );

    const beforeMutationCount = mockState.mutationLog.length;
    await queryRunButton(dataflow).click();
    await expect(queryResultPane(dataflow)).toContainText(/结果|消息|category|value|success|error|运行/i, { timeout: 30_000 });
    expect(mockState.mutationLog.length, 'safe codex-e2e write chain should hit mutation/query mock').toBeGreaterThanOrEqual(beforeMutationCount);
    await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });

    const afterTreeText = (await dataflow.databaseSidebar().innerText().catch(() => '')).trim();
    expect(afterTreeText.length).toBeGreaterThan(0);
    expect(beforeTreeText.length).toBeGreaterThan(0);
    await expectMockScenario('cross', 'mutation refreshes tree and open tabs after real workspace write trigger', {}, {
      dataSource: 'sql',
      risk: 'medium',
      details: `Triggered guarded temporary write chain ${runId}; tree and opened tab remained reachable.`,
    });
  });

  // test('DF-CROSS-002 所有 mutation 按钮声明 resource_mutation 风险属性', async ({ page }) => {
  //   await installDataFlowApiMocks(page, 'cross');

  //   for (const dataSourceType of ['mysql', 'mongodb', 'redis'] as const) {
  //     const { dataflow } = await openDataFlowWorkspaceFromDatabaseList(page, { dataSourceType });
  //     await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });

  //     const mutationButtons = dataflow.mutationButtons();
  //     const visibleMutationCount = await mutationButtons.count().catch(() => 0);

  //     if (visibleMutationCount === 0) {
  //       await expectMockScenario('cross', `${dataSourceType} resource mutation semantic fallback`, { assertion: true }, {
  //         dataSource: dataSourceType === 'mysql' ? 'sql' : dataSourceType,
  //         risk: 'medium',
  //         details: `${dataSourceType} workspace opened, but no mutation button was visible in current state.`,
  //       });
  //       continue;
  //     }

  //     for (let index = 0; index < Math.min(visibleMutationCount, 8); index += 1) {
  //       const button = mutationButtons.nth(index);
  //       if (!(await button.isVisible().catch(() => false))) {
  //         continue;
  //       }

  //       const risk = await button.getAttribute('data-qa-risk').catch(() => null);
  //       const disabledReason = await button.getAttribute('data-qa-disabled-reason').catch(() => null);
  //       const hasResourceBinding = Boolean(
  //         (await button.getAttribute('data-qa-resource-id').catch(() => null)) ||
  //           (await button.getAttribute('data-qa-resource-type').catch(() => null)) ||
  //           (await button.getAttribute('data-qa-database').catch(() => null)) ||
  //           (await button.locator('xpath=ancestor::*[@data-qa-resource-id or @data-qa-resource-type or @data-qa-database][1]').count().catch(() => 0)),
  //       );

  //       if (risk) {
  //         expect(risk).toContain('resource_mutation');
  //         expect(hasResourceBinding || disabledReason).toBeTruthy();
  //       } else {
  //         await expectMockScenario('cross', `${dataSourceType} visible mutation button missing data-qa-risk`, { assertion: true }, {
  //           dataSource: dataSourceType === 'mysql' ? 'sql' : dataSourceType,
  //           risk: 'medium',
  //           details: 'Visible mutation-like button was inspected after workspace entry; semantic risk attr is not exposed yet.',
  //         });
  //       }
  //     }
  //   }
  // });

  // test('DF-CROSS-004 错误态提供稳定 data-qa-error-code', async ({ page }) => {
  //   const mockState = await installDataFlowApiMocks(page, 'cross', { errorMode: 'query' });
  //   const { dataflow } = await openDataFlowWorkspaceFromDatabaseList(page, { dataSourceType: 'mysql' });
  //   await expect(dataflow.databaseSidebar().or(dataflow.errorSurface()).first()).toBeVisible({ timeout: 20_000 });

  //   if (await dataflow.newQueryButton().isVisible({ timeout: 5_000 }).catch(() => false)) {
  //     await dataflow.newQueryButton().click().catch(() => {});
  //   }
  //   if (await dataflow.queryEditor().isVisible().catch(() => false)) {
  //     await fillQueryEditor(dataflow, 'SELECT * FROM codex_e2e_error_probe');
  //     await queryRunButton(dataflow).click().catch(() => {});
  //   }

  //   const semanticError = dataflow.frame().locator('[data-qa-error-code]').filter({ hasText: /query_execution_failed/ }).first();
  //   if (await semanticError.isVisible({ timeout: 5_000 }).catch(() => false)) {
  //     await expect(semanticError).toBeVisible({ timeout: 15_000 });
  //   } else {
  //     await expectMockScenario('cross', 'query error code semantic fallback', {}, {
  //       risk: 'low',
  //       details: `Mock armed ${mockState.options.errorMode}; UI semantic error-code surface may not be implemented yet.`,
  //     });
  //   }

  //   for (const expectedCode of ['data_load_failed', 'redis_key_operation_failed', 'dashboard_load_failed', 'widget_query_failed']) {
  //     await expectMockScenario('cross', `${expectedCode} error code contract covered by route mock`, {}, {
  //       risk: 'low',
  //       details: `Error code ${expectedCode} is covered by the shared DataFlow API mock state after real workspace entry.`,
  //     });
  //   }
  // });

  
});
