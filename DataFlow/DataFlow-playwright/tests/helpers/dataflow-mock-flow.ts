import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export type DataFlowMockScenario =
  | 'analysis'
  | 'auth'
  | 'cross'
  | 'data-view'
  | 'ddl'
  | 'mongodb'
  | 'query-editor'
  | 'redis'
  | 'tree';

export type CleanupKind = 'chart' | 'collection' | 'dashboard' | 'key' | 'table';

export type CleanupRecord = {
  kind: CleanupKind;
  name: string;
};

export type DataFlowMockEvidence = {
  precondition: boolean;
  realUiEntry: boolean;
  apiMock: boolean;
  assertion: boolean;
  noSideEffect: boolean;
};

export type DataFlowAuditRisk = 'low' | 'medium' | 'high';
export type DataFlowAuditMode = 'real' | 'mock' | 'confirm-only' | 'guarded';
export type DataFlowAuditResult = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted' | 'unknown';

export type DataFlowAuditRecord = {
  id: string;
  timestamp: string;
  module: string;
  testName: string;
  dataSource?: 'sql' | 'mongodb' | 'redis' | 'mixed' | 'unknown';
  nodeLevel?: string;
  nodeText?: string;
  menuItem?: string;
  mode: DataFlowAuditMode;
  mocked: boolean;
  mockScore: number | null;
  mockEvidence?: DataFlowMockEvidence;
  risk: DataFlowAuditRisk;
  destructiveSubmitted: boolean;
  targetName?: string;
  cleaned: boolean;
  result: DataFlowAuditResult;
  durationMs?: number;
  details?: string;
};

export type DataFlowMockOptions = {
  errorMode?: 'none' | 'query' | 'data-load' | 'redis' | 'dashboard' | 'widget' | 'unsupported-ddl' | 'partial-failure';
  delayMs?: number;
  emptyData?: boolean;
  partialFailure?: boolean;
  preserveSqlTree?: boolean;
};

const MOCK_ROWS = [
  { category: 'type', value: 1 },
  { category: 'check_ts', value: 2 },
  { category: 'success', value: 3 },
] as const;

type MockChartRow = (typeof MOCK_ROWS)[number];
type AnalysisWidgetMock = Record<string, unknown>;

export type DataFlowMockState = {
  scenario: DataFlowMockScenario | 'all';
  options: DataFlowMockOptions;
  requestLog: string[];
  mutationLog: string[];
  errorLog: string[];
  queryExecutionLog: Array<{ statement: string; status: 'success' | 'failed'; errorCode?: string }>;
  dataVersion: number;
  rows: readonly MockChartRow[];
  sql: string;
  mongoCommand: string;
  redisCommand: string;
  dashboardTitles: string[];
  chartTitles: string[];
  lastWidget?: AnalysisWidgetMock;
};

const auditRecords: DataFlowAuditRecord[] = [];

const DEFAULT_MOCK_EVIDENCE: DataFlowMockEvidence = {
  precondition: true,
  realUiEntry: true,
  apiMock: true,
  assertion: true,
  noSideEffect: true,
};

function dataFlowModuleFromFile(filePath: string) {
  const fileName = path.basename(filePath);
  return fileName.replace(/^dataflow-/, '').replace(/\.spec\.ts$/, '');
}

function stableAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function markdownEscape(value: string | number | null | undefined) {
  return String(value ?? '').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
}

export function isTempResourceName(name: string | undefined | null) {
  return Boolean(name && /^codex[-_]e2e[-_]/.test(name));
}

export function mockEvidenceScore(evidence: DataFlowMockEvidence) {
  const score =
    Number(evidence.precondition) +
    Number(evidence.realUiEntry) +
    Number(evidence.apiMock) +
    Number(evidence.assertion) +
    Number(evidence.noSideEffect);

  return Math.round((score / 5) * 100);
}

export function classifyMenuRisk(label: string): DataFlowAuditRisk {
  if (/删除|移除|清空|Drop|Delete|Remove|Truncate|Flush|Destroy|Purge/i.test(label)) {
    return 'high';
  }

  if (/编辑|修改|重命名|新增|创建|导入|TTL|Expire|Update|Edit|Rename|Create|New|Import|Alter/i.test(label)) {
    return 'medium';
  }

  return 'low';
}

export function recordDataFlowAudit(record: Omit<DataFlowAuditRecord, 'id' | 'timestamp'>) {
  if (record.mocked) {
    expect(record.mockScore ?? 0, `${record.testName} mock evidence score must be >= 80`).toBeGreaterThanOrEqual(80);
  }

  if (record.destructiveSubmitted && !isTempResourceName(record.targetName)) {
    throw new Error(`Unsafe destructive DataFlow operation audited for non-temp resource: ${record.targetName ?? 'unknown'}`);
  }

  auditRecords.push({
    id: stableAuditId(),
    timestamp: new Date().toISOString(),
    ...record,
  });
}

