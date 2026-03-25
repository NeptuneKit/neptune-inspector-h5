# Neptune Inspector H5 面板扩展

## 目标

- 新增 `clients` 面板，读取 `GET /v2/clients`，支持勾选并通过 `PUT /v2/clients:selected` 全量提交
- 新增 `metrics` 面板，读取 `GET /v2/metrics`
- 保持 `logs` 面板的长轮询增量拉取
- 新增 `Inspector WS` 面板，自动连接 `/v2/ws`，发送 `hello(role=inspector)` 和 heartbeat
- 支持 `command.send(ping)` 下发，并展示 `ack` / `event.command_ack` / `event.command_summary` / `event.log_record`

## 验收

- 页面可以同时展示 logs、clients、metrics
- logs 支持 `afterId + waitMs` 长轮询
- clients 和 metrics 可从网关读取并展示快照
- clients 勾选后可通过 `PUT /v2/clients:selected` 全量提交
- WS 面板可观察连接状态、下发 ping 命令和 ACK 事件流
- `npm test` 与 `npm run build` 通过
