---
name: dsh-lookup
description: 核对 DeepSeek Harness 上游行为的既定流程：上游仓库只读，结论必须带 file:line 出处并回填 docs/integration-deepseek-harness.md。当实现中不确定 SDK/协议/dsh CLI 的行为时使用。
---

# 查证上游 Harness 行为

## 何时用

实现任何 harness 适配逻辑（`src/harness/`）前，若对 SDK 行为没有把握：`run()` 语义、通知时机、env 处理、dshBin 解析、profile 行为等。**禁止凭记忆猜上游行为。**

## 上游速查表

上游根：`../deepseek-harness`（只读，settings.json 已 deny 写入）。

| 主题 | 文件 |
|---|---|
| TS SDK 客户端契约（run/session/close/错误类） | `packages/sdk/client/README.md`，实现 `src/api.ts` `src/client.ts` |
| 线协议（请求/通知/错误码） | `packages/sdk/protocol/src/types.ts`、`src/transport.ts` |
| dsh 启动器、profile、源码执行契约 | `apps/cli/README.md`、`apps/cli/reference/README.md`、`apps/cli/src/bin.ts` |
| jsonrpc 服务端插件（initialize 校验、fallback） | `packages/sdk/server/` |
| LLM provider 与 DEEPSEEK_* 环境变量 | `packages/llm/` 各 README |
| 会话事件类型（progress 摘录要用） | `packages/session/` 中 `SessionEventMap` 定义 |
| mock LLM 服务 | `packages/test-support/llm-mock-server/`，上游根 `pnpm run mock:llm` |
| cordis 配置/patch 组装 | `docs/cordis-primer.md` |

## 流程

1. 先读对应 README（上游 README 契约密度很高，多数问题止步于此）。
2. README 不够 → 读 src 源码，必要时看对应 `tests/`。
3. 结论记入 `docs/integration-deepseek-harness.md` 对应小节（标注核对日期与 file 路径）；若推翻了我们文档的既有描述，同时修正 CLAUDE.md/architecture.md 的相关表述。
4. 回复中引用 `file:line` 出处。
