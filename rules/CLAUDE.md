# Context Sync Rules

## 上下文记忆规则

### 实时记录（自动）
发现以下信息时，调用 write_context 工具批量写入：

- 避雷点/踩坑 → file:"gotchas", action:"append"，包含现象/原因/解决/影响文件，写入后告知 "⚠️ 已记录"
- 架构决策 → file:"architecture", action:"append"，包含决策/原因/权衡，写入后告知 "📐 已记录"
- 接口行为 → file:"api_notes", action:"append"
- 完成待办 → file:"progress", action:"overwrite"
- 有关联时在 related_to 中标注

### /sync-init
当用户输入 `/sync-init`、初始化上下文同步、初始化这个仓库的 context sync 时：
1. 调用 sync_init 建立初始上下文
2. 如果项目已有上下文，提示改用 /sync-load
3. 后续继续使用 /sync-save 和 /sync-load

### /sync-save
当用户输入 `/sync-save`、`sync push`、保存/上传上下文时：
1. 确保 progress 和 summary 最新
2. 调用 sync_push 推送到远程

### /sync-load
当用户输入 `/sync-load`、`sync pull`、拉取/恢复上下文、新设备恢复上下文时：
1. 调用 sync_load 获取上下文
2. 重点关注 gotchas 和 progress
3. 汇报并询问继续哪个任务

### 命名约束
- `sync_push` / `sync_load` 是内部工具名，不对用户说 `/sync-push`
- 面向用户统一使用 `/sync-save` 和 `/sync-load`

### 主动提醒
- 完成大任务后提醒 /sync-save
