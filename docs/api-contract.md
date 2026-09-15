# API 契约

Base path: `/api`。无鉴权（需求确认）。所有响应 `Content-Type: application/json; charset=utf-8`，时间 ISO 8601。

## 端点总览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/reviews` | 创建审核任务（异步，立即返回） |
| GET | `/api/reviews` | 任务列表 |
| GET | `/api/reviews/:taskId` | 单任务状态 + 进度 |
| GET | `/api/reviews/:taskId/events` | SSE 实时进度流 |
| GET | `/api/reviews/:taskId/report` | 最终报告 |
| DELETE | `/api/reviews/:taskId` | 取消任务 |

---

## POST /api/reviews

`multipart/form-data`：

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `branch` | string | ✅ | 非空，合法 git 分支名 |
| `repoPath` | string | ✅ | 绝对路径，命中 `repoWhitelist` 前缀，且是已存在 git 仓库 |
| `taskId` | string | ❌ | 未提供则生成 `review-YYYYMMDD-xxxx`；提供时不得与现有任务冲突 |
| `baseBranch` | string | ❌ | 默认取 config `baseBranch`（默认 `main`） |
| `prevReportText` | string | ❌ | markdown 原文；与 `prevReportFile` 互斥 |
| `prevReportFile` | file | ❌ | `.md`，UTF-8，≤5MB；与 `prevReportText` 互斥 |
| `requirements` | string | ❌ | ≤2000 字符 |

**202 响应**（创建成功，任务已入队）：

```json
{
  "taskId": "review-20260914-a3f2",
  "status": "queued",
  "branch": "feature/login",
  "baseBranch": "main",
  "repoPath": "D:/work/project/xxx",
  "prevReport": "none",
  "createdAt": "2026-09-14T10:00:00+08:00",
  "links": {
    "status": "/api/reviews/review-20260914-a3f2",
    "events": "/api/reviews/review-20260914-a3f2/events",
    "report": "/api/reviews/review-20260914-a3f2/report"
  }
}
```

`prevReport` 取值：`none` | `text` | `file`。

**错误响应**（统一形状）：

```json
{
  "error": {
    "code": "REPO_NOT_WHITELISTED",
    "message": "repoPath 'D:/other' is not under any whitelist prefix",
    "details": {}
  }
}
```

| HTTP | code | 场景 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 字段缺失/格式非法 |
| 400 | `REPO_NOT_WHITELISTED` | 路径不在白名单 |
| 400 | `REPO_NOT_FOUND` | 路径不存在或不是 git 仓库 |
| 400 | `PREV_REPORT_CONFLICT` | 粘贴与上传同时传 |
| 400 | `TASK_ID_CONFLICT` | taskId 已存在 |
| 400 | `BRANCH_NOT_FOUND` | （同步阶段可提前探测时）分支远端不存在 |
| 429 | `QUEUE_BUSY` | 队列已满（预留，MVP 串行无限流可不启用） |

---

## GET /api/reviews

```json
{
  "tasks": [
    { "taskId": "...", "branch": "...", "status": "done", "createdAt": "...", "finishedAt": "..." }
  ],
  "total": 1
}
```

支持 query：`?status=reviewing&limit=20&offset=0`。

---

## GET /api/reviews/:taskId

```json
{
  "taskId": "review-20260914-a3f2",
  "branch": "feature/login",
  "baseBranch": "main",
  "repoPath": "D:/work/project/xxx",
  "status": "reviewing",
  "prevReport": "file",
  "requirements": true,
  "createdAt": "...",
  "startedAt": "...",
  "finishedAt": null,
  "progress": {
    "step": "reviewing",
    "activity": "正在读取 src/auth/login.ts",
    "toolCalls": 12,
    "elapsedSec": 87
  },
  "error": null
}
```

`error`（failed 时）：`{ "code": "GIT_SYNC_FAILED", "message": "pull conflict on feature/login" }`。

错误码：`TASK_NOT_FOUND`(404)。

---

## GET /api/reviews/:taskId/events（SSE）

`Content-Type: text/event-stream`。事件帧：

```
event: progress
data: {"status":"reviewing","activity":"正在执行 git diff","toolCalls":3,"elapsedSec":12}

event: status
data: {"status":"done","finishedAt":"..."}

event: error
data: {"code":"REVIEW_TIMEOUT","message":"..."}
```

- 连接建立时先补发当前状态快照（`event: snapshot`）。
- 任务到达终态后发送 `event: end` 并关闭流。
- 客户端断开不影响任务。

---

## GET /api/reviews/:taskId/report

任务为 `done` 时：

```json
{
  "taskId": "review-20260914-a3f2",
  "reportMarkdown": "# 代码审核报告 …（完整 markdown）",
  "issues": [ /* issues.json 内容，schema 见 prompt-templates.md */ ],
  "summary": { "total": 7, "new": 2, "fixed": 4, "unchanged": 1 },
  "generatedAt": "..."
}
```

未完成时返回 409 `{ "error": { "code": "REPORT_NOT_READY", "message": "status: reviewing" } }`；
结构化解析降级时 `issues: null` 且 `summary: null`，`reportMarkdown` 仍完整返回，并带 `"issuesWarning": "structured parse failed; see report only"`。

---

## DELETE /api/reviews/:taskId

- 非终态任务：杀 runtime 子进程，状态 → `cancelled`，返回 `200 { "taskId": "...", "status": "cancelled" }`。
- 已终态：`200` 幂等返回当前状态。
- 不存在：404。

---

## 领域错误码 → HTTP 映射（orchestrator 产生）

| code | HTTP | 场景 |
|---|---|---|
| `GIT_SYNC_FAILED` | —（记录在任务 error，不直接返回） | fetch/checkout/pull 失败（含认证） |
| `REVIEW_TIMEOUT` | — | 超过 reviewTimeoutMin |
| `HARNESS_CRASHED` | — | runtime 子进程异常退出 |
| `ISSUES_PARSE_FAILED` | — | JSON 区块两次校验失败（报告仍产出，降级模式） |
