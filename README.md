# neptune-inspector-h5

NeptuneKit v2 H5 Inspector，专注日志查看与长轮询增量拉取。

## 功能

- 输入 gateway baseURL
- 查看 `/v2/logs` 日志列表
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

## 对接约定

- 默认 gateway：`http://127.0.0.1:18765`
- 日志接口：`GET /v2/logs`
- 轮询接口：`GET /v2/logs?afterId=<id>&waitMs=<ms>&limit=<n>`
