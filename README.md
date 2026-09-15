# Code Review Service

基于 DeepSeek Harness (`dsh`) 的自动化代码审核 API 服务。接收分支名，同步最新代码，调用 agent 多维度审核（安全/漏洞/bug/规范），支持与上一次审核报告对比，输出 markdown 报告 + 机器可读 issue JSON。

## 文档索引（vibe coding 必读顺序）

| 文档 | 内容 | 何时读 |
|---|---|---|
| [docs/requirements.md](docs/requirements.md) | 已确认的完整需求规格 | 项目启动前 |
| [docs/architecture.md](docs/architecture.md) | 架构图、组件职责、状态机、并发模型 | 动手前 |
| [docs/api-contract.md](docs/api-contract.md) | HTTP API 契约（端点/请求/响应/错误码） | 写接口时 |
| [docs/prompt-templates.md](docs/prompt-templates.md) | 系统审核模板、prompt 组装规则、issue JSON schema | 写审核逻辑时 |
| [docs/config.md](docs/config.md) | `.env` 与 `config.yaml` 配置参考 | 写配置模块时 |
| [docs/integration-deepseek-harness.md](docs/integration-deepseek-harness.md) | Harness SDK 集成指南（协议、用法、坑） | 写 runtime 适配层时 |
| [docs/task-breakdown.md](docs/task-breakdown.md) | 实现任务拆解与验收标准 | 每次开发会话 |

## 技术栈

- **语言/运行时**: TypeScript, Node ^22.19
- **HTTP 框架**: Hono
- **Harness 对接**: `@deepseek-ai/dsh-sdk-client`（JSON-RPC over stdio）
- **上游依赖**: `deepseek-harness` 仓库（本目录的兄弟目录 `../deepseek-harness`）

## 状态

设计阶段完成，实现未开始。从 [docs/task-breakdown.md](docs/task-breakdown.md) 的 M0 开始。

## Claude Code 辅助设施

- `CLAUDE.md` — 主指令（边界/约束/工作流/验证要求）
- `.claude/settings.json` — 权限：常用 pnpm/git 命令免确认；**硬拒绝**对上游 `../deepseek-harness` 的任何写入
- `.claude/skills/dsh-lookup/` — 查证上游行为的既定流程 + 速查表（`/dsh-lookup` 或自动触发）
- `.claude/skills/smoke-review/` — 真实链路冒烟操作规程
- `.claude/commands/next-task.md` — 输入 `/next-task` 认领并实现下一个任务
- `.gitignore` — .env / 报告产物等不进库
