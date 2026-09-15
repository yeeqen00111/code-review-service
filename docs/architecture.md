# 架构设计

## 1. 组件图

```
┌─────────────────────────────────────────────────────────────────────┐
│                              前端                                     │
│        创建任务 │ 轮询状态 / SSE 进度 │ 拉取报告                        │
└──────┬────────────────▲───────────────▲──────────────────────────────┘
       │ POST/GET/DELETE│ JSON / SSE    │ markdown + issues.json
┌──────▼────────────────┴───────────────┴──────────────────────────────┐
│                     审核服务 (HTTP API 层)  — routes/                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌─────────────────────┐  │
│  │ 请求校验  │  │ 任务注册表 │  │ 进度摘录器  │  │ SSE 推送            │  │
│  │ (zod)    │  │ (内存Map) │  │ activity/ │  │ (events 端点)       │  │
│  └──────────┘  └────┬─────┘  └─────▲─────┘  └──────────▲────────┘  │
│                     │              │ session.event      │           │
│  ┌──────────────────▼──────────────┴────────────────────┴────────┐  │
│  │                审核编排器 orchestrator/ (核心)                   │  │
│  │  状态机 · 串行队列 · 超时 · 取消 · 事件分发                        │  │
│  └───┬──────────────┬──────────────────────────────┬─────────────┘  │
└──────┼──────────────┼──────────────────────────────┼─────────────────┘
       │              │                              │
       ▼              ▼                              ▼
┌────────────┐  ┌──────────────────┐  ┌─────────────────────────────────┐
│ git/       │  │ reports/         │  │ harness/ (SDK 适配)              │
│ fetch/     │  │ 旧报告归一落盘     │  │  DeepSeekHarness 封装            │
│ checkout   │  │ report.md 落盘    │  │  prompt 组装 (prompts/)          │
│ pull       │  │ issues.json 解析  │  │  DSH-ISSUES 区块抽取+校验        │
│ (token注入) │  │ +schema 校验     │  │         │ JSON-RPC (stdio)      │
└─────┬──────┘  └────────┬─────────┘  └─────────┼───────────────────────┘
      ▼                  ▼                      ▼
┌────────────┐  ┌──────────────────┐  ┌─────────────────────────────────┐
│ 目标仓库    │  │ <repo>/.reviews/ │  │  dsh runtime 子进程               │
│ (白名单内)  │  │  <taskId>/       │  │  dsh --profile sdk               │
└────────────┘  │  prev-report.md  │  │  agent loop: fs/terminal 工具     │
                │  report.md       │  │  规范探测: 项目 > 全局             │
                │  issues.json     │  └──────────────┬──────────────────┘
                └──────────────────┘                 │ HTTPS (DEEPSEEK_*)
                                                     ▼
                                        ┌─────────────────────────┐
                                        │  LLM (DeepSeek/私有网关)  │
                                        └─────────────────────────┘
```

## 2. 目录结构（目标）

```
code-review-service/
├─ CLAUDE.md / README.md
├─ docs/                        # 本套文档
├─ config.example.yaml          # 配置模板
├─ specs/
│  └─ global-review-spec.md     # 全局审核规范（兜底）
└─ src/
   ├─ index.ts                  # 启动装配
   ├─ config.ts                 # .env + config.yaml 加载与校验
   ├─ routes/                   # Hono 路由（薄，只做校验和编排器调用）
   │  ├─ reviews.ts
   │  └─ errors.ts              # 领域错误 → HTTP 映射
   ├─ orchestrator/
   │  ├─ orchestrator.ts        # 状态机 + 串行队列
   │  ├─ registry.ts            # 任务注册表（内存 Map）
   │  └─ progress.ts            # session.event → activity 摘录
   ├─ git/
   │  ├─ sync.ts                # fetch/checkout/pull
   │  └─ auth.ts                # GIT_ACCESS_TOKEN 注入（单命令级）
   ├─ reports/
   │  ├─ persist.ts             # 归一落盘 / 报告写盘
   │  └─ issues.ts              # DSH-ISSUES 抽取 + schema 校验
   ├─ prompts/
   │  ├─ template.ts            # 系统模板（快照测试锁定）
   │  └─ assemble.ts            # 模板 + 自定义要求 + 对比指令
   └─ harness/
      └─ runtime.ts             # DeepSeekHarness 生命周期（spawn/close）
```

