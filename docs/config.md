# 配置参考

配置分两层：**`.env`（敏感，不进 git）** 和 **`config.yaml`（非敏感，可进 git）**。加载顺序：`config.yaml` → 环境变量覆盖 → 启动时整体 zod 校验，缺失/非法**快速失败**（服务拒绝启动并打印缺失项）。

## `.env`

| 变量 | 必填 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | ✅ | 模型 apikey。Harness 的 LLM provider 原生读取此变量名 |
| `DEEPSEEK_BASE_URL` | ❌ | 模型网关地址。不设则用 DeepSeek 官方默认；指向私有网关时设置 |
| `GIT_ACCESS_TOKEN` | ❌ | git 访问令牌，用于私有仓库 fetch/pull。不设则用本机已有 git 凭证 |

**安全约束（CLAUDE.md 规则 3 的展开）**：
- 三个变量只存在于封装层进程环境；启动 runtime 子进程时用 SDK 的 `env` 选项传入**剥离后的干净环境**（至少剥掉 `GIT_ACCESS_TOKEN`；`DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL` 例外——runtime 自身需要它们调 LLM，见 integration 文档 §4）。
- `GIT_ACCESS_TOKEN` 只在 `git/` 模块单条命令中注入（如 `git -c http.extraHeader="Authorization: Bearer <token>" fetch ...`），禁止：写入日志、写入 prompt、写入任务注册表、设为 runtime 子进程环境变量。
- token 注入命令在日志中必须脱敏（替换为 `<redacted>`）。

## `config.yaml`

```yaml
# ── Harness / 模型 ──────────────────────────────
provider: deepseek-official     # SDK initialize 的 provider 路由
model: deepseek-v4-flash        # 模型名称（按上游实际可用模型调整）
# reasoningEffort: max          # 可选，透传 SDK
# maxTokens: 49152              # 可选，单请求输出上限

# ── Harness runtime ────────────────────────────
harness:
  profile: sdk                  # 固定用 sdk profile
  # dshBin: D:/work/.../deepseek-harness/apps/cli  # 源码模式下的启动入口，见 integration 文档 §5；不设则依赖 SDK 默认解析
  initializeTimeoutMs: 10000    # SDK 默认值，可覆盖

# ── 仓库与审核 ──────────────────────────────────
repoWhitelist:                  # repoPath 必须命中其中至少一个前缀
  - D:/work/project
baseBranch: main                # 请求未传 baseBranch 时的默认值
globalSpecPath: ./specs/global-review-spec.md

reviewTimeoutMin: 15            # reviewing 阶段超时上限

# ── 报告 ────────────────────────────────────────
reportsDirName: .reviews        # 报告落在 <repo>/<reportsDirName>/<taskId>/
prevReportMaxBytes: 5242880     # 上传旧报告上限（5MB）
requirementsMaxChars: 2000

# ── 服务 ────────────────────────────────────────
port: 3120
concurrency: 1                  # MVP 恒为 1；字段预留
reportRetentionDays: 90         # 仅记录，自动清理脚本本期不实现
```

## 校验规则（config.ts）

- `repoWhitelist` 非空且每项为绝对路径（归一化为正斜杠后缀 `/` 做前缀匹配，防 `D:/work/project-evil` 误命中 `D:/work/project`）。
- `globalSpecPath` 文件必须存在，否则启动失败（无兜底规范时"没有项目规范就没规范可依"，属于错误配置，要 fail loud）。
- `model`/`provider` 启动时不校验（由 runtime initialize 时校验，SDK 会在握手失败时给出含 profile 名的错误），首次任务失败即暴露。
- 所有数值字段带上下界（如 `port` 1–65535，`reviewTimeoutMin` 1–120）。

## `specs/global-review-spec.md`

全局兜底审核规范，本仓库自带初版（见 `specs/global-review-spec.md`），内容为通用的安全/bug/规范检查清单。需求方后续可替换为团队自有规范，路径通过 `globalSpecPath` 指向。
