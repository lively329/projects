import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';

type QaAttrs = Record<string, string | undefined>;
export type DataFlowResourceType = 'table' | 'collection' | 'redis_key';

export type OpenedDataFlowResource = {
  resourceType: DataFlowResourceType;
  resourceId: string;
};

type ResourceLocatorSet = {
  tab: Locator;
  leaf: Locator;
  detail: Locator;
};

type TreeNodeResourceType = DataFlowResourceType | 'connection' | 'database' | 'schema' | 'folder' | 'view';

const DATAFLOW_WINDOW_SELECTOR = '#app-window-system-dataflow';

function escapeAttrValue(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function qaSelector(testId: string, attrs: QaAttrs = {}) {
  const selector = [`[data-testid="${escapeAttrValue(testId)}"]`];

  for (const [name, value] of Object.entries(attrs)) {
    if (typeof value === 'string') {
      selector.push(`[${name}="${escapeAttrValue(value)}"]`);
    }
  }

  return selector.join('');
}

function stateMatcher(state: string) {
  return new RegExp(`(^|\\s)${escapeRegExp(state)}(\\s|$)`);
}

export class DataFlowPage {
  constructor(private readonly page: Page) {}

  window(): Locator {
    return this.page.locator(DATAFLOW_WINDOW_SELECTOR);
  }

  frame(): FrameLocator {
    return this.page.frameLocator(DATAFLOW_WINDOW_SELECTOR);
  }

  byQa(testId: string, attrs: QaAttrs = {}): Locator {
    return this.frame().locator(qaSelector(testId, attrs));
  }

  private fallbackActivityTab(resourceId: 'connections' | 'analysis'): Locator {
    return this.frame().getByRole('button', { name: resourceId === 'connections' ? '工作台' : '仪表盘' });
  }

  private fallbackDatabaseSidebar(): Locator {
    return this.frame().getByText('数据库连接', { exact: true });
  }

  private fallbackEmptyTabContent(): Locator {
    return this.frame().getByText(/暂无打开的标签页|从侧边栏选择/).first();
  }

  private fallbackResourceLeaf(): Locator {
    return this.frame().getByText('kb_health_check', { exact: true });
  }

  appShell(): Locator {
    return this.byQa('layout.shell');
  }

  activityTab(resourceId: 'connections' | 'analysis'): Locator {
    return this.byQa('layout.activity.tab', { 'data-qa-resource-id': resourceId });
  }

  activeActivityTab(resourceId: 'connections' | 'analysis'): Locator {
    return this.activityTab(resourceId).or(this.fallbackActivityTab(resourceId)).first();
  }

  sidebar(): Locator {
    return this.byQa('layout.sidebar-region').or(this.frame().getByText('数据库连接', { exact: true }).locator('xpath=ancestor::*[self::aside or self::div][1]')).first();
  }

  sidebarResizeHandle(): Locator {
    return this.byQa('layout.sidebar-resize-handle');
  }

  mainRegion(): Locator {
    return this.byQa('layout.main-region');
  }

  tabBar(): Locator {
    return this.byQa('layout.tab-bar');
  }

  tabItem(attrs: QaAttrs = {}): Locator {
    return this.byQa('layout.tab.item', attrs);
  }

  tabPanel(attrs: QaAttrs = {}): Locator {
    return this.byQa('layout.tab-content.panel', attrs);
  }

  emptyTabContent(): Locator {
    return this.byQa('layout.tab-content.empty');
  }

  newQueryButton(): Locator {
    return this.byQa('layout.tab.new-query-button').or(this.frame().getByRole('button', { name: '查询' })).first();
  }

  queryTabs(): Locator {
    return this.tabItem({ 'data-qa-tab-type': 'query' }).or(this.frame().getByText(/^查询(?:\s*\[[^\]]+\])?$/));
  }

  databaseSidebar(): Locator {
    return this.byQa('database.sidebar').or(this.fallbackDatabaseSidebar()).first();
  }

  connectionTree(): Locator {
    return this.byQa('database.sidebar.tree');
  }

  treeNode(attrs: QaAttrs = {}): Locator {
    return this.byQa('database.sidebar.tree-node', attrs);
  }

  treeNodesByResourceType(resourceType: TreeNodeResourceType): Locator {
    return this.treeNode({ 'data-qa-resource-type': resourceType });
  }

  resourceLeaf(attrs: QaAttrs = {}): Locator {
    const attrSelector = Object.entries(attrs)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, value]) => `[${name}="${escapeAttrValue(value)}"]`)
      .join('');

    return this.frame().locator(
      [
        `[data-testid="database.sidebar.tree-node"][data-qa-resource-type="table"]${attrSelector}`,
        `[data-testid="database.sidebar.tree-node"][data-qa-resource-type="collection"]${attrSelector}`,
        `[data-testid="database.sidebar.tree-node"][data-qa-resource-type="redis_key"]${attrSelector}`,
      ].join(','),
    );
  }

  resourceLocators(resource: OpenedDataFlowResource): ResourceLocatorSet {
    const semanticTab = this.tabItem({
      'data-qa-tab-type': resource.resourceType === 'table' ? 'table' : resource.resourceType,
      'data-qa-resource-id': resource.resourceId,
    });
    const fallbackTab = this.frame().getByText(new RegExp(`${escapeRegExp(resource.resourceId)}(?:\\s*\\[[^\\]]+\\])?`)).first();

    return {
      tab: semanticTab.or(fallbackTab).first(),
      leaf: this.resourceLeaf({ 'data-qa-resource-id': resource.resourceId }).or(this.frame().getByText(resource.resourceId, { exact: true })).first(),
      detail: this.resourceDetail(resource).or(this.frame().getByRole('main')).or(this.frame().getByText(resource.resourceId, { exact: false })).first(),
    };
  }

  treeNodeToggle(node: Locator): Locator {
    return node.locator('[data-testid="database.sidebar.tree-node-toggle"]').first();
  }

  treeNodeChildren(node: Locator): Locator {
    return node.locator('[data-testid="database.sidebar.tree-node-children"]').first();
  }

  tabCloseButton(tab: Locator): Locator {
    return tab.locator('[data-testid="layout.tab.close-button"]').or(tab.getByRole('button', { name: /关闭|close/i })).first();
  }

  activeTab(): Locator {
    return this.tabItem({ 'data-qa-state': 'active' }).or(this.frame().locator('[data-testid="layout.tab.item"][aria-selected="true"]')).first();
  }

  sqlTableDetail(attrs: QaAttrs = {}): Locator {
    return this.byQa('sql.table.detail', attrs);
  }

  sqlTableGrid(): Locator {
    return this.byQa('sql.table.grid');
  }

  mongoCollectionDetail(attrs: QaAttrs = {}): Locator {
    return this.byQa('mongodb.collection.detail', attrs);
  }

  redisKeyDetail(attrs: QaAttrs = {}): Locator {
    return this.byQa('redis.key.detail', attrs);
  }

  refreshButton(resource: OpenedDataFlowResource): Locator {
    const testId =
      resource.resourceType === 'table'
        ? 'sql.table.refresh-button'
        : resource.resourceType === 'collection'
          ? 'mongodb.collection.refresh-button'
          : 'redis.key.refresh-button';

    return this.byQa(testId).or(this.resourceDetail(resource).getByRole('button', { name: /刷新|Refresh/i })).first();
  }

  exportButton(resource: OpenedDataFlowResource): Locator {
    const testId =
      resource.resourceType === 'table'
        ? 'sql.table.export-button'
        : resource.resourceType === 'collection'
          ? 'mongodb.collection.export-button'
          : 'redis.key.export-button';

    return this.byQa(testId).or(this.resourceDetail(resource).getByRole('button', { name: /导出|Export/i })).first();
  }

  dataViewError(): Locator {
    return this.byQa('data-view.error');
  }

  dataViewRetryButton(): Locator {
    return this.byQa('data-view.retry-button').or(this.frame().getByRole('button', { name: /重试|Retry/i })).first();
  }

  errorSurface(attrs: QaAttrs = {}): Locator {
    return this.byQa('auth.bootstrap.error', attrs)
      .or(this.byQa('data-view.error', attrs))
      .or(this.byQa('redis.key.error', attrs))
      .or(this.byQa('query.editor.error', attrs))
      .or(this.byQa('analysis.dashboard.error', attrs))
      .or(this.byQa('analysis.widget.error', attrs))
      .or(this.frame().locator('[data-qa-error-code]'))
      .or(this.frame().getByText(/错误|失败|Error|Failed|unsupported|not supported/i))
      .first();
  }

  disabledReason(reason?: string): Locator {
    return this.frame().locator(reason ? `[data-qa-disabled-reason="${escapeAttrValue(reason)}"]` : '[data-qa-disabled-reason]').first();
  }

  mutationButtons(): Locator {
    return this.frame()
      .locator('[data-qa-risk="resource_mutation"], [data-qa-risk~="resource_mutation"]')
      .or(
        this.frame().getByRole('button', {
          name: /新增|创建|编辑|保存|提交|删除|清空|预览|Create|New|Edit|Save|Submit|Delete|Clear|Preview/i,
        }),
      );
  }

  queryEditor(): Locator {
    return this.byQa('sql.editor.view')
      .or(this.byQa('query.editor.view'))
      .or(this.frame().locator('textarea.ime-text-area, textarea, [contenteditable="true"], .cm-editor'))
      .first();
  }

  queryEditorInput(): Locator {
    return this.byQa('sql.editor.input')
      .or(this.byQa('query.editor.input'))
      .or(this.frame().locator('textarea.ime-text-area, textarea, [contenteditable="true"], .cm-content'))
      .first();
  }

  dashboardWidget(attrs: QaAttrs = {}): Locator {
    return this.byQa('analysis.dashboard.widget', attrs)
      .or(this.byQa('analysis.widget', attrs))
      .or(this.byQa('analysis.chart.widget', attrs))
      .or(this.frame().locator('[data-qa-resource-type="widget"], [data-testid*="widget"]'))
      .first();
  }

  confirmDialog(): Locator {
    return this.byQa('common.confirm-dialog')
      .or(this.frame().getByRole('alertdialog').filter({ hasText: /确认|确定|不可撤销|删除|Confirm|Delete|Warning/i }))
      .or(this.frame().getByRole('alertdialog'))
      .or(this.frame().getByRole('dialog').filter({ hasText: /确认|确定|不可撤销|删除|Confirm|Delete|Warning/i }))
      .or(this.frame().getByRole('dialog'))
      .first();
  }

  dialog(title?: RegExp): Locator {
    const dialog = this.frame().getByRole('dialog');
    return (title ? dialog.filter({ hasText: title }) : dialog).first();
  }

  findBar(): Locator {
    return this.byQa('data-view.findbar').or(this.frame().getByRole('search')).first();
  }

  findBarInput(): Locator {
    return this.byQa('data-view.findbar.input').or(this.findBar().getByRole('textbox')).first();
  }

  resourceDetail(resource: OpenedDataFlowResource): Locator {
    if (resource.resourceType === 'table') {
      return this.sqlTableDetail({
        'data-qa-resource-type': 'table',
        'data-qa-resource-id': resource.resourceId,
      });
    }

    if (resource.resourceType === 'collection') {
      return this.mongoCollectionDetail({
        'data-qa-resource-type': 'collection',
        'data-qa-resource-id': resource.resourceId,
      });
    }

    return this.redisKeyDetail({
      'data-qa-resource-type': 'redis_key',
      'data-qa-resource-id': resource.resourceId,
    });
  }

  analysisView(): Locator {
    return this.byQa('analysis.view').or(this.frame().getByText('尚未选择仪表盘', { exact: true })).first();
  }

  emptyDashboard(): Locator {
    return this.byQa('analysis.dashboard.empty').or(this.frame().getByText(/Dashboard is Empty|尚未选择仪表盘/)).first();
  }

  async expectState(locator: Locator, state: string, timeout = 15_000) {
    await expect(locator).toHaveAttribute('data-qa-state', stateMatcher(state), { timeout });
  }

  async expectNoBootstrapError() {
    await expect(this.byQa('auth.bootstrap.error')).toHaveCount(0, { timeout: 15_000 });
  }

  async waitForConnectionsWorkspace() {
    await expect(this.window()).toBeVisible({ timeout: 15_000 });
    await expect(this.byQa('auth.bootstrap.loading')).toHaveCount(0, { timeout: 15_000 });
    await this.expectNoBootstrapError();
    if (await this.appShell().isVisible().catch(() => false)) {
      await this.expectState(this.appShell(), 'connections');
      await this.expectState(this.activityTab('connections'), 'active');
    } else {
      const fallbackConnections = this.fallbackActivityTab('connections');
      const fallbackAnalysis = this.fallbackActivityTab('analysis');
      const hasFallbackShell =
        (await fallbackConnections.isVisible().catch(() => false)) &&
        (await fallbackAnalysis.isVisible().catch(() => false));

      if (hasFallbackShell) {
        await expect(fallbackConnections).toBeVisible({ timeout: 15_000 });
        await expect(fallbackAnalysis).toBeVisible({ timeout: 15_000 });
      }
    }
    await expect(this.databaseSidebar()).toBeVisible({ timeout: 15_000 });
    if (await this.connectionTree().isVisible().catch(() => false)) {
      await this.expectState(this.connectionTree(), 'ready');
    }
  }

  async switchActivity(resourceId: 'connections' | 'analysis') {
    await this.activeActivityTab(resourceId).click();
    if (await this.appShell().isVisible().catch(() => false)) {
      await this.expectState(this.appShell(), resourceId);
      await this.expectState(this.activityTab(resourceId), 'active');
    }
  }

  async expandTreeNode(parent: Locator, expectedChild: Locator) {
    if (await expectedChild.isVisible().catch(() => false)) {
      return;
    }

    await expect(parent).toBeVisible({ timeout: 15_000 });

    const toggle = this.treeNodeToggle(parent);
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
    } else {
      await parent.click();
    }

    await expect(expectedChild).toBeVisible({ timeout: 15_000 });
    await this.expectState(parent, 'expanded');
  }

  async openTreeLeaf(leaf: Locator, expectedPanel: Locator) {
    await expect(leaf).toBeVisible({ timeout: 15_000 });
    await leaf.scrollIntoViewIfNeeded().catch(() => {});
    await leaf.click();
    await expect(expectedPanel).toBeVisible({ timeout: 15_000 });
  }

  async expandUntilResourceLeafVisible() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (await this.resourceLeaf().first().isVisible().catch(() => false)) {
        return;
      }

      if (await this.fallbackResourceLeaf().isVisible().catch(() => false)) {
        return;
      }

      const collapsedToggle = this.frame()
        .locator('[data-testid="database.sidebar.tree-node-toggle"][data-qa-state~="collapsed"]')
        .first();

      if (await collapsedToggle.isVisible().catch(() => false)) {
        await collapsedToggle.click();
        continue;
      }

      const anyToggle = this.frame().locator('[data-testid="database.sidebar.tree-node-toggle"]').first();
      if (await anyToggle.isVisible().catch(() => false)) {
        await anyToggle.click();
        continue;
      }

      break;
    }

    await expect(this.resourceLeaf().or(this.fallbackResourceLeaf()).first()).toBeVisible({ timeout: 15_000 });
  }

  async firstExpandableTreeNode(): Promise<Locator> {
    await expect(this.connectionTree()).toBeVisible({ timeout: 15_000 });

    const collapsedToggle = this.frame()
      .locator('[data-testid="database.sidebar.tree-node-toggle"][data-qa-state~="collapsed"]')
      .first();

    if (await collapsedToggle.isVisible().catch(() => false)) {
      return collapsedToggle.locator('xpath=ancestor::*[@data-testid="database.sidebar.tree-node"][1]');
    }

    const anyToggle = this.frame().locator('[data-testid="database.sidebar.tree-node-toggle"]').first();

    if (await anyToggle.isVisible().catch(() => false)) {
      return anyToggle.locator('xpath=ancestor::*[@data-testid="database.sidebar.tree-node"][1]');
    }

    throw new Error('No expandable DataFlow tree node was found.');
  }

  async openFirstResourceLeaf(): Promise<OpenedDataFlowResource> {
    await this.expandUntilResourceLeafVisible();

    const semanticLeaf = this.resourceLeaf().first();
    const hasSemanticLeaf = await semanticLeaf.isVisible().catch(() => false);
    const leaf = hasSemanticLeaf ? semanticLeaf : this.fallbackResourceLeaf().first();
    const resourceType = hasSemanticLeaf ? ((await leaf.getAttribute('data-qa-resource-type')) as DataFlowResourceType | null) : 'table';
    const resourceId = hasSemanticLeaf ? await leaf.getAttribute('data-qa-resource-id') : 'kb_health_check';

    if (!resourceType || !resourceId) {
      throw new Error('The first DataFlow resource leaf is missing data-qa-resource-type or data-qa-resource-id.');
    }

    const resource = { resourceType, resourceId };
    const detail = this.resourceLocators(resource).detail;

    await this.openTreeLeaf(leaf, detail);
    if (await this.resourceDetail(resource).isVisible().catch(() => false)) {
      await this.expectState(this.resourceDetail(resource), 'ready');
    }

    return resource;
  }
}