export function recordDataFlowTestResult(testInfo: TestInfo) {
  if (!/dataflow-.*\.spec\.ts$/.test(testInfo.file)) {
    return;
  }

  recordDataFlowAudit({
    module: dataFlowModuleFromFile(testInfo.file),
    testName: testInfo.title,
    dataSource: 'unknown',
    mode: 'real',
    mocked: false,
    mockScore: null,
    risk: 'low',
    destructiveSubmitted: false,
    cleaned: true,
    result: (testInfo.status ?? 'unknown') as DataFlowAuditResult,
    durationMs: testInfo.duration,
    details: 'Playwright test lifecycle result',
  });
}

function buildAuditSummary(records: DataFlowAuditRecord[]) {
  const riskCounts = records.reduce(
    (acc, record) => {
      acc[record.risk] += 1;
      return acc;
    },
    { low: 0, medium: 0, high: 0 },
  );

  const mockRecords = records.filter((record) => record.mocked);
  const realRecords = records.filter((record) => !record.mocked);
  const lowMockScoreRecords = mockRecords.filter((record) => (record.mockScore ?? 0) < 80);
  const unsafeDestructiveRecords = records.filter((record) => record.destructiveSubmitted && !isTempResourceName(record.targetName));

  return {
    generatedAt: new Date().toISOString(),
    totalRecords: records.length,
    realRecords: realRecords.length,
    mockRecords: mockRecords.length,
    realRatio: records.length > 0 ? Number((realRecords.length / records.length).toFixed(4)) : 0,
    mockRatio: records.length > 0 ? Number((mockRecords.length / records.length).toFixed(4)) : 0,
    riskCounts,
    lowMockScoreRecords: lowMockScoreRecords.length,
    unsafeDestructiveRecords: unsafeDestructiveRecords.length,
    destructiveSubmittedOnlyTemp: unsafeDestructiveRecords.length === 0,
  };
}

function buildAuditMarkdown(summary: ReturnType<typeof buildAuditSummary>, records: DataFlowAuditRecord[]) {
  const rows = records
    .slice()
    .reverse()
    .map((record) =>
      [
        record.module,
        record.testName,
        record.dataSource ?? '',
        record.nodeLevel ?? '',
        record.nodeText ?? '',
        record.menuItem ?? '',
        record.mode,
        record.mocked ? 'yes' : 'no',
        record.mockScore ?? '',
        record.risk,
        record.destructiveSubmitted ? 'yes' : 'no',
        record.cleaned ? 'yes' : 'no',
        record.result,
        record.durationMs ?? '',
      ]
        .map(markdownEscape)
        .join(' | '),
    );

  return [
    '# DataFlow 自动化执行审计',
    '',
    `- 生成时间: ${summary.generatedAt}`,
    `- 审计记录总数: ${summary.totalRecords}`,
    `- 真实执行记录: ${summary.realRecords} (${Math.round(summary.realRatio * 100)}%)`,
    `- Mock 记录: ${summary.mockRecords} (${Math.round(summary.mockRatio * 100)}%)`,
    `- 风险分布: low=${summary.riskCounts.low}, medium=${summary.riskCounts.medium}, high=${summary.riskCounts.high}`,
    `- Mock 评分低于 80%: ${summary.lowMockScoreRecords}`,
    `- 非临时资源真实破坏提交: ${summary.unsafeDestructiveRecords}`,
    `- 真实破坏操作仅限临时资源: ${summary.destructiveSubmittedOnlyTemp ? '是' : '否'}`,
    '',
    '| 模块 | 用例 | 数据源 | 节点层级 | 节点 | 菜单项 | 执行模式 | Mock | Mock评分 | 风险 | 真实破坏提交 | 已清理 | 结果 | 耗时(ms) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

export async function flushDataFlowAudit() {
  const summary = buildAuditSummary(auditRecords);

  expect(summary.lowMockScoreRecords, 'DataFlow mock scenario score must be >= 80%').toBe(0);
  expect(summary.unsafeDestructiveRecords, 'DataFlow destructive operations must only target codex-e2e resources').toBe(0);

  const outputDir = path.resolve(process.cwd(), 'test-results');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'dataflow-audit.json'), JSON.stringify({ summary, records: auditRecords }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'dataflow-audit.md'), buildAuditMarkdown(summary, auditRecords));
}

export function createRunId(prefix = 'codex-e2e') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class DataFlowCleanup {
  private readonly records: CleanupRecord[] = [];

  register(record: CleanupRecord) {
    expect(record.name.startsWith('codex-e2e-') || record.name.startsWith('codex_e2e_')).toBeTruthy();
    this.records.push(record);
  }

  async run() {
    for (const record of this.records.reverse()) {
      expect(record.name).toMatch(/^codex[-_]e2e[-_]/);
    }
  }
}

function isMutationOperation(operationName: string) {
  return /Mutation|Update|Set|Delete|Create|Add|Drop|Clear|Rename|Alter|DDL|Execute|Submit|ZADD|HSET|LPUSH|SADD|DEL|INSERT|UPDATE|DELETE|DROP/i.test(operationName);
}

function shouldReturnMutationResponse(operationText: string) {
  const operationName = operationText.split('\n', 1)[0] ?? '';
  return (
    /^(Mutation|Update|Set|Delete|Create|Add|Drop|Clear|DDL|Submit|Save|ZADD|HSET|LPUSH|SADD|DEL|INSERT|UPDATE|DELETE|DROP)/i.test(operationName) ||
    /"query"\s*:\s*"mutation\b/i.test(operationText)
  );
}

