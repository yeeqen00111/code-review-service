---
name: smoke-review
description: 运行真实链路冒烟（需 DEEPSEEK_API_KEY）：验证 harness runtime 拉起、审核任务端到端、报告落盘。M1 适配层与 M5 端到端验收时使用。
---

# 冒烟测试

## 前置

- `.env` 中有 `DEEPSEEK_API_KEY`（或 shell 已导出）；可选 `DEEPSEEK_BASE_URL` 指向私有网关。
- 上游 `../deepseek-harness` 已 `pnpm install && pnpm run build`（源码模式运行需要构建产物）。
- 无 key 时改走 mock 路径：上游根 `pnpm run mock:llm` 起本地假 LLM，`DEEPSEEK_BASE_URL` 指向它（T1.1 spike 验证其与 sdk profile 的兼容性后再依赖）。

## 冒烟项

| 脚本（实现后补齐） | 验证 |
|---|---|
| `pnpm run smoke:harness` | T1.1：dshBin 源码模式拉起 `dsh --profile sdk`，一次 initialize + 空闲往返 |
| `pnpm run smoke:review` | T5.1：对 `../deepseek-harness` 自身某分支跑完整审核：创建→SSE 进度→报告落盘→issues.json 过 schema |

## 规则

- 冒烟失败先分类：环境问题（key/构建产物/网络）vs 代码缺陷，再动手改。
- 每次冒烟把结论（通过/失败原因/环境备注）追加到 `docs/integration-deepseek-harness.md` §7 的记录列表。
- 冒烟产物（`.reviews/` 报告）不提交。
