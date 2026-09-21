# 机房断电手册与离线演练

纯前端离线应用：TypeScript + React + Vite，无后端、无在线服务。应用内置两个同源手册版本，Service Worker 负责应用外壳和离线请求，Cache Storage 保存已校验手册包，IndexedDB 只保存“当前代际”和安装状态两项数据。

## 保证的状态规则

- 清单包含版本号、同源 URL、字节数、SHA-256 和有序断电步骤。
- 安装时先下载清单，再逐个下载资源；每个文件都校验大小和 SHA-256。
- 所有资源完整通过校验后，状态才进入 `ready`；维护员再显式激活。
- 激活在同一个 IndexedDB 事务中写入当前版本并清空安装状态，随后清理旧包。
- 取消、断网、SHA-256 失败、配额异常，或安装中关闭页面后重开，都不会替换当前完整版本；未激活缓存会被清理。
- 首次安装失败或无当前版本时，显示“无可用离线包”。
- 离线刷新仍由 Service Worker 打开当前版本；中断的新版半包不会接管。
- 只有完整重装并激活新版后，页面才只显示新版步骤。
- 能力缺失（Service Worker、Cache Storage、IndexedDB、Web Crypto、安全上下文等）显示 `UNSUPPORTED`。

## 内置手册版本

- `2024.11.0`：旧版机房 A 基线断电手册。
- `2025.03.2`：新版双总线修订断电手册。

源数据位于 `scripts/generate-packages.mjs`，执行预开发或预构建脚本时生成：

- `public/packages/<版本>/manifest.json`
- `public/packages/<版本>/steps.json`
- `public/packages/<版本>/faults.json`
- `public/packages/<版本>/notes.json`
- `src/generated/catalog.ts/json`

生成产物不提交、不留占位文件；应用需要的内置内容由构建确定性生成。

## 本地开发

```bash
npm ci
npm run dev
```

Vite 会先自动运行 `npm run generate:packages`。

## 质量验证

```bash
npm run test:run       # Vitest：状态协调单元测试
npm run typecheck      # TypeScript 严格检查
npm run build          # 生产构建并生成 Service Worker
npm run test:e2e       # Playwright：断网、中断、校验失败与离线重载
npm run verify         # 单元测试 + 构建 + Playwright
```

Playwright 会在本地 127.0.0.1:4173 启动 Vite Preview。首次运行需要安装浏览器：

```bash
npx playwright install chromium
# 如果系统缺少浏览器依赖，在可提权环境执行：
npx playwright install --with-deps chromium
```

## Docker Compose

使用可覆盖的 `WEB_PORT` 托管静态站点，默认 `8080`：

```bash
docker compose build web
docker compose up -d web
# 打开 http://127.0.0.1:${WEB_PORT:-8080}

WEB_PORT=9091 docker compose up -d web
```

一次性验收服务会运行 `npm run verify`：

```bash
docker compose --profile verify build
docker compose --profile verify run --rm verify
```

`verify` 容器不发布端口，它在容器内启动自己的 Vite Preview 并执行 Playwright，退出码即验收结果。

## 清除浏览器缓存

开发或验收时若要模拟全新机器，请打开站点后在 DevTools Console 执行：

```js
const cacheNames = await caches.keys();
await Promise.all(cacheNames.map((name) => caches.delete(name)));
indexedDB.deleteDatabase('offline-manual-drill');
const registration = await navigator.serviceWorker.getRegistration('/');
await registration?.unregister();
location.reload();
```

也可以使用 Chrome/Edge DevTools：

1. Application → Storage → Clear site data。
2. Application → Service Workers → Unregister。
3. Application → Cache Storage，确认所有缓存已删除。
4. Application → IndexedDB，确认 `offline-manual-drill` 已删除。
5. 硬刷新页面。

## 存储设计

- `offline-manual-app-v1`：Service Worker 应用外壳缓存，包含 HTML、JS、CSS。
- `offline-manual-package-<版本>`：完整手册包缓存。安装中使用目标版本同名缓存，失败或中断会删除；激活后才由 Service Worker 作为当前包读取。
- IndexedDB `offline-manual-drill / state`：
  - `current-generation`：当前完整版本。
  - `installation`：安装状态、进度与失败原因。

不把故障演练结果放入 IndexedDB。未完成演练在切换版本时终止；已完成结论只保存在当前页面生命周期，并明确绑定通过时的版本。
