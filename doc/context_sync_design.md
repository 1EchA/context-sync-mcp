# Coding Agent 上下文跨设备同步工具设计

> 日期：2026-03-19
> 状态：设计中（v2 — 参考官方最佳实践优化）

## 核心思路

用户在切换设备前输入命令触发上下文压缩并同步，在新设备开新会话时自动恢复上下文。

## 官方最佳实践参考

### Claude Code 的记忆体系

Claude Code 有两套互补的记忆系统：

**1. CLAUDE.md（显式记忆）**
- 手动编写的项目级指令文件，每次会话自动加载
- 支持层级：用户级 `~/.claude/CLAUDE.md` → 项目级 `./CLAUDE.md` → 目录级

**2. Auto Memory（自动记忆）**
- 存储在 `~/.claude/projects/<project>/memory/` 下
- 结构：`MEMORY.md`（索引，每次加载）+ 按主题分的详细文件（`debugging.md`、`api-conventions.md` 等）
- Agent 自动从对话中提取关键知识，按主题归类存储
- **这是最值得参考的模式 —— 按主题分文件，而非一个大 JSON**

**3. `/compact` 上下文压缩**
- 95% 容量时自动触发，或用户手动 `/compact focus on API changes`
- 优先清除旧的工具输出 → 然后摘要压缩对话
- 支持自定义压缩指令：在 CLAUDE.md 中写 "When compacting, always preserve the full list of modified files"
- ⚠️ 多次压缩会累积信息损失，建议在自然断点手动压缩

### Cline 的 Focus Chain + Auto Compact

**Focus Chain（焦点链）—— 最关键的创新：**
- 为任务生成一个 step-by-step **待办清单**（Markdown 格式）
- 每 6 条消息自动注入一次当前待办状态到上下文
- **待办清单在 Auto Compact 之后依然保留**（跨压缩持久化）
- 这解决了"压缩后忘了自己在做什么"的核心问题

**Auto Compact：**
- 监控 token 用量，接近上限时自动触发
- 生成全面摘要，保留关键技术决策和代码变更
- 用摘要替换完整对话历史，无缝从断点继续

### 行业最佳实践总结

| 实践 | 来源 | 核心思想 |
|------|------|---------|
| **文件系统即上下文** | Anthropic 官方 | 用文件读写替代内存，把知识外化到文件系统 |
| **按主题分文件** | Claude Code Auto Memory | 不要一个大文件，按主题拆分（debugging.md, api.md...） |
| **待办清单跨压缩持久** | Cline Focus Chain | 压缩时保留任务进度，不丢失"我做到哪了" |
| **40-60% 主动压缩** | humanlayer.dev | 不要等到 95% 才压缩，在 40-60% 时主动触发效果最好 |
| **Sub-Agent 隔离上下文** | Anthropic 官方 | 用子 Agent 做搜索/分析，结果返回主 Agent，避免主上下文膨胀 |
| **自定义压缩指令** | Claude Code | 让用户/规则指定压缩时必须保留什么 |

## 完整流程（优化版）

```
===================================================================
  设备 A（Mac）—— 离开前执行 /sync-save
===================================================================

Step 1: Agent 按主题生成结构化记忆文件（参考 Claude Code Auto Memory）
        |
        v
  .context/
  ├── SUMMARY.md          # 索引文件（简短，快速概览）
  ├── task_progress.md    # 待办清单 + 进度（参考 Cline Focus Chain）
  ├── gotchas.md          # 避雷点/踩坑记录
  ├── architecture.md     # 架构决策
  ├── api_notes.md        # 接口行为说明
  └── sync_meta.json      # 同步元数据（时间/设备/Agent）

Step 2: git add + commit + push

===================================================================
  设备 B（Windows）—— 新会话执行 /sync-load
===================================================================

Step 1: git pull

Step 2: MCP Server 读取 .context/ 目录全部文件

Step 3: Agent 先读 SUMMARY.md（快速恢复大局）
        → 再读 task_progress.md（知道自己做到哪了）
        → 按需读取其他主题文件（gotchas.md, api_notes.md...）

Step 4: Agent 向用户汇报并继续工作
```

## 记忆文件规范

### SUMMARY.md（索引，必须简短）

```markdown
# 项目上下文索引

> 最后同步: 2026-03-19 13:45 | 设备: Mac-xujia | Agent: gemini

## 项目概要
Next.js 14 + TypeScript + Drizzle ORM + SQLite 的用户管理系统

## 当前状态
认证模块重构进行中（70%），从 JWT 迁移到 Session

## 详细主题
- [task_progress.md](./task_progress.md) - 待办清单和进度
- [gotchas.md](./gotchas.md) - 2 个已知踩坑点
- [architecture.md](./architecture.md) - 3 个架构决策
- [api_notes.md](./api_notes.md) - 已了解的接口行为
```

