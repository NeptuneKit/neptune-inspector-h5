# Neptune Inspector H5 客户端详情化重构

## 目标
- 首页仅展示客户端列表。
- 点击客户端进入详情页。
- 详情页仅保留 `日志` Tab，展示该客户端历史 + 实时日志。

## 页面结构
- `/`：客户端列表页。
  - 输入/保存 Gateway Base URL
  - `GET /v2/clients` 拉取客户端快照并按 `lastSeenAt` 排序
  - 每个客户端支持“进入详情”
- `/clients/:clientKey`：客户端详情页。
  - 顶部展示客户端身份（platform/appId/sessionId/deviceId）
  - 日志 Tab：历史日志、实时日志、自动滚动、清空、手动刷新
- `/clients/:clientKey/views`：客户端视图信息页（v1）。
  - `GET /v2/ui-tree/snapshot?platform&appId&sessionId` 拉取组件树快照
  - 以树形方式展示最小节点信息：`id/name/children`
  - 支持手动刷新
  - 新增渲染模式切换：`Tree / 2D / 3D`
  - 2D/3D 都基于同一份节点快照，不新增网关字段依赖

## 数据与协议
- 保持网关协议不变：`/v2/clients`、`/v2/logs`、`/v2/ws`
- 详情历史日志：按 `platform/appId/sessionId` 请求 `/v2/logs`
- `deviceId` 作为前端补充过滤条件
- 视图信息页：按 `platform/appId/sessionId` 请求 `/v2/ui-tree/snapshot`
- 实时日志：连接 `/v2/ws`，发送 `hello(role=inspector)`，消费 `event.log_record` 作为“有更新”通知信号
- 收到 WS 通知后，再发起一次 `GET /v2/logs?afterId=<lastRecordId>` 增量拉取日志（WS notify + HTTP fetch）
- 不启用固定间隔轮询，避免高频 `GET /v2/logs` 持续请求
- `/v2/logs` 响应兼容策略：`nextCursor` 字段缺失时按 `null` 处理（兼容旧网关的可选字段编码）

## 验收场景（BDD）
- Given 进入 `/clients/:clientKey/views`
- When 网关返回合法的 `ui-tree snapshot` JSON
- Then 页面展示组件树节点并可看到 `snapshotId/capturedAt/platform`
- And 默认显示 2D 视图画布（可见节点卡片）
- When 用户切换到 `3D`
- Then 页面展示 3D 画布（可见节点卡片的深度分层）
- When 用户切换到 `Tree`
- Then 页面展示原始树形列表
- Given `clientKey` 非法
- When 打开 `/clients/:clientKey/views`
- Then 页面提示“无效客户端标识”，且不触发 snapshot 请求
- Given 网关 `/v2/logs` 返回 `records` 和 `hasMore`，但缺失 `nextCursor`
- When 详情页请求历史日志
- Then 页面不报 `Invalid logs payload`
- And 历史日志请求结果中的 `nextCursor` 被视为 `null`
- Given 已在客户端详情页建立 WS 连接
- And 页面因日志渲染触发重渲染，但 `baseUrl` 与 `identity` 不变
- When hook 接收到新的 `onRecord/onStatusChange` 回调引用
- Then 不重建 WS 连接（不重复触发 `hello` 握手）
- And 后续消息仍能命中最新回调
- Given 已完成一次历史日志加载，当前 `lastRecordId=100`
- When 收到 `event.log_record` WS 事件
- Then 客户端触发一次 HTTP 增量拉取：`GET /v2/logs?...&afterId=100`
- And 在没有新 WS 事件时，不持续发起固定间隔 HTTP 轮询

## 非目标（本轮下线）
- 旧单页并列面板（metrics / ws inbox / ping / selected clients 提交）
