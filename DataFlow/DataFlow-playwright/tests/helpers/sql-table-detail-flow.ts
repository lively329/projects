import { expect, type FrameLocator, type Page } from '@playwright/test';
import { SealosHomePage } from '../../src/pages/sealos-home.page.js';
import { ADMIN_PASSWORD } from './dataflow-flow.js';

type SqlRow = {
  type: number;
  check_ts: number;
};

type GetStorageUnitRowsPayload = {
  operationName?: string;
  variables?: unknown;
};

type SqlFilterOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';

type SqlRowsFilter = {
  field: keyof SqlRow;
  operator: SqlFilterOperator;
  value?: string;
};

export const SQL_ROWS: SqlRow[] = [
  { type: 1, check_ts: 1779720163 },
  { type: 7, check_ts: 1827937773 },
];

const SQL_COLUMNS = [
  {
    Type: 'INT',
    Name: 'type',
    IsPrimary: true,
    IsForeignKey: false,
    ReferencedTable: null,
    ReferencedColumn: null,
    Length: null,
    Precision: null,
    Scale: null,
    __typename: 'Column',
  },
  {
    Type: 'BIGINT',
    Name: 'check_ts',
    IsPrimary: false,
    IsForeignKey: false,
    ReferencedTable: null,
    ReferencedColumn: null,
    Length: null,
    Precision: null,
    Scale: null,
    __typename: 'Column',
  },
] as const;

export const SQL_TABLE_TOOLBAR_INDEX = {
  refresh: 7,
  addRow: 8,
  markDelete: 9,
  undo: 10,
  preview: 11,
  submit: 12,
} as const;

let nextSqlRowsFilter: SqlRowsFilter | null = null;
let nextSqlRowsDelayMs = 0;

function compareSqlFilter(row: SqlRow, filter: SqlRowsFilter) {
  const rawValue = row[filter.field];
  const rowValue = String(rawValue);
  const filterValue = filter.value ?? '';
  const numericRowValue = Number(rawValue);
  const numericFilterValue = Number(filterValue);

  switch (filter.operator) {
    case '=':
      return rowValue === filterValue;
    case '!=':
      return rowValue !== filterValue;
    case '>':
      return numericRowValue > numericFilterValue;
    case '>=':
      return numericRowValue >= numericFilterValue;
    case '<':
      return numericRowValue < numericFilterValue;
    case '<=':
      return numericRowValue <= numericFilterValue;
    case 'LIKE':
      return rowValue.includes(filterValue);
    case 'NOT LIKE':
      return !rowValue.includes(filterValue);
    case 'IN':
      return filterValue
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .includes(rowValue);
    case 'IS NULL':
      return rawValue === null || rawValue === undefined;
    case 'IS NOT NULL':
      return rawValue !== null && rawValue !== undefined;
    default:
      return true;
  }
}

export async function enableNextSqlRowsFilterMock(page: Page, filter: SqlRowsFilter) {
  nextSqlRowsFilter = filter;
}

export async function enableNextSqlRowsDelayMock(page: Page, delayMs: number) {
  nextSqlRowsDelayMs = delayMs;
}

export function sqlTableFrame(page: Page): FrameLocator {
  return page.frameLocator('#app-window-system-dataflow');
}

export function sqlTableRow(dataflow: FrameLocator, index: number) {
  return dataflow.locator('tbody tr').nth(index);
}

export function sqlTableToolbarButton(dataflow: FrameLocator, index: number) {
  return dataflow.locator('button').nth(index);
}

export async function installSqlRowsMock(page: Page) {
  await page.route('**/api/query', async (route) => {
    let payload: GetStorageUnitRowsPayload | null = null;

    try {
      payload = route.request().postDataJSON() as GetStorageUnitRowsPayload;
    } catch {
      payload = null;
    }

    if (payload?.operationName !== 'GetStorageUnitRows') {
      await route.continue();
      return;
    }

    const payloadText = JSON.stringify(payload ?? {});
    const filter = nextSqlRowsFilter;
    const delayMs = nextSqlRowsDelayMs;
    nextSqlRowsFilter = null;
    nextSqlRowsDelayMs = 0;
    const rows =
      filter
        ? SQL_ROWS.filter((row) => compareSqlFilter(row, filter))
        : /LIKE/i.test(payloadText) && /"1"|:1|\b1\b/.test(payloadText)
          ? SQL_ROWS.filter((row) => String(row.type).includes('1'))
        : SQL_ROWS;

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    await route.fulfill({
      json: {
        data: {
          Row: {
            Columns: SQL_COLUMNS,
            Rows: rows.map((row) => [String(row.type), String(row.check_ts)]),
            DisableUpdate: false,
            TotalCount: rows.length,
            __typename: 'RowsResult',
          },
        },
      },
    });
  });
}

export async function openMockedSqlTable(page: Page) {
  const home = new SealosHomePage(page);

  await installSqlRowsMock(page);
  await home.goto();
  await home.login('admin', ADMIN_PASSWORD);
  await home.enterHomeState();
  await home.openDatabaseViaFolder();
  await home.openDatabaseManagement({ verifyTableData: false, dataSourceType: 'mysql' });

  const dataflow = sqlTableFrame(page);
  await expect(dataflow.getByText('kb_health_check [kubeblocks]', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(dataflow.getByText('type', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(dataflow.getByText('check_ts', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(dataflow.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });
  await expect(dataflow.locator('tbody tr').nth(1)).toBeVisible({ timeout: 15_000 });

  return { dataflow };
}