## 3. 任务状态机

```
queued ──► syncing ──► reviewing ──► comparing ──► done
   │           │            │             │
   └───────────┴────────────┴─────────────┴──► cancelled (DELETE)
               │            │             │
               └────────────┴─────────────┴──► failed
                        (同步失败/超时/runtime崩溃/JSON解析失败降级不算failed)
```

| 状态 | 含义 | 进入条件 | 退出 |
|---|---|---|---|
| queued | 排队中 | 创建成功 | 队列轮到 |
| syncing | git 同步 | 开始执行 git 命令 | 同步成功→reviewing；失败→failed |
| reviewing | agent 审核 | runtime 收到 prompt | 收到 finalResponse→comparing |
| comparing | 报告生成/对比解析 | finalResponse 到达 | issues.json 校验通过→done |
| done | 完成 | 报告+JSON 落盘 | 终态 |
| failed | 失败 | 上述任一失败或超时 | 终态 |
| cancelled | 已取消 | DELETE 且任务未到终态 | 终态 |

## 4. 单次任务时序

```
前端          API服务           git            SDK/runtime        LLM
 │ POST /reviews│                │                │               │
 │─────────────►│ ①校验+生成taskId│                │               │
 │              │──fetch/pull───►│ ②同步(带token)  │               │
 │              │ ③旧报告落盘     │                │               │
 │◄─202{taskId}─│ ④拼prompt      │                │               │
 │              │────────────────────────────────►│ ⑤session/prompt│
 │              │                 │               │────prompt────►│
 │ GET /:id/events               │               │   工具调用循环   │
 │─────────────►│ ⑥session.event  │               │◄──┬────────────│
 │◄──SSE────────│◄────────────────────────────────│   │读文件/执行命令│
 │              │ ⑦finalResponse  │               │◄──────────────│
 │              │ ⑧抽JSON+校验+落盘│               │               │
 │ GET /:id/report               │               │               │
 │─────────────►│◄───────────────│               │               │
 │◄─报告+对比结论─│                │               │               │
```

## 5. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | git 同步在封装层，不进 agent | 确定性操作快速失败；token 不进 runtime 环境 |
| D2 | 粘贴/上传旧报告归一落盘成文件 | 两入口一条下游路径；大报告不占 prompt |
| D3 | prompt = 固定模板 + 定界自定义要求 | 输出契约不可破；基本注入防御 |
| D4 | 进度来自原生 `session.event` | 无需自己埋点；摘录式不做全量存储 |
| D5 | JSON 区块解析 + 校验 + 一次重试 + 降级 | 对比与前端渲染的机器依据；降级优于丢弃 |
| D6 | 一任务一 runtime 子进程，串行队列 | 取消=杀进程语义干净；隔离 token/会话；MVP 足够 |
| D7 | `.env` 只在封装层进程，runtime 用干净 env | 防 token/凭证被 agent shell 间接读取 |
| D8 | 路径白名单 | 传路径模式的安全闸门，防任意目录代码执行 |
| D9 | 报告落 `<repo>/.reviews/<taskId>/` | 报告跟仓库走，git 同步不冲突（建议该目录进 .gitignore 由 git/ 模块确保） |

## 6. 并发与资源模型

- 全局一个串行队列；并发数 1（config 可预留字段 `concurrency`，MVP 恒为 1）。
- 每个 `DeepSeekHarness` 实例 = 一个 `dsh --profile sdk` 子进程；任务结束必须 `close()`（含 stdin EOF → SIGTERM → SIGKILL 阶梯，SDK 内置）。
- 进程退出钩子：服务关闭时逐一 close 所有存活 runtime。
- SSE 连接是只读旁路，断开不影响任务执行。
