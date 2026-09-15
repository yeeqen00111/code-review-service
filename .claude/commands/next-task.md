---
description: 认领 task-breakdown.md 中下一个未完成任务并按 CLAUDE.md 工作流实现到验收
---

按以下流程推进下一个任务：

1. 读 `docs/task-breakdown.md`，找到**第一个未勾选**任务（按顺序，不跳步）。若该任务的前置任务有"偏差说明"，先读一遍。
2. 向我复述：任务编号、目标、验收标准、你计划动哪些文件（不超过 10 行），等我确认。
3. 实现：遵守 CLAUDE.md 的架构约束（分层、安全红线、prompt 契约）与编码规范。依赖上游行为且没把握时，用 dsh-lookup skill 查证后再写。
4. 验证：补齐任务要求的单测/快照，`pnpm run build && pnpm run test && pnpm run lint` 全绿。
5. 收尾：task-breakdown.md 勾选该任务并附一行"做了什么/偏差说明"；git add 相关文件并提交（message: `feat(scope): ...` 等，**不加任何 AI 署名或 Co-Authored-By 行**，提交身份用仓库局部配置的 111lw）。
6. 报告结果：改动摘要 + 测试输出 + 是否有文档回填。

遇到与文档冲突的设计问题：停下来问我，先改文档再写码。
