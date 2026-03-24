# neptune-inspector-h5

NeptuneKit v2 H5 Inspector，查看 logs、sources、metrics 三类网关快照。

## 功能

- 输入 gateway baseURL
- 查看 `/v2/logs` 日志列表
- 查看 `/v2/sources` 注册来源
- 查看 `/v2/metrics` 聚合指标
- 按 `platform` / `appId` / `sessionId` / `level` 文本过滤
- 支持 `afterId + waitMs` 长轮询拉新

## 开发

```bash
npm install
npm run dev
```

## 构建与测试

```bash
npm run build
npm test
```

## 作为 macOS app 资源产物

`neptune-inspector-h5` 的标准桌面资源产物是 `dist/`。

本仓库提供统一构建脚本，供本地开发、CI 和 macOS 壳应用复用：

```bash
./scripts/build-desktop-assets.sh
```

脚本会执行 `npm ci`、清理旧的 `dist/`，再运行 `npm run build`，最终产出可直接被 `neptune-desktop-macos` 消费的静态资源目录。

desktop app 会优先读取以下位置之一：

1. `NEPTUNE_INSPECTOR_DIST` 指定的目录
2. 本仓库构建出的 `dist/`
3. 打包进 macOS app bundle 的 `Resources/inspector/`

## CI

仓库配置了 GitHub Actions：

- `push` 到 `main`
- 所有 `pull_request`

构建和测试的入口是：

```bash
./scripts/build-desktop-assets.sh
npm test
```

其中 `build-desktop-assets.sh` 会先执行 `npm ci`，再生成 `dist/`；CI 会在测试通过后上传 `dist/` artifact，供后续发布流水线或 macOS 打包步骤复用。

## 对接约定

- 默认 gateway：`http://127.0.0.1:18765`
- 日志接口：`GET /v2/logs`
- 轮询接口：`GET /v2/logs?afterId=<id>&waitMs=<ms>&limit=<n>`
- 来源接口：`GET /v2/sources`
- 指标接口：`GET /v2/metrics`
