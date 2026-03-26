# AGENTS 执行规范（精简可执行版）

## 0. 路径规范（不可删）
以下目录结构为长期约束，后续修改 AGENTS 时不得删除，只能增补：

```
.
├── MEMORY.md          # 主记忆文件（过期, 后续改为 docs-linhay/memory/MEMORY.md）
├── AGENTS.md          # 行为规则，可按任务优化但需保留路径规范
├── references/        # 参考项目目录(过期, 后续改为 docs-linhay/references/)
├── screenshots/       # 截图测试目录(过期, 后续改为 docs-linhay/screenshots/)
├── docs-dev/          # 项目文档系统(过期, 后续改为 docs-linhay/)
├── memory/            # 每日日志目录（过期, 后续改为 docs-linhay/memory/）
└── docs-linhay/       # 项目文档系统目录：开发计划/需求文档/技术文档等（按文件夹分类）
    ├── dev/
    ├── features/
    ├── memory/        # 记忆系统（MEMORY.md + 每日日志）
    ├── plans/
    ├── references/    # 参考项目
    ├── screenshots/   # 截图（迁移自根目录 screenshots/）
    └── scripts/
```

## 1. 迁移指南（旧项目）

旧项目按以下映射逐步迁移，迁移完成后删除旧目录：

| 旧路径 | 新路径 | 说明 |
|--------|--------|------|
| `MEMORY.md` | `docs-linhay/memory/MEMORY.md` | 主记忆文件 |
| `memory/` | `docs-linhay/memory/` | 每日日志目录，文件名不变 |
| `references/` | `docs-linhay/references/` | 参考项目目录 |
| `screenshots/` | `docs-linhay/screenshots/` | 截图目录，保留原有分层结构 |
| `docs-dev/dev/` | `docs-linhay/dev/` | 研发文档 |
| `docs-dev/features/` | `docs-linhay/features/` | 需求与功能规格 |

迁移步骤：
1. 在项目根目录创建 `docs-linhay/` 及所需子目录。
2. 按映射表逐目录移动文件（`mv`），保留 git 历史（推荐 `git mv`）。
3. 全局搜索替换文档内的旧路径引用。
4. 验证无遗漏后删除旧目录。
5. 提交时备注：`chore: migrate to docs-linhay structure`。

## 2. 全局原则
1. BDD + TDD 必须先行：先场景/验收标准，再失败测试，再实现。
2. 全程中文沟通。
3. 小步提交、可回归验证，避免大块不可控改动。
4. E2E 场景覆盖核心功能，单元测试覆盖边界条件。
5. 文档与记忆同步更新，保持信息一致性。
6. 任何改动都要考虑对后续维护者的可理解性和可操作性。

## 3. 标准工作流（必须）
1. 明确需求边界与验收条件（BDD 场景）。
2. 先补测试并确认失败（红灯）。
3. 最小实现让测试通过（绿灯）。
4. 必要重构并保持测试通过。
5. 更新相关文档与记忆。

## 4. 测试门禁（必须）
1. 任何功能改动都要有对应测试（新增或更新）。
2. 未运行测试时必须明确说明原因与风险。
3. 禁止“只改代码不验证”。

## 5. 文档系统规则（docs-linhay）
`docs-linhay/` 是项目文档系统目录，按类型分文件夹：
1. `docs-linhay/dev/`：研发文档（架构、技术方案、测试策略、数据字典等）。
1. `docs-linhay/features/`：需求与功能规格（愿景、功能 spec）。
2. `docs-linhay/memory/`：记忆系统（MEMORY.md + 每日日志 YYYY-MM-DD.md）。
3. `docs-linhay/plans/`：开发计划、迭代规划、里程碑（不含技术方案）。
4. `docs-linhay/references/`：参考项目、外部资料归档。
5. `docs-linhay/screenshots/`：截图，按日期/模块分层存放。
6. `docs-linhay/scripts/`：自动化脚本及其说明文档。

文档落位规则：
1. 需求变更：先改 `docs-linhay/features/`，再改代码。
2. 技术方案：放 `docs-linhay/dev/`，并链接对应 feature 文档。
3. 开发计划/迭代规划：放 `docs-linhay/plans/`。
4. 外部参考资料：归档到 `docs-linhay/references/`。

## 6. 记忆系统规则（必须）

### 6.1 Retrieval（查询）
查询历史信息时，禁止先全量读取 `docs-linhay/memory/MEMORY.md` 或 `docs-linhay/memory/*.md`。按顺序执行：
1. `qmd query "<问题>"`
2. `qmd get <file>:<line> -l 20`
3. 仅当 qmd 无结果时，才回退直接读文件

### 6.2 Writeback（写回）
出现以下情况必须写入记忆：关键决策、行动项、偏好变化、里程碑、风险结论。
1. 写入 `docs-linhay/memory/YYYY-MM-DD.md`
2. 执行 `qmd update && qmd embed`
3. 每周合并到 `docs-linhay/memory/MEMORY.md`（只保留稳定高价值信息）

### 6.3 Collection 管理
`qmd` 需支持自动建立 collection，规则如下：
1. 首次在项目中执行 `qmd update` 时，若 collection 不存在，自动创建。
2. collection 名称与项目目录名保持一致。
3. 跨项目查询时，通过 `qmd query --collection <name> "<问题>"` 指定 collection。
4. CI/CD 环境中应跳过 collection 初始化（通过环境变量 `QMD_SKIP_INIT=1` 控制）。

### 6.4 三层节奏
1. Daily Sync：每天 23:00
2. Weekly Compound：周日 22:00
3. Micro-Sync：10/13/16/19/22 点（仅有重要活动时写入）

## 7. 完成定义（DoD）
1. 验收场景满足。
2. 相关测试通过（或已说明阻塞与风险）。
3. 文档已更新到正确目录。
4. 有意义变更已写入记忆并可检索。

## 8. 截图规范（docs-linhay/screenshots/）
截图统一存放在 `docs-linhay/screenshots/`，命名格式：`<YYYYMMDD>-<模块>-<场景>-<状态>-v<序号>.png`

字段说明：
- `YYYYMMDD`：拍摄日期（如 `20260303`）
- `模块`：功能域（如 `login`、`order`、`profile`）
- `场景`：操作或用例关键词（如 `empty-state`、`success-submit`）
- `状态`：`before` / `after` / `baseline` / `failed`
- `序号`：两位起（如 `01`、`02`）

目录分层（两级）：
1. 一级：日期 `YYYYMMDD/`
2. 二级：模块名（如 `login/`、`order/`、`profile/`）

示例：`docs-linhay/screenshots/20260303/login/20260303-login-empty-state-before-v01.png`

补充规则：
1. 多端截图在场景后追加端标识：`-ios` / `-android` / `-web`。
2. 禁止使用中文文件名、空格、`latest`、`final` 等不可追踪命名。
3. 同一改动至少保留一组 `before` 与 `after`，用于回归对比。
4. 同一次需求/修复的截图尽量放在同一日期目录下。
5. 跨天续测时，新日期新目录，不覆盖旧图。
6. 若模块不明确，暂存到 `docs-linhay/screenshots/YYYYMMDD/misc/`，任务结束前必须归档。
