import { expect, type Locator, type Page } from '@playwright/test';
import { sealosHomeLocators } from '../locators/sealos-home.locators.js';
import { DataFlowPage, type OpenedDataFlowResource } from './dataflow.page.js';

export type ManageableDataSourceType = 'mysql' | 'mongodb' | 'redis' | 'postgresql';

type OpenDatabaseManagementResult = {
  dataSourceType: ManageableDataSourceType;
  resource: OpenedDataFlowResource;
};

type OpenDatabaseManagementWorkspaceResult = {
  dataSourceType: ManageableDataSourceType;
};

export class SealosHomePage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/');
    await expect(this.page).toHaveURL(/192\.168\.10\.70\.nip\.io/);
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  private loginButton() {
    return this.page.locator(sealosHomeLocators.login.loginButton);
  }

  private usernameInput() {
    return this.page.locator(sealosHomeLocators.login.usernameInput);
  }

  private passwordInput() {
    return this.page.locator(sealosHomeLocators.login.passwordInput);
  }

  private submitButton() {
    return this.page.locator(sealosHomeLocators.login.submitButton);
  }

  private moreAppsCard() {
    return this.page.locator(sealosHomeLocators.homeApps.moreAppsFolder).first();
  }

  private databaseCard() {
    return this.page
      .locator('body')
      .getByText(sealosHomeLocators.homeApps.databaseLabel, { exact: true })
      .locator('xpath=ancestor-or-self::*[contains(@class, "system-dbprovider")][1]');
  }

  private databaseWindow() {
    return this.page.locator('#app-window-system-dbprovider');
  }

  private databaseFrame() {
    return this.page.frameLocator('#app-window-system-dbprovider');
  }

  private databaseRows() {
    return this.databaseFrame().locator('tbody tr');
  }

  dataflow(): DataFlowPage {
    return new DataFlowPage(this.page);
  }

  private databaseRowsByType(type: ManageableDataSourceType) {
    const typeMatcher =
      type === 'mysql'
        ? /MySQL|apecloud-mysql/i
        : type === 'mongodb'
          ? /MongoDB|mongodb/i
          : type === 'redis'
            ? /Redis|redis/i
            : /PostgreSQL|postgresql/i;

    return this.databaseRows().filter({ hasText: typeMatcher });
  }

  private dataManagementButtonInRow(row: Locator) {
    return row.getByRole('button', { name: /数据管理|Data Management|Manage Data/i });
  }

  private async findManageableDatabaseRow(preferredType?: ManageableDataSourceType) {
    const dataSourceTypes = preferredType ? [preferredType] : (['mysql', 'mongodb', 'redis'] as const);

    for (const type of dataSourceTypes) {
      const rows = this.databaseRowsByType(type);
      const count = await rows.count();

      for (let index = 0; index < count; index += 1) {
        const row = rows.nth(index);
        const button = this.dataManagementButtonInRow(row);

        if (await button.isVisible().catch(() => false)) {
          return { type, row, button };
        }
      }
    }

    throw new Error(
      preferredType
        ? `No ${preferredType} row with a visible data management button was found.`
        : 'No MySQL, MongoDB, or Redis row with a visible data management button was found.',
    );
  }

  async login(username: string, password: string) {
    const loginSignal = this.loginButton();
    const usernameField = this.usernameInput();
    const onSigninPage = /\/signin(?:\/|$)/.test(this.page.url());

    if (await usernameField.isVisible().catch(() => false)) {
      await usernameField.fill(username);
      await this.passwordInput().fill(password);
      await this.submitButton().click();
      await this.page.waitForLoadState('networkidle').catch(() => {});
      return;
    }

    if (!onSigninPage) {
      return;
    }

    if (await loginSignal.isVisible().catch(() => false)) {
      await loginSignal.click();
    }

    await expect(usernameField).toBeVisible({ timeout: 15_000 });
    await usernameField.fill(username);
    await this.passwordInput().fill(password);
    await this.submitButton().click();
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  async enterHomeState() {
    await expect(this.page).not.toHaveURL(/\/signin(?:\/|$)/, { timeout: 15_000 });
    await expect(this.moreAppsCard()).toBeVisible({ timeout: 15_000 });
    await expect.soft(this.page.locator(sealosHomeLocators.homeApps.cloudDev)).toBeVisible();
    await expect.soft(this.page.locator(sealosHomeLocators.homeApps.registry)).toBeVisible();
    await expect.soft(this.page.locator(sealosHomeLocators.homeApps.objectStorage)).toBeVisible();
    await expect.soft(this.page.locator(sealosHomeLocators.homeApps.devbox)).toBeVisible();
  }

  async openDatabase() {
    const databaseFrame = this.databaseFrame();
    const database = this.databaseCard();
    const databaseListTitle = databaseFrame.getByText(/数据库列表|Database(\s+\d+)?/);
    const searchInput = databaseFrame.getByPlaceholder(/搜索名称或备注|Search by name or remark/);
    const createButton = databaseFrame.getByRole('button', { name: /新建|Create Database/ });

    await expect(database).toBeVisible({ timeout: 15_000 });
    await this.page.waitForTimeout(2_000);
    await database.click();
    await expect(this.databaseWindow()).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => await databaseListTitle.first().count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(databaseListTitle.first()).toBeVisible({ timeout: 20_000 });
    await expect(searchInput).toBeVisible({ timeout: 15_000 });
    await expect(createButton).toBeVisible({ timeout: 15_000 });

    for (const header of [/名字|Name/, /类型|Type/, /状态|Status/, /创建时间|Creation Time/, /CPU/, /内存|Memory/, /磁盘|Storage/, /操作|Operation/]) {
      await expect(databaseFrame.getByText(header)).toBeVisible({ timeout: 15_000 });
    }

    await expect.poll(async () => await this.databaseRows().count(), { timeout: 15_000 }).toBeGreaterThan(0);

    await expect(this.page).toHaveURL(/192\.168\.10\.70\.nip\.io\/?$/);
  }

  async openDatabaseManagementWorkspace(options: { dataSourceType?: ManageableDataSourceType } = {}): Promise<OpenDatabaseManagementWorkspaceResult> {
    const databaseFrame = this.databaseFrame();
    const dataflow = this.dataflow();

    await expect(databaseFrame.getByText('数据库列表', { exact: true })).toBeVisible({ timeout: 15_000 });
    const target = await this.findManageableDatabaseRow(options.dataSourceType);

    await expect(target.button).toBeVisible({ timeout: 15_000 });
    await target.button.click();
    await dataflow.waitForConnectionsWorkspace();

    return { dataSourceType: target.type };
  }

  async openDatabaseManagement(options: { verifyTableData?: boolean; dataSourceType?: ManageableDataSourceType } = {}): Promise<OpenDatabaseManagementResult> {
    const verifyTableData = options.verifyTableData ?? true;
    const dataflow = this.dataflow();
    const target = await this.openDatabaseManagementWorkspace({ dataSourceType: options.dataSourceType });

    const resource = await dataflow.openFirstResourceLeaf();
    await expect(dataflow.resourceLocators(resource).detail).toBeVisible({ timeout: 15_000 });

    if (verifyTableData) {
      if (resource.resourceType === 'table') {
        await expect(dataflow.resourceLocators(resource).detail).toBeVisible({ timeout: 15_000 });
      } else if (resource.resourceType === 'collection') {
        await expect(dataflow.byQa('mongodb.collection.document-list-region').or(dataflow.byQa('mongodb.collection.document-list-empty')).first()).toBeVisible({
          timeout: 15_000,
        });
      } else {
        await expect(dataflow.byQa('redis.key.grid').or(dataflow.byQa('redis.key.empty')).first()).toBeVisible({ timeout: 15_000 });
      }
    }

    return { dataSourceType: target.dataSourceType, resource };
  }

  async openMoreAppsFolder() {
    const folder = this.moreAppsCard();

    await expect(folder).toBeVisible({ timeout: 15_000 });
    await folder.click();
  }

  async openDatabaseViaFolder() {
    if (await this.databaseCard().isVisible().catch(() => false)) {
      await this.openDatabase();
      return;
    }

    await this.openMoreAppsFolder();
    await this.openDatabase();
  }

  async openDatabaseFromFolder() {
    await this.openMoreAppsFolder();
    await this.openDatabase();
  }

  databaseWindowLocator(): Locator {
    return this.databaseWindow();
  }
}
