# 需求规格（已确认）

状态：与需求方逐条确认，2026-09-14。本文档是需求的唯一权威；变更需先改这里。

## 1. 核心流程

用户通过 HTTP API 提交代码审核任务，服务完成：分支同步 → 多维度审核 → （可选）与上次报告对比 → 产出报告。

## 2. 功能需求

### FR-1 创建审核任务
- API 接收：`branch`（必填）、`taskId`（可空）、`prevReport`（粘贴文本或上传文件，二选一或都不传）、`requirements`（自定义审核要求，可空）、`baseBranch`（可空）。
- `taskId` 为空时服务端生成（格式 `review-YYYYMMDD-xxxx`），**创建响应立即返回 taskId**，审核异步执行。
- `prevReportText` 与 `prevReportFile` 同时传 → 400 拒绝（语义干净，避免歧义）。

### FR-2 仓库指定
- API 传**本机仓库路径**；服务端按 `repoWhitelist` 前缀白名单校验，不在白名单 → 400。
- 路径必须是已存在的 git 仓库（含 `.git`），否则 400。

### FR-3 分支同步（封装层执行，非 agent）
- 流程：`git fetch origin` → `git checkout <branch>` → `git pull --ff-only`。
- 失败场景返回结构化错误：分支不存在 / 有未提交改动 / pull 冲突 / 认证失败。
- 私有仓库用 `GIT_ACCESS_TOKEN` 注入认证（见 config.md 的安全约束）。

### FR-4 审核基准
- `baseBranch` 默认 `main`（config.yaml 可改默认值），请求可覆盖。
- 审核范围 = `git diff baseBranch...branch` 的变更文件；agent 可按需读取完整文件获取上下文。

### FR-5 多维度审核
- 维度：安全漏洞、bug、编码规范、性能、可维护性。
- 规范优先级：**项目内规范**（仓库根/目录的 `AGENTS.md`、`CLAUDE.md`、lint 配置等）> **全局规范**（`globalSpecPath` 指定的服务端文件）。prompt 中声明此优先级，agent 自行探测项目规范是否存在。

### FR-6 旧报告对比
- 输入支持两种，归一落盘到 `<repo>/.reviews/<taskId>/prev-report.md` 后下游路径完全一致：
  - 粘贴：`prevReportText`（markdown 原文）
  - 上传：`prevReportFile`（.md 文件，UTF-8 校验、大小上限 5MB）
- 传了旧报告：agent 逐条比对，每条 issue 标注 `status: fixed | new | unchanged`；**unchanged 的不展开重复描述**。
- 未传：纯新审核，报告注明"首次审核"。

### FR-7 自定义要求
- `requirements` 为空 → 只用系统审核模板。
- 非空 → 模板 + 自定义要求结合，规则：
  1. 输出契约（报告结构 + JSON 区块）不可协商、不可删除；
  2. 自定义要求只增不减（可加维度、加严标准、收窄范围）；
  3. 冲突时审核侧重以用户为准，报告格式以模板为准。
- 长度上限 2000 字符，超出 400。

### FR-8 报告产出
- markdown 正文（人读）+ 末尾 HTML 注释包裹的 `DSH-ISSUES` JSON 区块（机器读），schema 见 prompt-templates.md。
- 落盘：`<repo>/.reviews/<taskId>/report.md` + `issues.json`；同时是下一次该分支审核的潜在输入。

### FR-9 任务生命周期 API
- `POST /api/reviews` 创建；`GET /api/reviews` 列表；`GET /api/reviews/:taskId` 状态+进度；`GET /api/reviews/:taskId/events` SSE 实时进度；`GET /api/reviews/:taskId/report` 报告；`DELETE /api/reviews/:taskId` 取消。
- 状态机：`queued → syncing → reviewing → comparing → done`，旁路 `failed` / `cancelled`。
- 进度数据来自 SDK `session.event` 通知的工具调用摘录（`progress.activity` 人类可读）。

### FR-10 可配置项
- 模型 url、apikey（`.env`: `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY`）、模型名称与 provider（config.yaml）。
- `GIT_ACCESS_TOKEN`（.env）。
- 白名单、默认 base 分支、全局规范路径、超时、报告保留期、报告目录（config.yaml）。
- 详细清单见 config.md。

## 3. 非功能需求

- **鉴权**：不做（需求方确认，内网使用）。
- **并发**：MVP 串行队列，一任务一 runtime 子进程，任务结束回收。
- **超时**：单任务审核上限默认 15 分钟，超时置 `failed`。
- **保留**：报告默认保留 90 天（config 可改），过期清理由手动/定时脚本负责（MVP 可不做自动清理）。
- **取消**：杀 runtime 子进程（SDK 协议无会话级 cancel），状态置 `cancelled`。

## 4. 明确不做（本期）

- 对接 SSO/任何鉴权。
- 多实例部署 / 分布式任务队列。
- 报告的 Web UI（前端由需求方另行开发，本服务只供 API）。
- 自动清理过期报告的定时器（预留脚本即可）。

## 5. 待定项（实现中决定，须回填本文档）

- 报告正文的具体章节标题措辞（prompt-templates.md 定稿后回填 FR-8）。
- issue id 编号规则最终格式（建议 `P<severity首字母>-<序号>`，如 P0-1）。
