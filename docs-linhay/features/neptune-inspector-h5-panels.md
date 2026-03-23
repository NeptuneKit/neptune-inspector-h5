# Neptune Inspector H5 面板扩展

## 目标

- 新增 `sources` 面板，读取 `GET /v2/sources`
- 新增 `metrics` 面板，读取 `GET /v2/metrics`
- 保持 `logs` 面板的长轮询增量拉取

## 验收

- 页面可以同时展示 logs、sources、metrics
- logs 支持 `afterId + waitMs` 长轮询
- sources 和 metrics 可从网关读取并展示快照
- `npm test` 与 `npm run build` 通过
