# 实现任务拆解

供 vibe coding 逐任务推进。每个任务：做完即提交，勾选并附一行偏差说明。任务顺序即依赖顺序；T1.1 是全项目的技术前提。

## M0 脚手架

- [x] **T0.1** 初始化仓库：package.json（ESM、Node ^22.19、pnpm）、tsconfig（strict）、vitest、oxlint、目录骨架（architecture.md §2）。验收：`pnpm run build && test && lint` 空转全绿。 ✔ 做了：工具链+健康检查骨架（src/app.ts+index.ts+tests/app.spec.ts），含 /healthz 端到端验证；pnpm v11 构建放行走 pnpm-workspace.yaml 的 allowBuilds。偏差：空目录不预建（git 不跟踪），各目录随对应任务落地；新增 tsconfig.tests.json 让 tests 纳入 typecheck。
- [x] **T0.2** `config.ts`：config.yaml + .env 加载、zod 校验、fail loud（config.md 全部规则，含白名单前缀归一化）。验收：单测覆盖缺失/非法/越界用例。 ✔ 做了：18 个单测全绿（聚合报错/越界/相对路径拒绝/规范文件存在性/环境变量优先级/dotenv 解析/白名单段级前缀匹配）；真实启动路径验证 exit=1 + 缺失项提示。决策：config.yaml 相对路径（globalSpecPath）以 config.yaml 所在目录为基准解析而非 cwd；含默认值的 config.yaml 入库供本地直接跑。
- [ ] **T0.3** 领域错误类型 + HTTP 错误映射表（api-contract.md 的 code 列表）。验收：单测。

## M1 Harness 适配层（技术风险集中区）

- [ ] **T1.1 ⚠️ spike** 验证 dshBin 启动：源码模式 `node --import tsx/esm apps/cli/src/bin.ts --profile sdk` 能否被 SDK 拉起；若 `dshBin` 只收路径则验证包装方案；同时验证 `pnpm run mock:llm` + `DEEPSEEK_BASE_URL` 无 key 通路。**结论回填 integration 文档 §5**。验收：一个可重复的冒烟脚本 `pnpm run smoke:harness`。
- [ ] **T1.2** `harness/runtime.ts`：DeepSeekHarness 生命周期封装（spawn/env 剥离/close/超时）。env 策略按 config.md：剥 `GIT_ACCESS_TOKEN`，保 `DEEPSEEK_*`。验收：单测（mock 进程）+ 真实冒烟（skipIf 无 key）。
- [ ] **T1.3** 通知订阅 → 进度摘录器：`session.event` 工具调用 → 人类可读 activity（progress.ts）。验收：伪造 notification 流单测 + 快照。
- [ ] **T1.4** 错误映射：四个 SDK 错误类 → `HARNESS_CRASHED` / `REVIEW_TIMEOUT` 等领域错误。验收：单测。

## M2 git 与报告模块

- [ ] **T2.1** `git/sync.ts`：fetch/checkout/pull --ff-only，结构化失败（分支不存在/未提交改动/冲突/认证）。验收：用临时 fixture 仓库单测四类失败。
- [ ] **T2.2** `git/auth.ts`：`GIT_ACCESS_TOKEN` 单命令注入（http.extraHeader），日志脱敏，不落盘不进 env。验收：单测断言命令构造与日志脱敏。
- [ ] **T2.3** `reports/persist.ts`：旧报告归一落盘（text/file 双入口）、报告+issues.json 写盘、`.reviews` 进 `.gitignore` 确保。验收：单测。
- [ ] **T2.4** `reports/issues.ts`：DSH-ISSUES 区块抽取 + schema 校验 + 一次重试 + 降级（prompt-templates.md §6 全流程）。验收：好/坏/重试成功/重试仍败四类单测。
- [ ] **T2.5** `specs/global-review-spec.md` 全局规范初版。验收：内容覆盖五大维度。

## M3 Prompt 组装

- [ ] **T3.1** `prompts/template.ts` + `assemble.ts`：模板 A/B/C 组装、定界注入、END 标记拒收、长度校验。验收：四组合快照测试（prompt-templates.md §7）。

## M4 编排与服务

- [ ] **T4.1** `orchestrator/registry.ts`：内存任务注册表 + taskId 生成。验收：单测（含并发创建冲突）。
- [ ] **T4.2** `orchestrator/orchestrator.ts`：状态机 + 串行队列 + 超时 + 取消（杀 runtime）+ 事件分发。验收：单测覆盖全状态迁移与两条旁路。
- [ ] **T4.3** `routes/`：六个端点 + multipart 校验 + SSE（快照补发/end 帧）+ 409/404 语义。验收：supertest 风格单测。
- [ ] **T4.4** 进程退出钩子：服务关闭逐一 close 存活 runtime。验收：单测。

## M5 端到端冒烟

- [ ] **T5.1** `pnpm run smoke:review`：对 `../deepseek-harness` 自身某分支跑一次完整审核（有 key），校验报告落盘与 JSON 合法。验收：脚本可重复执行。
- [ ] **T5.2** README 补"运行指南"章节；文档与实现最终一致性检查（回填所有"待验证/待定"标记）。

## 里程碑验收口径

- M0–M4 每个任务：单测绿 + build/lint 绿。
- M5：一条真实链路（创建→SSE 进度→报告获取）手工走通一次并记录。