### task_progress.md（参考 Cline Focus Chain）

```markdown
# 任务进度

## 当前任务：认证模块重构（JWT → Session）

### 待办清单
- [x] 创建 Session store 模块
- [x] 修改 auth middleware 使用 session
- [x] 删除旧的 JWT 逻辑
- [ ] 实现 logout 接口       <-- 当前进度
- [ ] 添加 session 过期自动刷新
- [ ] 编写认证模块单元测试

### 上次会话结束点
正在实现 logout 接口，已创建路由文件 `src/routes/auth/logout.ts`，
需要添加清除 session cookie 的逻辑。

### 文件变更记录
| 文件 | 操作 | 说明 |
|------|------|------|
| src/auth/session.ts | 新建 | Session 管理逻辑 |
| src/auth/jwt.ts | 删除 | 旧的 JWT 逻辑 |
| src/middleware/auth.ts | 修改 | 改用 session 验证 |
| src/routes/auth/logout.ts | 新建(进行中) | logout 接口 |
```

### gotchas.md（避雷点 + 轻量关联）

```markdown
# 避雷点 / 踩坑记录

## 1. SQLite WAL 模式跨进程问题
- **现象**：多进程同时写入 SQLite 时报 SQLITE_BUSY
- **原因**：WAL 模式不支持跨进程写入
- **解决**：使用 `journal_mode=DELETE`，或确保单进程写入
- **影响文件**：`src/db/connection.ts`
- **关联**：由 [ADR-1](architecture.md#adr-1) 引起

## 2. Next.js Middleware 限制
- **现象**：在 middleware 中使用 Node.js API 报错
- **原因**：Next.js middleware 运行在 Edge Runtime，不支持完整 Node.js API
- **解决**：Session 验证逻辑移到 API Route 中处理
- **影响文件**：`src/middleware.ts`, `src/routes/auth/*`
- **关联**：影响了 [ADR-2](architecture.md#adr-2) 的实现方式
```

### architecture.md（架构决策 + 轻量关联）

```markdown
# 架构决策记录

## ADR-1: 数据库选择 SQLite
- **决策**：使用 SQLite 而非 PostgreSQL
- **原因**：单机应用，部署简单，无需额外数据库服务
- **影响**：不支持并发写入，单进程限制
- **关联**：导致了 [踩坑#1](gotchas.md#1)，影响了 [ADR-3](#adr-3) 的选择
- **日期**：2026-03-19

## ADR-2: Session 替代 JWT
- **决策**：从 JWT 迁移到 Server-side Session
- **原因**：需要服务端主动踢人功能，JWT 无法撤销
- **权衡**：引入了服务端状态，增加了 session store 的维护
- **关联**：依赖 [ADR-1](#adr-1)（session 存在 SQLite），受 [踩坑#2](gotchas.md#2) 影响
- **日期**：2026-03-19

## ADR-3: ORM 选择 Drizzle
- **决策**：使用 Drizzle 而非 Prisma
- **原因**：Prisma 在 SQLite 上某些特性不支持（如 GROUP BY 的灵活性）
- **关联**：基于 [ADR-1](#adr-1) 选了 SQLite 后做出
- **日期**：2026-03-19
```

### api_notes.md（接口行为说明）

```markdown
# 接口行为说明

## /api/users
- POST: 不支持批量创建，需循环调用
- GET: 支持分页，默认 pageSize=20

## /api/auth/refresh
- 有 rate limit，1分钟最多5次
- 返回新的 accessToken，旧 token 立即失效

## 内部函数
- `SessionStore.create()`: 必须在数据库初始化之后调用
- `Drizzle.migrate()`: 必须在 `push()` 之前调用，否则 schema 不同步
```

## 摘要生成规范

### 三级优先级

| 级别 | 类别 | 对应文件 | 说明 |
|------|------|---------|------|
| **MUST** | 待办清单 + 进度 | task_progress.md | 参考 Cline Focus Chain，跨压缩必须保留 |
| **MUST** | 避雷点/踩坑 | gotchas.md | 最高价值信息，防止新会话重复踩坑 |
| **MUST** | 架构决策 | architecture.md | 防止新会话做出矛盾决策 |
| **SHOULD** | 接口行为说明 | api_notes.md | 减少重复探索 |
| **SHOULD** | 用户偏好 | 存入 SUMMARY.md | 保持一致的编码风格 |
| **SHOULD** | 文档解读 | 存入对应主题文件 | 减少重复阅读 |
| **MUST NOT** | 终端原始输出 | - | 太长，信息密度低 |
| **MUST NOT** | 完整代码块 | - | 代码在 git 里 |
| **MUST NOT** | 中间试错过程 | - | 只保留最终结论 |
| **MUST NOT** | LLM 通用知识 | - | 模型本来就知道 |

### 增量更新策略（本地自动写 + 远程手动推）

采用**双层架构**：Agent 发现新知识时立即写入本地文件，用户切换设备前手动推送到远程。

```
                   持续运行（自动）                 用户触发（手动）
                        |                              |
  Agent 发现新知识 ----> 立即写入 .context/ ----> /sync-save ----> git push
                   （本地文件，无感）            （推到远程）

  自动写入的工具：          /sync-save 的工具：         /sync-load 的工具：
  - append_gotcha          - sync_push               - sync_load
  - append_decision        （只做 git 操作）           （git pull + 读取文件）
  - update_progress
  - append_api_note
  - update_summary
```

### 文件更新策略表

| 文件 | 触发方式 | 更新策略 | 原因 |
|------|---------|---------|------|
| `gotchas.md` | **自动**（发现坑时） | 追加 | 累积型，旧坑不会过时 |
| `architecture.md` | **自动**（做决策时） | 追加 | 累积型，除非显式推翻 |
| `api_notes.md` | **自动**（发现接口行为时） | 追加 + 去重 | 同一接口新发现覆盖旧的 |
| `task_progress.md` | **自动**（完成待办项时） | 覆盖 | 状态型，只需要最新版本 |
| `SUMMARY.md` | **自动**（其他文件变化时） | 覆盖 | 索引型，反映最新状态 |
| `sync_meta.json` | **手动**（/sync-save 时） | 覆盖 | 记录推送时间和设备 |

### 多次 sync-save 不丢失的保证

```
第 1 次会话：
  发现坑 A → append_gotcha 自动写入 gotchas.md: [A]
  做决策 1 → append_decision 自动写入 architecture.md: [决策1]
  → /sync-save → git push

第 2 次会话（另一台设备）：
  /sync-load → git pull → 看到坑 A 和决策 1
  发现坑 B → append_gotcha 追加到 gotchas.md: [A, B]  ← A 保留
  做决策 2 → append_decision 追加到 architecture.md: [决策1, 2]
  → /sync-save → git push

第 3 次会话（切回来）：
  /sync-load → git pull → 看到坑 A, B 和决策 1, 2（完整无丢失）
```

原理：
1. MCP Server 的追加工具会先 **读取现有文件** → 在末尾追加新内容
2. 覆盖式文件（task_progress.md）每次写入最新全量状态，不需要合并
3. git 保证了远程永远有完整历史

## 新设备引导流程

```
用户输入: /sync-load
         |
    +-------------------------------+
    | MCP Server 检查环境            |
    +-------+--------------+-------+
            |              |
         [有 .git]      [没有]
            |              |
    +-------v------+  +---v-------------------+
    | git pull     |  | 引导：                  |
    +-------+------+  | "请先 clone 项目：       |
            |          |  git clone <url> .     |
    +-------v------+   |  然后重新 /sync-load"   |
    | 检查 .context|   +-----------------------+
    +---+------+---+
        |      |
     [存在]  [不存在]
        |      |
   +----v--+  +--v--------------------+
   | 分步加 |  | "未找到同步上下文。     |
   | 载文件 |  |  请在另一台设备先执行   |
   +---+---+  |  /sync-save"          |
       |       +-----------------------+
       v
  加载顺序：
  1. SUMMARY.md（概览）
  2. task_progress.md（知道做到哪了）
  3. gotchas.md（避免踩坑）
  4. 按需加载其他主题文件
```

### 全局项目注册表（可选）

```json
// ~/.context-sync/registry.json
{
  "projects": [
    {
      "name": "my-webapp",
      "git_url": "git@github.com:xujia/my-webapp.git",
      "local_paths": {
        "Mac-xujia": "/Users/xujia/code/my-webapp",
        "Win-xujia": "D:\\code\\my-webapp"
      },
      "last_sync": "2026-03-19T13:45:00+08:00"
    }
  ]
}
```

## MCP Server 工具设计（极简 3 工具，最小 token 开销）

> 设计原则：工具越少 → 工具定义占的 System Prompt token 越少 → 用户成本越低
>
> 5 个独立工具 (~1500 tokens 定义) → 3 个工具 (~600 tokens 定义)，减少 ~60%

### 工具 1: `write_context` — 批量写入记忆（Agent 自动调用）

一个工具处理所有写入，通过 `entries` 数组批量操作：

```
输入参数：
  entries: array  # 批量写入条目
    [
      {
        file: "gotchas" | "architecture" | "api_notes" | "progress" | "summary",
        action: "append" | "overwrite",
        content: string,       # Markdown 格式内容
        related_to: string[]   # 可选，轻量关联（如 ["ADR-1", "踩坑#2"]）
      }
    ]

逻辑：
  遍历 entries：
    - action="append": 读取现有文件 → 自增编号 → 追加到末尾
    - action="overwrite": 直接覆盖文件
    - related_to 不为空时：自动在内容末尾追加关联链接
  不做 git 操作

示例调用（Agent 发现一个坑 + 更新进度，一次搞定）：
  write_context({
    entries: [
      {
        file: "gotchas",
        action: "append",
        content: "## SQLite WAL 问题\n- 现象：...\n- 解决：...",
        related_to: ["ADR-1"]
      },
      {
        file: "progress",
        action: "overwrite",
        content: "# 任务进度\n- [x] 步骤1\n- [ ] 步骤2"
      }
    ]
  })
```

### 工具 2: `sync_push`（/sync-save）— 推送到远程

```
无输入参数

逻辑：
  1. 更新 .context/sync_meta.json（时间/设备/Agent）
  2. git add .context/
  3. git commit -m "context sync: [时间戳]"
  4. git push
  5. 返回推送结果
```

### 工具 3: `sync_load`（/sync-load）— 从远程拉取

```
输入参数：
  topic: string (可选)

逻辑：
  1. 检查 .git → 不存在则返回引导信息
  2. git pull
  3. 按优先级返回 .context/ 全部文件内容
```

## 轻量级关联设计

用 Markdown 内链模拟知识图谱，零额外 token 开销：

```
在 gotchas.md 中：
  - **关联**：由 [ADR-1](architecture.md#adr-1) 引起

在 architecture.md 中：
  - **关联**：导致了 [踩坑#1](gotchas.md#1)，依赖 [ADR-1](#adr-1)
```

Agent 在 `write_context` 的 `related_to` 参数中传入关联 ID，MCP Server 自动生成链接行。

**关联类型**（Agent 在内容中用自然语言描述）：

| 写法 | 含义 |
|------|------|
| "由 [X] 引起" | 因果关系 |
| "影响了 [X]" | 影响关系 |
| "依赖 [X]" | 依赖关系 |
| "替代了 [X]" | 替代关系 |
| "基于 [X] 做出" | 依据关系 |

不需要固定 schema，Agent 用自然语言写关联，人类也能直接看懂。

## 提示词规则配置

```markdown
## 上下文记忆规则

### 实时记录（自动，无需用户触发）
发现以下信息时，调用 write_context 工具批量写入：
- 避雷点/踩坑 → file:"gotchas", action:"append"，并告知用户 "⚠️ 已记录"
- 架构决策 → file:"architecture", action:"append"，并告知用户 "📐 已记录"
- 接口行为 → file:"api_notes", action:"append"
- 完成待办项 → file:"progress", action:"overwrite"
- 如果新记录与已有记录有关联，在 related_to 中标注

可以在一次 write_context 调用中批量写入多个文件，减少工具调用次数。

### /sync-save（用户手动）
1. 确保 progress 和 summary 是最新的（如有需要先 write_context）
2. 调用 sync_push 推送到远程

### /sync-load（用户手动）
1. 调用 sync_load 获取上下文
2. 如返回引导信息，展示步骤
3. 成功后重点关注 gotchas（避雷）和 progress（进度）
4. 向用户汇报并询问继续哪个任务

### 主动提醒
- 完成大任务后："可以 /sync-save 推送上下文"
- 本地有多条未推送记录时提醒
```

## 与官方方案的对照

| 维度 | Claude Code | Cline | 我们的方案 |
|------|------------|-------|-----------|
| 记忆结构 | MEMORY.md + 主题文件 | 单一摘要 | **SUMMARY.md + 主题文件** |
| 写入时机 | 自动从对话提取 | 接近上限时自动 | **发现新知识时立即写入**（本地） |
| 推送时机 | 不支持远程 | 不支持远程 | **用户手动 /sync-save** |
| 任务追踪 | 无 | Focus Chain 待办清单 | **task_progress.md** |
| 更新方式 | 自动提取 | 替换式 | **追加式（累积型） + 覆盖式（状态型）** |
| 跨设备 | ❌ | ❌ | **Git 同步** ✅ |

## 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| MCP Server 语言 | TypeScript | MCP SDK 最成熟 |
| 数据格式 | Markdown + JSON 元数据 | 人类可读，Git diff 友好 |
| 同步方式 | Git | 项目代码本身就用 Git |
| 安装方式 | `npx` | 零配置 |

## 局限性

1. **不是实时远程同步** — 本地实时写入，远程需手动推送（避免冲突）
2. **依赖 Agent 识别能力** — Agent 需要准确判断什么是"避雷点"什么是"架构决策"
3. **不能恢复完整对话** — 只恢复结构化记忆，不是原始对话窗口
4. **需要 Git 配置** — 两台设备都要配好 Git 推拉权限
5. **MCP 工具调用开销** — 每次自动写入会消耗一次工具调用额度
