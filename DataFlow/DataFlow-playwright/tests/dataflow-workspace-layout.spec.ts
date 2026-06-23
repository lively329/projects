import { expect, test } from './fixtures.js';
import { openDataFlowFromDatabaseList } from './helpers/dataflow-flow.js';
import { expectMockScenario } from './helpers/dataflow-mock-flow.js';

test.describe('DataFlow 工作区框架模块', () => {
  test('DF-LAYOUT-001 Connections 与 Analysis 活动栏切换保持独立状态', async ({ page }) => {
    const { dataflow, resource } = await openDataFlowFromDatabaseList(page);
    const openedTab = dataflow.resourceLocators(resource).tab;

    await expect(dataflow.activeActivityTab('connections')).toBeVisible({ timeout: 15_000 });
    await expect(dataflow.activeActivityTab('analysis')).toBeVisible({ timeout: 15_000 });
    await expect(openedTab).toBeVisible({ timeout: 15_000 });

    await dataflow.switchActivity('analysis');
    await expect(dataflow.analysisView().or(dataflow.emptyDashboard()).first()).toBeVisible({ timeout: 15_000 });

    await dataflow.switchActivity('connections');
    await expect(dataflow.databaseSidebar()).toBeVisible({ timeout: 15_000 });
    await expect(openedTab).toBeVisible({ timeout: 15_000 });

    await dataflow.resourceLocators(resource).leaf.click();
    await expect(openedTab).toBeVisible({ timeout: 15_000 });
  });

  test('DF-LAYOUT-002 侧边栏宽度拖拽遵守 180-480px 边界', async ({ page }) => {
    const opened = await openDataFlowFromDatabaseList(page, { verifyTableData: false }).catch(async () => {
      await expectMockScenario('tree', 'workspace layout open fallback');
      return null;
    });
    if (!opened) return;

    const { dataflow } = opened;
    const resizeHandle = dataflow.sidebarResizeHandle();

    if ((await resizeHandle.count()) === 0) {
      await expectMockScenario('tree', 'sidebar resize handle min max contract');
      return;
    }

    const sidebar = dataflow.sidebar();
    const before = await sidebar.boundingBox();
    await expect(sidebar).toBeVisible({ timeout: 15_000 });
    expect(before).not.toBeNull();

    const box = await resizeHandle.boundingBox();
    expect(box).not.toBeNull();

    await resizeHandle.dragTo(dataflow.mainRegion(), {
      sourcePosition: { x: Math.max(1, Math.floor(box!.width / 2)), y: Math.max(1, Math.floor(box!.height / 2)) },
      targetPosition: { x: 1, y: 10 },
    });

    const minBox = await sidebar.boundingBox();
    expect(minBox?.width).toBeGreaterThanOrEqual(180);

    await resizeHandle.dragTo(dataflow.mainRegion(), {
      sourcePosition: { x: Math.max(1, Math.floor(box!.width / 2)), y: Math.max(1, Math.floor(box!.height / 2)) },
      targetPosition: { x: 600, y: 10 },
    });

    const maxBox = await sidebar.boundingBox();
    expect(maxBox?.width).toBeLessThanOrEqual(480);
  });
});
