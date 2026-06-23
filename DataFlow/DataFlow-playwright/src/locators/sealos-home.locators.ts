export const sealosHomeLocators = {
  homeApps: {
    cloudDev: '.system-sealaf',
    registry: '.system-sealos-registry',
    kite: '.system-kite',
    objectStorage: '.system-objectstorage',
    devbox: '.system-devbox',
    resourceMonitor: '.system-kubepanel',
    cronjob: '.system-cronjob',
    appStore: '.system-template',
    costCenter: '.system-costcenter',
    moreAppsFolder: '.css-1x5er2z, img[alt="app icon"][src*="dbprovider"]',
    database: '.system-dbprovider',
    databaseLabel: '数据库',
  },
  login: {
    usernameInput: 'input[name="username"]',
    passwordInput: 'input[name="password"]',
    submitButton: 'button[type="submit"]',
    loginButton: 'button:has-text("账号密码登录")',
  },
} as const;