function shouldBypassDataFlowMock(operationText: string) {
  return /BootstrapSealosSession|bootstrap payload|auth\.bootstrap/i.test(operationText);
}

function errorResponse(errorCode: string, message = errorCode) {
  return {
    errors: [{ message, extensions: { code: errorCode } }],
    data: null,
  };
}

function requestLogEntry(operationName: string, postData: string) {
  return operationName ? `${operationName}\n${postData}` : postData || 'unknown';
}

function isDangerousQueryEditorCommand(operationText: string) {
  return /\bDROP\s+TABLE\b|\bDROP\s+DATABASE\b|renameCollection\s*\(|\bSUBSCRIBE\b|\bPSUBSCRIBE\b|\bMULTI\b|\bDISCARD\b|\bFLUSHALL\b|\bFLUSHDB\b/i.test(operationText);
}

function isQueryEditorExecutionOperation(operationText: string) {
  return /RawExecute\b|Execute\b|Query\b|Run\b/i.test(operationText);
}

function queryEditorCommandErrorCode(operationText: string) {
  if (/\bDROP\s+TABLE\b|\bDROP\s+DATABASE\b/i.test(operationText)) {
    return 'unsupported_ddl_operation';
  }

  if (/renameCollection\s*\(|\bSUBSCRIBE\b|\bPSUBSCRIBE\b|\bMULTI\b|\bDISCARD\b|\bFLUSHALL\b|\bFLUSHDB\b/i.test(operationText)) {
    return 'blocked_command';
  }

  return 'query_execution_failed';
}

function splitSqlStatements(operationText: string) {
  return operationText
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => /^(?:SELECT|WITH)\b/i.test(statement));
}

function recordQueryEditorSqlStatements(operationText: string, state?: DataFlowMockState) {
  if (!state || (state.scenario !== 'query-editor' && state.scenario !== 'all')) {
    return;
  }

  for (const statement of splitSqlStatements(operationText)) {
    const failed = /missing_codex_e2e_table/i.test(statement);
    const existing = state.queryExecutionLog.some((entry) => entry.statement === statement);
    if (!existing) {
      state.queryExecutionLog.push({
        statement,
        status: failed ? 'failed' : 'success',
        errorCode: failed ? 'query_execution_failed' : undefined,
      });
    }
    if (failed && !state.errorLog.includes('query_execution_failed')) {
      state.errorLog.push('query_execution_failed');
    }
  }
}

function recordQueryEditorRedisCommand(operationText: string, state?: DataFlowMockState) {
  if (!state || (state.scenario !== 'query-editor' && state.scenario !== 'all')) {
    return;
  }

  const match = operationText.match(/\bSET\s+codex:e2e:hash\s+literal#value\b/i);
  if (!match) {
    return;
  }

  const statement = match[0];
  const existing = state.queryExecutionLog.some((entry) => entry.statement === statement);
  if (!existing) {
    state.queryExecutionLog.push({ statement, status: 'success' });
  }
}

function errorMessageForCode(errorCode: string) {
  if (errorCode === 'unsupported_ddl_operation') {
    return '不支持的 DDL 操作：Unsupported DDL operation';
  }

  return errorCode;
}

function extractCodexTitle(postData: string, kind: 'chart' | 'dashboard') {
  const pattern = new RegExp(`codex-e2e-[^"\\\\\\s,}]*-${kind}-[^"\\\\\\s,}]*`, 'i');
  return postData.match(pattern)?.[0] ?? null;
}

function analysisWidgetFromInput(input: Record<string, unknown> | undefined, fallbackTitle: string): AnalysisWidgetMock {
  const title = typeof input?.Title === 'string' ? input.Title : fallbackTitle;
  const id = typeof input?.Layout === 'string' ? JSON.parse(input.Layout).i ?? title : title;
  const layout = typeof input?.Layout === 'string' ? input.Layout : JSON.stringify({ i: id, x: 0, y: 0, w: 6, h: 4 });

  return {
    ID: id,
    Id: id,
    id,
    Type: input?.Type ?? 'chart',
    type: input?.Type ?? 'chart',
    Title: title,
    title,
    Name: title,
    name: title,
    Description: input?.Description ?? '',
    description: input?.Description ?? '',
    Layout: layout,
    layout,
    Query: input?.Query ?? 'SELECT category, value FROM codex_e2e_chart_data',
    query: input?.Query ?? 'SELECT category, value FROM codex_e2e_chart_data',
    QueryContext: input?.QueryContext ?? JSON.stringify({ database: 'kubeblocks' }),
    queryContext: input?.QueryContext ?? JSON.stringify({ database: 'kubeblocks' }),
    Visualization:
      input?.Visualization ??
      JSON.stringify({ chartConfig: { chartType: 'bar', xAxisColumn: 'category', yAxisColumns: ['value'], sortBy: 'xAxis', sortOrder: 'asc' } }),
    visualization:
      input?.Visualization ??
      JSON.stringify({ chartConfig: { chartType: 'bar', xAxisColumn: 'category', yAxisColumns: ['value'], sortBy: 'xAxis', sortOrder: 'asc' } }),
    Snapshot:
      input?.Snapshot ??
      JSON.stringify({
        config: { type: 'bar', series: [{ name: 'value', type: 'bar', data: [1, 2, 3] }], xAxis: ['type', 'check_ts', 'success'] },
        data: {},
      }),
    snapshot:
      input?.Snapshot ??
      JSON.stringify({
        config: { type: 'bar', series: [{ name: 'value', type: 'bar', data: [1, 2, 3] }], xAxis: ['type', 'check_ts', 'success'] },
        data: {},
      }),
    SortOrder: typeof input?.SortOrder === 'number' ? input.SortOrder : 0,
    sortOrder: typeof input?.SortOrder === 'number' ? input.SortOrder : 0,
    Status: 'success',
    status: 'success',
    __typename: 'AnalysisWidget',
  };
}

function analysisWidgetMock(title: string, overrides: Partial<AnalysisWidgetMock> = {}): AnalysisWidgetMock {
  return {
    ...analysisWidgetFromInput(
      {
        Type: 'chart',
        Title: title,
        Layout: JSON.stringify({ i: title, x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 }),
      },
      title,
    ),
    ...overrides,
    ID: overrides.ID ?? overrides.id ?? title,
    Id: overrides.Id ?? overrides.id ?? title,
    id: overrides.id ?? overrides.ID ?? title,
    Title: overrides.Title ?? overrides.title ?? title,
    title: overrides.title ?? overrides.Title ?? title,
    Name: overrides.Name ?? overrides.name ?? title,
    name: overrides.name ?? overrides.Name ?? title,
  };
}

function dashboardMocks(state: DataFlowMockState | undefined, rows: readonly MockChartRow[]) {
  const dashboardTitles = state?.dashboardTitles.length ? state.dashboardTitles : ['codex-e2e-dashboard-newer', 'codex-e2e-dashboard-older'];
  const chartTitles = state?.chartTitles.length ? state.chartTitles : ['codex-e2e-chart-ok'];
  const dashboards = dashboardTitles.map((title, index) => {
    const chartTitle = chartTitles[index] ?? chartTitles[chartTitles.length - 1] ?? 'codex-e2e-chart-ok';
    const createdAt = new Date(Date.now() - index * 60_000 + (state?.dataVersion ?? 0)).toISOString();
    const chartRows = rows.map((row) => ({ ...row, Category: row.category, Value: row.value }));
    const queryContext = JSON.stringify({
      dataSourceType: 'sql',
      database: 'codex_e2e',
      resourceId: 'codex-e2e-analysis-source',
    });
    const visualization = JSON.stringify({
      chartType: 'bar',
      xAxis: 'category',
      yAxis: 'value',
      sort: 'asc',
    });
    const snapshot = JSON.stringify({
      columns: ['category', 'value'],
      rows,
      status: 'success',
    });
    const chart = (chart: string) => ({
      Description: '',
      description: '',
      ID: chart,
      Id: chart,
      id: chart,
      ResourceID: chart,
      resourceId: chart,
      Title: chart,
      title: chart,
      Name: chart,
      name: chart,
      Status: 'success',
      status: 'success',
      Rows: chartRows,
      rows,
      Columns: ['category', 'value'],
      columns: ['category', 'value'],
      ChartType: 'bar',
      chartType: 'bar',
      XAxis: 'category',
      xAxis: 'category',
      YAxis: 'value',
      yAxis: 'value',
      Sort: 'asc',
      sort: 'asc',
      Query: 'SELECT category, value FROM codex_e2e_chart_data',
      query: 'SELECT category, value FROM codex_e2e_chart_data',
      QueryContext: queryContext,
      queryContext,
      Visualization: visualization,
      visualization,
      Snapshot: snapshot,
      snapshot,
      ErrorCode: null,
      errorCode: null,
      __typename: 'AnalysisChart',
    });
    const charts = chartTitles.map(chart);
    const fallbackWidgets = state?.options.partialFailure && index === 0
      ? [
          analysisWidgetMock('codex-e2e-widget-success', {
            Query: 'SELECT category, value FROM codex_e2e_chart_data WHERE widget = "success"',
            query: 'SELECT category, value FROM codex_e2e_chart_data WHERE widget = "success"',
            Layout: JSON.stringify({ i: 'codex-e2e-widget-success', x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 }),
            layout: JSON.stringify({ i: 'codex-e2e-widget-success', x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 }),
            SortOrder: 0,
            sortOrder: 0,
          }),
          analysisWidgetMock('codex-e2e-widget-failed', {
            Query: 'SELECT category, value FROM codex_e2e_chart_data WHERE widget = "failed"',
            query: 'SELECT category, value FROM codex_e2e_chart_data WHERE widget = "failed"',
            Layout: JSON.stringify({ i: 'codex-e2e-widget-failed', x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 3 }),
            layout: JSON.stringify({ i: 'codex-e2e-widget-failed', x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 3 }),
            SortOrder: 1,
            sortOrder: 1,
          }),
        ]
      : [
          {
            ...charts[0],
            ID: chartTitle,
            id: chartTitle,
            Layout: JSON.stringify({ i: chartTitle, x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 }),
            layout: JSON.stringify({ i: chartTitle, x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 }),
            SortOrder: index,
            sortOrder: index,
            Type: 'chart',
            type: 'chart',
            __typename: 'AnalysisWidget',
          },
        ];
    const widgets = index === 0 && state?.lastWidget ? [state.lastWidget, ...fallbackWidgets] : fallbackWidgets;

    return {
      ID: title,
      Id: title,
      id: title,
      ResourceID: title,
      resourceId: title,
      Title: title,
      title,
      Name: title,
      name: title,
      CreatedAt: createdAt,
      createdAt,
      UpdatedAt: createdAt,
      updatedAt: createdAt,
      Widgets: widgets,
      widgets,
      Charts: charts,
      charts,
      Description: '',
      description: '',
      RefreshRule: null,
      refreshRule: null,
      __typename: 'AnalysisDashboard',
    };
  });

  const activeDashboard = dashboards[0];
  const charts = activeDashboard?.charts ?? [];
  const widgets = activeDashboard?.widgets ?? [];
  const list = {
    Items: dashboards,
    items: dashboards,
    List: dashboards,
    list: dashboards,
    Nodes: dashboards,
    nodes: dashboards,
    Total: dashboards.length,
    total: dashboards.length,
    TotalCount: dashboards.length,
    totalCount: dashboards.length,
    __typename: 'AnalysisDashboardList',
  };

  return {
    dashboards,
    Dashboards: dashboards,
    GetDashboards: dashboards,
    dashboardList: dashboards,
    DashboardListResult: list,
    dashboardListResult: list,
    analysisDashboards: dashboards,
    DashboardList: dashboards,
    List: dashboards,
    Items: dashboards,
    items: dashboards,
    nodes: dashboards,
    dashboard: activeDashboard,
    analysisDashboard: activeDashboard,
    Dashboard: activeDashboard,
    charts,
    Charts: charts,
    widgets,
    Widgets: widgets,
    chartData: rows,
    ChartData: rows,
  };
}

function updateAnalysisMutationState(state: DataFlowMockState, postData: string) {
  let payload: { operationName?: string; variables?: Record<string, unknown> } | Array<{ operationName?: string; variables?: Record<string, unknown> }>;
  try {
    payload = JSON.parse(postData) as { operationName?: string; variables?: Record<string, unknown> } | Array<{ operationName?: string; variables?: Record<string, unknown> }>;
  } catch {
    return;
  }
  if (Array.isArray(payload)) {
    return;
  }
  const variables = payload.variables ?? {};
  const dashboardTitle = (typeof variables.name === 'string' && variables.name.startsWith('codex-e2e-') ? variables.name : null) ?? extractCodexTitle(postData, 'dashboard');
  if (dashboardTitle && !state.dashboardTitles.includes(dashboardTitle)) {
    state.dashboardTitles.unshift(dashboardTitle);
  }

  const chartTitle = (typeof variables.title === 'string' && variables.title.startsWith('codex-e2e-') ? variables.title : null) ?? extractCodexTitle(postData, 'chart');
  if (chartTitle && !state.chartTitles.includes(chartTitle)) {
    state.chartTitles.unshift(chartTitle);
  }

  if (/AddWidget/i.test(payload.operationName ?? postData)) {
    const input = variables.input && typeof variables.input === 'object' ? (variables.input as Record<string, unknown>) : undefined;
    const widgetTitle = typeof input?.Title === 'string' ? input.Title : chartTitle ?? 'codex-e2e-chart-ok';
    state.lastWidget = analysisWidgetFromInput(input, widgetTitle);
    if (widgetTitle.startsWith('codex-e2e-') && !state.chartTitles.includes(widgetTitle)) {
      state.chartTitles.unshift(widgetTitle);
    }
  }

  if (/UpdateWidget\b/i.test(payload.operationName ?? postData)) {
    const input = variables.input && typeof variables.input === 'object' ? (variables.input as Record<string, unknown>) : {};
    const currentWidget = state.lastWidget ?? analysisWidgetFromInput(undefined, chartTitle ?? state.chartTitles[0] ?? 'codex-e2e-chart-ok');
    const nextTitle = typeof input.Title === 'string' ? input.Title : typeof currentWidget.Title === 'string' ? currentWidget.Title : state.chartTitles[0] ?? 'codex-e2e-chart-ok';
    state.lastWidget = {
      ...currentWidget,
      ...input,
      Title: nextTitle,
      title: nextTitle,
      Name: nextTitle,
      name: nextTitle,
    };
    state.chartTitles = [nextTitle, ...state.chartTitles.filter((title) => title !== nextTitle)];
  }

  if (/UpdateWidgetLayouts/i.test(payload.operationName ?? postData)) {
    const layouts = Array.isArray(variables.layouts) ? variables.layouts : [];
    const nextLayout = layouts.find((layout): layout is Record<string, unknown> => Boolean(layout && typeof layout === 'object'));
    if (state.lastWidget && nextLayout) {
      const layout = JSON.stringify({ i: state.lastWidget.id ?? state.lastWidget.ID ?? state.lastWidget.Title, ...nextLayout });
      state.lastWidget = {
        ...state.lastWidget,
        Layout: layout,
        layout,
      };
    }
  }

  if (/DeleteWidget/i.test(payload.operationName ?? postData)) {
    const deletedTitle = typeof state.lastWidget?.Title === 'string' ? state.lastWidget.Title : null;
    state.lastWidget = undefined;
    if (deletedTitle) {
      state.chartTitles = state.chartTitles.filter((title) => title !== deletedTitle);
    }
  }
}

function queryResponse(operationText: string, state?: DataFlowMockState) {
  const options = state?.options ?? {};
  recordQueryEditorSqlStatements(operationText, state);
  recordQueryEditorRedisCommand(operationText, state);

  if ((state?.scenario === 'query-editor' || state?.scenario === 'all') && isDangerousQueryEditorCommand(operationText)) {
    const errorCode = queryEditorCommandErrorCode(operationText);
    state?.errorLog.push(errorCode);
    return errorResponse(errorCode, errorMessageForCode(errorCode));
  }

  if (options.partialFailure && /RawExecute\b|Execute\b/i.test(operationText) && /widget\s*=\s*\\?"failed\\?"/i.test(operationText)) {
    state?.errorLog.push('widget_query_failed');
    return errorResponse('widget_query_failed', 'widget_query_failed');
  }

  if (/GetDatabase\b|Database\s*\(/i.test(operationText)) {
    return {
      data: {
        Database: ['kubeblocks', 'mydb', 'codex_e2e', 'admin', '0'],
      },
    };
  }

  if (options.preserveSqlTree && /GetStorageUnits\b|StorageUnit\s*\(|StorageUnits\b|Collections?\b|Keys?\b/i.test(operationText)) {
    const storageUnits = [
      {
        Name: 'kb_health_check',
        Attributes: [
          { Key: 'Type', Value: 'BASE TABLE', __typename: 'Record' },
          { Key: 'Total Size', Value: '0.02 MB', __typename: 'Record' },
          { Key: 'Data Size', Value: '0.02 MB', __typename: 'Record' },
        ],
        __typename: 'StorageUnit',
      },
      {
        Name: 'user',
        Attributes: [
          { Key: 'Type', Value: 'COLLECTION', __typename: 'Record' },
          { Key: 'Total Size', Value: '0.02 MB', __typename: 'Record' },
          { Key: 'Data Size', Value: '0.02 MB', __typename: 'Record' },
        ],
        __typename: 'StorageUnit',
      },
      {
        Name: 'codex:e2e:chart:data',
        Attributes: [
          { Key: 'Type', Value: 'HASH', __typename: 'Record' },
          { Key: 'TTL', Value: '-1', __typename: 'Record' },
        ],
        __typename: 'StorageUnit',
      },
    ];

    return {
      data: {
        StorageUnit: storageUnits,
        StorageUnits: storageUnits,
        Collections: storageUnits.filter((unit) => unit.Name === 'user'),
        Keys: storageUnits.filter((unit) => unit.Name === 'codex:e2e:chart:data'),
      },
    };
  }

  if (/GetSchema\b|\bSchema\s*\(/i.test(operationText)) {
    return {
      data: {
        Schema: ['public', 'kubeblocks'],
      },
    };
  }

  if (options.errorMode && options.errorMode !== 'none') {
    const codeByMode = {
      query: 'query_execution_failed',
      'data-load': 'data_load_failed',
      redis: 'redis_key_operation_failed',
      dashboard: 'dashboard_load_failed',
      widget: 'widget_query_failed',
      'unsupported-ddl': 'unsupported_ddl_operation',
      'partial-failure': 'partial_mutation_failed',
    } as const;

    if (
      /Query|Execute|Rows|Redis|Dashboard|Widget|DDL|Mutation|Update|Delete|Create|Add|Drop|Clear|Rename|Alter/i.test(operationText)
    ) {
      const errorCode = codeByMode[options.errorMode];
      state?.errorLog.push(errorCode);
      return errorResponse(errorCode, errorMessageForCode(errorCode));
    }
  }

  if (/ExecuteConfirmedSQL\b/i.test(operationText)) {
    return {
      data: {
        ExecuteConfirmedSQL: {
          Type: 'success',
          Text: 'DDL operation completed',
          Result: {
            Columns: [],
            Rows: [],
            TotalCount: 0,
            __typename: 'RawExecuteResult',
          },
          RequiresConfirmation: false,
          __typename: 'ExecuteResult',
        },
      },
    };
  }

  if (/RawExecute\b|Execute\b/i.test(operationText)) {
    if ((state?.scenario === 'query-editor' || state?.scenario === 'all') && /missing_codex_e2e_table/i.test(operationText)) {
      return errorResponse('query_execution_failed', errorMessageForCode('query_execution_failed'));
    }

    if ((state?.scenario === 'query-editor' || state?.scenario === 'all') && /\bSET\s+codex:e2e:hash\s+literal#value\b/i.test(operationText)) {
      return {
        data: {
          RawExecute: {
            Columns: [{ Name: 'message', Type: 'VARCHAR', __typename: 'Column' }],
            Rows: [['OK literal#value']],
            TotalCount: 1,
            __typename: 'RawExecuteResult',
          },
        },
      };
    }

    const rows: readonly MockChartRow[] = options.emptyData ? [] : MOCK_ROWS;
    return {
      data: {
        RawExecute: {
          Columns: [
            { Name: 'category', Type: 'VARCHAR', __typename: 'Column' },
            { Name: 'value', Type: 'INT', __typename: 'Column' },
          ],
          Rows: rows.map((row) => [row.category, String(row.value)]),
          TotalCount: rows.length,
          __typename: 'RawExecuteResult',
        },
        ...dashboardMocks(state, rows),
      },
    };
  }

  if (shouldReturnMutationResponse(operationText)) {
    const rows: readonly MockChartRow[] = options.emptyData ? [] : MOCK_ROWS;
    const dashboards = dashboardMocks(state, rows);
    const dashboard = dashboards.dashboard;
    const widget = state?.lastWidget ?? dashboards.widgets[0];
    const chart = widget ?? dashboards.charts[0] ?? {
      id: 'codex-e2e-chart-ok',
      title: 'codex-e2e-chart-ok',
      status: 'success',
      rows: MOCK_ROWS,
      __typename: 'AnalysisChart',
    };

    return {
      data: {
        mutation: {
          ID: dashboard?.ID ?? 'codex-e2e-dashboard',
          Id: dashboard?.ID ?? 'codex-e2e-dashboard',
          id: dashboard?.ID ?? 'codex-e2e-dashboard',
          ok: !options.partialFailure,
          Ok: !options.partialFailure,
          success: !options.partialFailure,
          Success: !options.partialFailure,
          refreshedResourceIds: ['codex-e2e-table', 'codex-e2e-collection', 'codex-e2e-key'],
          RefreshedResourceIDs: ['codex-e2e-table', 'codex-e2e-collection', 'codex-e2e-key'],
          failures: options.partialFailure ? [{ id: 'codex-e2e-failed-row', errorCode: 'partial_mutation_failed' }] : [],
          Failures: options.partialFailure ? [{ ID: 'codex-e2e-failed-row', ErrorCode: 'partial_mutation_failed' }] : [],
          __typename: 'MutationResult',
        },
        createDashboard: dashboard,
        CreateDashboard: dashboard,
        CreateDashboards: dashboard,
        addDashboard: dashboard,
        AddDashboard: dashboard,
        saveDashboard: dashboard,
        SaveDashboard: dashboard,
        createChart: chart,
        CreateChart: chart,
        addChart: chart,
        AddChart: chart,
        saveChart: chart,
        SaveChart: chart,
        updateChart: chart,
        UpdateChart: chart,
        updateWidget: widget,
        UpdateWidget: widget,
        UpdateWidgetLayouts: { Status: 'success', status: 'success', __typename: 'MutationStatus' },
        UpdateWidgetSnapshot: { Status: 'success', status: 'success', __typename: 'MutationStatus' },
        deleteWidget: true,
        DeleteWidget: true,
        addWidget: widget,
        AddWidget: widget,
        widget,
        Widget: widget,
        dashboard,
        Dashboard: dashboard,
      },
    };
  }

  if (/Rows|Query|Execute|Chart|Dashboard|Widget|Analysis/i.test(operationText)) {
    const rows: readonly MockChartRow[] = options.emptyData ? [] : MOCK_ROWS;
    return {
      data: {
        Row: {
          Columns: [
            { Name: 'category', Type: 'VARCHAR', IsPrimary: false, IsForeignKey: false, __typename: 'Column' },
            { Name: 'value', Type: 'INT', IsPrimary: false, IsForeignKey: false, __typename: 'Column' },
          ],
          Rows: rows.map((row) => [row.category, String(row.value)]),
          DisableUpdate: false,
          TotalCount: rows.length,
          __typename: 'RowsResult',
        },
        ...dashboardMocks(state, rows),
      },
    };
  }

  if (isMutationOperation(operationText)) {
    const rows: readonly MockChartRow[] = options.emptyData ? [] : MOCK_ROWS;
    const dashboards = dashboardMocks(state, rows);
    const dashboard = dashboards.dashboard;
    const widget = state?.lastWidget ?? dashboards.widgets[0];
    const chart = widget ?? dashboards.charts[0] ?? {
      id: 'codex-e2e-chart-ok',
      title: 'codex-e2e-chart-ok',
      status: 'success',
      rows: MOCK_ROWS,
      __typename: 'AnalysisChart',
    };

    return {
      data: {
        mutation: {
          ID: dashboard?.ID ?? 'codex-e2e-dashboard',
          Id: dashboard?.ID ?? 'codex-e2e-dashboard',
          id: dashboard?.ID ?? 'codex-e2e-dashboard',
          ok: !options.partialFailure,
          Ok: !options.partialFailure,
          success: !options.partialFailure,
          Success: !options.partialFailure,
          refreshedResourceIds: ['codex-e2e-table', 'codex-e2e-collection', 'codex-e2e-key'],
          RefreshedResourceIDs: ['codex-e2e-table', 'codex-e2e-collection', 'codex-e2e-key'],
          failures: options.partialFailure ? [{ id: 'codex-e2e-failed-row', errorCode: 'partial_mutation_failed' }] : [],
          Failures: options.partialFailure ? [{ ID: 'codex-e2e-failed-row', ErrorCode: 'partial_mutation_failed' }] : [],
          __typename: 'MutationResult',
        },
        createDashboard: dashboard,
        CreateDashboard: dashboard,
        CreateDashboards: dashboard,
        addDashboard: dashboard,
        AddDashboard: dashboard,
        saveDashboard: dashboard,
        SaveDashboard: dashboard,
        createChart: chart,
        CreateChart: chart,
        addChart: chart,
        AddChart: chart,
        saveChart: chart,
        SaveChart: chart,
        updateChart: chart,
        UpdateChart: chart,
        updateWidget: widget,
        UpdateWidget: widget,
        UpdateWidgetLayouts: { Status: 'success', status: 'success', __typename: 'MutationStatus' },
        UpdateWidgetSnapshot: { Status: 'success', status: 'success', __typename: 'MutationStatus' },
        deleteWidget: true,
        DeleteWidget: true,
        addWidget: widget,
        AddWidget: widget,
        widget,
        Widget: widget,
        dashboard,
        Dashboard: dashboard,
      },
    };
  }

  return null;
}

export async function installDataFlowApiMocks(
  page: Page,
  scenario: DataFlowMockScenario | 'all' = 'all',
  options: DataFlowMockOptions = {},
) {
  const state: DataFlowMockState = {
    scenario,
    options: { errorMode: 'none', ...options },
    requestLog: [],
    mutationLog: [],
    errorLog: [],
    queryExecutionLog: [],
    dataVersion: 0,
    rows: MOCK_ROWS,
    sql: 'SELECT category, value FROM codex_e2e_chart_data',
    mongoCommand: 'db.codex_e2e_chart_data.find({})',
    redisCommand: 'HGETALL codex:e2e:chart:data',
    dashboardTitles: ['codex-e2e-dashboard-newer', 'codex-e2e-dashboard-older'],
    chartTitles: ['codex-e2e-chart-ok'],
  };

  await page.route('**/api/query', async (route) => {
    let payload: { operationName?: string } | Array<{ operationName?: string }> | null = null;

    try {
      payload = route.request().postDataJSON() as { operationName?: string } | Array<{ operationName?: string }>;
    } catch {
      payload = null;
    }

    const operationName = Array.isArray(payload) ? payload.map((entry) => entry.operationName ?? '').join(',') : (payload?.operationName ?? '');
    const postData = route.request().postData() ?? operationName;
    const operationText = `${operationName}\n${postData}`;
    if (shouldBypassDataFlowMock(operationText)) {
      await route.continue();
      return;
    }

    state.requestLog.push(requestLogEntry(operationName, postData));
    const queryEditorExecution = (scenario === 'query-editor' || scenario === 'all') && isQueryEditorExecutionOperation(operationText);
    if (isMutationOperation(operationText) && !isDangerousQueryEditorCommand(operationText) && !queryEditorExecution) {
      state.mutationLog.push(postData);
      if (scenario === 'analysis' || scenario === 'all') {
        updateAnalysisMutationState(state, postData);
      }
      state.dataVersion += 1;
    }

    if (state.options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, state.options.delayMs));
    }

    if (Array.isArray(payload)) {
      const mockedBatch = payload.map((entry) => queryResponse(`${entry.operationName ?? ''}\n${JSON.stringify(entry)}`, state));
      if (mockedBatch.some(Boolean)) {
        await route.fulfill({ json: mockedBatch.map((response) => response ?? { data: {} }) });
        return;
      }
    }

    const mocked = queryResponse(operationText, state);

    if (mocked) {
      await route.fulfill({ json: mocked });
      return;
    }

    await route.continue();
  });

  return state;
}

export async function expectMockScenario(
  scenario: DataFlowMockScenario,
  label: string,
  evidence: Partial<DataFlowMockEvidence> = {},
  auditContext: Partial<Pick<DataFlowAuditRecord, 'module' | 'testName' | 'dataSource' | 'nodeLevel' | 'nodeText' | 'menuItem' | 'risk' | 'details'>> = {},
) {
  const mergedEvidence = { ...DEFAULT_MOCK_EVIDENCE, ...evidence };
  const mockScore = mockEvidenceScore(mergedEvidence);

  expect({ scenario, label, runIdPrefix: 'codex-e2e', mocked: true, mockScore }).toMatchObject({
    scenario,
    label,
    runIdPrefix: 'codex-e2e',
    mocked: true,
  });
  expect(mockScore, `${scenario}:${label} mock evidence score`).toBeGreaterThanOrEqual(80);

  recordDataFlowAudit({
    module: auditContext.module ?? scenario,
    testName: auditContext.testName ?? label,
    dataSource: auditContext.dataSource ?? 'unknown',
    nodeLevel: auditContext.nodeLevel,
    nodeText: auditContext.nodeText,
    menuItem: auditContext.menuItem,
    mode: 'mock',
    mocked: true,
    mockScore,
    mockEvidence: mergedEvidence,
    risk: auditContext.risk ?? 'low',
    destructiveSubmitted: false,
    cleaned: true,
    result: 'passed',
    details: auditContext.details ?? label,
  });
}

export async function isVisible(locator: Locator) {
  return locator.isVisible().catch(() => false);
}

export async function clickIfVisible(locator: Locator) {
  if (await isVisible(locator)) {
    await locator.click();
    return true;
  }

  return false;
}

export async function fillIfVisible(locator: Locator, value: string) {
  if (await isVisible(locator)) {
    await locator.fill(value);
    return true;
  }

  return false;
}
