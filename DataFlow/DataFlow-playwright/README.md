# Sealos Playwright Framework

This framework is scaffolded around the Sealos homepage at `https://192.168.10.70.nip.io`.

## What was discovered from the live page

- Login flow:
  - `账号密码登录` button opens the username/password form
  - username input: `input[name="username"]`
  - password input: `input[name="password"]`
  - submit button: `button[type="submit"]`
- Home app cards:
  - `云开发`: `.system-sealaf`
  - `镜像服务`: `.system-sealos-registry`
  - `对象存储`: `.system-objectstorage`
  - `Devbox`: `.system-devbox`
  - `资源监控`: `.system-kubepanel`
  - `定时任务`: `.system-cronjob`
  - `应用商店`: `.system-template`
  - `费用中心`: `.system-costcenter`
- More apps folder card:
  - `.css-1x5er2z`
- Database app entry:
  - `.system-dbprovider`
- Database app window:
  - `#app-window-system-dbprovider`
- Database list page:
  - title: `数据库列表`
  - search input: `搜索名称或备注`
  - table headers: `名字`, `类型`, `状态`, `创建时间`, `CPU`, `内存`, `磁盘`, `操作`
  - expected rows: `Milvus`, `MySQL`, `Redis`, `MongoDB`, `PostgreSQL`
- Database management page:
  - title: `数据库管理`
  - page label: `数据库连接`
  - connection name: `coze-studio-ixbuidnp-mysql`
  - tree items after expand: `kb_health_check`, `mydb`, `opencoze`
  - empty state: `暂无打开的标签页`
- opened database: `kb_health_check [kubeblocks]`
- result columns: `type`, `PK`, `INT`, `check_ts`, `BIGINT`
- sample value: a 10-digit timestamp-like value rendered in the table
- window id: `#app-window-system-dataflow`

## What the test does

1. Open the Sealos home page.
2. Log in with `admin`.
3. Confirm the application home state is visible.
4. Open the database application from the home page.
5. Confirm the database list page is visible and all five databases are rendered.
6. Open the database management view from the database list and confirm the connection tree is shown.
7. Open `kb_health_check` under `kubeblocks` and confirm the table data is rendered.

## Login / profile

The test can run with the live login form. If you want to reuse a logged-in Chrome profile, you can still do that with the existing fixture.

- Default profile path: `.chrome-data-mcp`
- Or it will reuse your local Chrome default profile: `~/Library/Application Support/Google/Chrome/Default`
- Override with: `CHROME_USER_DATA_DIR=/absolute/path/to/profile`

If you see the login page during manual browsing, the profile does not contain a valid session for the target tenant.

## Playwright MCP

If you want to connect this repo to Playwright MCP, point your MCP client at Playwright's server and use the repo's existing test suite as the automation target. The local test code already captures the stable selectors discovered from the live page.

## Install

```bash
npm install
```

If Playwright asks for browser binaries, the config is already set to use the local Google Chrome channel.

## Run

```bash
npm test
```

Run a specific case by name:

```bash
npx playwright test tests/open-database.spec.ts -g "用例1"
npx playwright test tests/open-database.spec.ts -g "用例2"
```

To slow down the browser actions for demos:

```bash
PLAYWRIGHT_SLOW_MO_MS=300 npx playwright test tests/open-database.spec.ts
```

You can also use `SLOW_MO_MS=300` as a shorter alias.

## Env

Copy `.env.example` to `.env` if you want to override `BASE_URL`.
