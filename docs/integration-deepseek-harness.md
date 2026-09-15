# DeepSeek Harness 集成指南

本文档是对上游 `../deepseek-harness` 的**事实摘要**（核对日期 2026-09-15）。与上游 README 冲突时以上游为准，并回改本文。上游关键参考：

- `packages/sdk/client/README.md` — TS SDK 客户端
- `packages/sdk/protocol/README.md` — 线协议
- `apps/cli/README.md` — dsh 启动器与 profile
- `packages/api/README.md` — 内部 Remote 层（本项目不用，但用于识别"哪些不是公开 API"）

## 1. 对接面选择

上游对外编程接口只有两个：**SDK JSON-RPC（stdio）** 和 **ACP**。本项目用 **TS SDK**：

- 我们 spawn `dsh --profile sdk` 子进程，通过 `@deepseek-ai/dsh-sdk-client` 驱动。
- 上游 Web 端口（127.0.0.1:3080）、`packages/api/` 的 Remote 方法是 GUI 内部层（pre-stable、带令牌鉴权），**不使用**。
- 上游禁止绕过 `dsh` 直启包 bin；SDK 客户端是官方许可的跨进程路径。

## 2. SDK 用法（来自上游 client README，已核对）

```ts
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'

await using harness = new DeepSeekHarness({
  profile: 'sdk',
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  // dshBin: '...',            // 不传则解析同版本 @deepseek-ai/dsh 可执行
  // env: {...},               // 整体替换子进程环境（undefined 继承父进程）
  // initializeTimeoutMs: 10_000,
  // maxTokens: 49_152,
})

const result = await harness.run(promptText, {
  sessionId: 'review-20260914-a3f2',   // 用 taskId 作 sessionId
  onNotification: (n) => { /* session.event 等，喂给进度摘录器 */ },
})
// result: RunResult { sessionId, finalResponse, events, notifications }
```

要点（实现 harness/runtime.ts 时遵守）：
- 子进程**懒启动**、跨 `run()` 复用；必须 `close()`（或 `await using`）回收，关闭阶梯 stdin EOF → SIGTERM → SIGKILL 内置且幂等。
- `run()` 返回的 `finalResponse` 是该区间内**最后一条已提交的根会话 assistant 文本**，不是因果配对——审核场景单 prompt 单回复，够用；不要拿它做多轮轮次归属。
- `session(id?)` 打开命名会话句柄；未知 sessionId 懒创建会话。
- 失败握手的实例会自动换新进程重试；初始化+清理双失败返回 `AggregateError`。

## 3. 线协议（notifications 是进度来源）

请求（3 个）：`initialize`（cwd/provider/model/reasoningEffort/maxTokens）、`session/prompt`（sessionId + contentBlocks，支持内联 base64 图片块）、`shutdown`。

服务端 → 客户端通知（4 个）：

| method | 载荷要点 | 我们怎么用 |
|---|---|---|
| `session.event` | `{ sessionId, event }` 每条会话日志事件 | **进度摘录**：工具调用 → `progress.activity` |
| `session.status` | `{ sessionId, status: 'idle'\|'running' }` | `running`→reviewing 心跳；`idle` 表示本轮结束（run() 内部也以 idle 收口） |
| `subagent.started` | 父/子会话 id | 进度显示"派出子任务"（若 agent 委派） |
| `subagent.finished` | 状态、stopReason、最后输出 | 进度收口 |

类型化错误（逐个 catch）：`JsonRpcResponseError`（wire error，带 code/data）、`RequestTimeoutError`、`SdkProtocolError`、`TransportClosedError`（runtime 死亡，消息带 exit code + stderr 尾部）→ 映射 `HARNESS_CRASHED`。

**协议无会话级 cancel**（cancel 只存在于上游内部 Remote 层）→ 我们的 DELETE = close() 杀子进程（架构决策 D6 的根据）。

## 4. 环境变量与 LLM 路由

- runtime 子进程调 LLM 读 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`（也支持根目录 `.env`）。
- 因此这两个变量**必须**传给 runtime（`env` 选项里保留）；`GIT_ACCESS_TOKEN` **必须剥离**。见 config.md 安全约束。
- 服务端会校验 provider/model 路由，不认识的路由握手就失败，错误信息含所选 profile 名。

## 5. dshBin / 启动方式（⚠️ 待验证项）

上游包均为 `private: true`，未发布公共 npm，`dshBin` 不传时 SDK 解析"同版本 `@deepseek-ai/dsh` 可执行"可能拿不到。上游给的两条正路：

1. **源码模式**：上游仓库根 `pnpm install && pnpm run build` 后，`pnpm dsh <args>`（= `node --import tsx/esm apps/cli/src/bin.ts`）。源码启动走 tsx 的 ESM hook，**触达的模块必须保持 ESM**。
2. **打包模式**：上游 `pnpm run release:pack` / Python wheel 内置可执行（`deepseek-harness-runtime-bin`）。

**MVP 决定**：`harness.runtime.dshBin` 配置项指向源码模式入口；`harness/runtime.ts` 需要处理"带 node 参数的启动"——若 SDK 的 `dshBin` 只接受可执行路径，则包一层 shell 脚本或验证 SDK 是否支持 spawn 命令数组。**这是 M1 阶段第一个 spike 任务（见 task-breakdown.md T1.1），结论回填本节。**

## 6. 与审核相关的上游行为

- **规范探测**：harness 启动即读工作区 `AGENTS.md`/`CLAUDE.md` 进系统上下文——我们的模板 A 仍显式要求 agent 探测规范，两层叠加，模板为准。
- **会话持久化**：session 数据由上游持久化（`$DSH_HOME` 下），我们不做会话管理，只需保证 taskId 唯一。
- **工具面**：agent 自带 fs / terminal（bash+pwsh）/ web 等能力；模板 A 已限制只读操作，依赖 agent 遵守 + 上游 permission 体系兜底，不额外改造。
- **上游 pre-stable**：SDK 协议可能变动。缓解：适配层隔离（CLAUDE.md 规则）+ 锁上游 commit/版本 + M1 spike 确认接口。

## 7. 本地验证方法

- 无 key 单测：mock JSON-RPC 帧（protocol 是 newline-delimited JSON over stdio，可伪造 notifications 流测进度摘录器）。
- 有 key 冒烟：`DEEPSEEK_API_KEY=... pnpm run smoke`（对上游仓库自身跑一次真实审核，上游 test:e2e 同样以该变量自跳过）。
- 上游 mock LLM：上游根 `pnpm run mock:llm` 可起本地假 LLM 服务，配合 `DEEPSEEK_BASE_URL` 指向它做无 key 集成测试（M1 spike 时验证与 sdk profile 的兼容性，结论回填 §5）。
