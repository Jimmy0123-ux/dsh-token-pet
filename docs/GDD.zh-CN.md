# DSH Token Pet 产品与技术设计

> 版本：0.1.x 现行规范  
> 平台：DeepSeek Harness Desktop / Web GUI  
> 仓库：`Jimmy0123-ux/dsh-token-pet`

## 1. 产品定义

DSH Token Pet（用量小宠物）是 DSH Desktop 的状态反馈与 Token 用量可视化插件。它用一个固定身份的 Q 版角色反馈当前运行事件，并通过浮窗展示上下文窗口、终身用量、模型明细和本日趋势。

## 2. 产品目标

- 用宠物动作即时反馈 DSH 当前行为；
- 在桌面常驻位置显示上下文占用率；
- 提供低打扰、可拖动、可缩放的统计浮窗；
- 维护跨会话 Lifetime Ledger 与本日趋势；
- 保证打开浮窗不触发历史扫描或自动重任务；
- 保证动作切换不空白、不串帧、不拉伸；
- 支持用户主动的提示词增强工作流。

## 3. 非目标

- 不根据 Token 用量切换角色身份、年龄或服装；
- 不执行第三方资源脚本；
- 不自动增强或发送用户提示词；
- 不在插件日志保存完整提示词；
- 不把 Review 视频、ZIP、逐帧生产源打进发布包。

## 4. 界面信息架构

### 4.1 宠物常驻区

- 角色右上角：语义运行状态，如“空闲”“工作中”“工具完成”“提示生成中”；
- 角色下方：仅显示 `上下文 xx%`；
- 角色内部：上下文压力环、工具光点和轻量提示效果；
- 点击宠物：触发打招呼动作，并切换统计浮窗。

视觉动作与语义状态分离。低性能或 reduced-motion 模式可以把视觉固定为 idle，但状态牌仍显示真实业务状态。

### 4.2 性能浮窗

三个标签：

1. **总览**：当前上下文、终身用量账本、本日趋势、当前会话/索引；
2. **模型**：按服务商与模型展示累计值；
3. **设置**：尺寸、位置、动画速度、低性能模式、增强模型、索引维护和动作预览。

提示词增强使用独立抽屉，不切换当前标签。

## 5. 运行状态

| Action | 中文状态 | 触发来源 |
| --- | --- | --- |
| idle | 空闲 | 无任务 |
| working | 工作中 | 请求运行、会话执行 |
| eating | 压缩中 | compact / compaction 开始 |
| digesting | 整理中 | compact / compaction 完成 |
| warning | 上下文预警 | 上下文压力或提示异常 |
| evolve | 状态更新 | 内部压力档位变化的庆祝反馈 |
| click | 打招呼 | 用户点击宠物 |
| archive | 已归档 | 会话归档或移除 |
| tool-success | 工具完成 | 工具成功 |
| tool-failure | 工具失败 | 工具失败 |
| prompt-enhancing | 提示生成中 | 增强请求进行中 |
| prompt-ready | 提示已就绪 | 增强结果返回 |

用户动作与关键高优先级动作可立即抢占。普通后台事件在 40ms 窗口内合并，最高优先级胜出，同优先级取最后事件。

## 6. 动画系统

- 12 个动作，每个 32 帧；
- 统一 100ms / 帧；
- 条带 cell：bodyHeight 480、frameHeight 540、feetY 520；
- 每动作一个固定 bottom-body 水平锚点；
- 宽动作支持 multi-row；
- prompt-enhancing 使用 ping-pong 循环；
- one-shot 播放完整后由 onComplete 返回 idle。

播放器使用两个真实 `<img>` 缓冲：

- 固定最大 viewport；
- 每层拥有独立单帧 `overflow:hidden` 裁切窗口；
- outgoing 在 incoming 解码期间继续播放；
- incoming 完成 `img.decode()` 并经过两个 RAF 后原子接管；
- 无 canvas、无 background-position、无交叉淡入；
- 下一 RAF 清除旧层 src；
- 同时最多保留两个 DOM 缓冲。

## 7. 上下文与实时数据

当前上下文占用率：

```text
(projectedTokens ?? pressureTokens) / contextWindow
```

内部保留压力档位键用于颜色和柔和警示，但不再作为用户可见“形态”名称，也不改变角色资源。

当前会话数据来自 DSH 客户端投影：contextPressure、contextBreakdown、tokenUsage、sessionStats、contextTimeline、inputActions 和 useInput。

## 8. 历史索引与 Lifetime Ledger

### 浮窗读取原则

- GET `/token-pet/index/status` 不扫描会话；
- GET `/token-pet/usage/lifetime` 不刷新账本；
- 趋势已有快照时立即显示，后台刷新只显示状态提示；
- 请求统一使用 10 秒 deadline；
- 错误保留旧数据并提供重试。

### 后台维护

仅维护已经建立的索引：

- 应用启动 5 秒后低优先级对账；
- session/flush、session/disposed 后 1.5 秒防抖增量同步；
- 每 5 分钟单飞兜底；
- concurrency=2，yieldEvery=1；
- Lifetime refresh 60 秒节流；
- 无索引时由用户显式执行“首次建立索引”。

Lifetime Ledger 是用户可见的历史主账本。删除或归档源会话不会删除其历史累计；“清空历史（不可恢复）”需要明确二次确认，并使用水位阻止旧日志回灌。

## 9. 提示词增强

- 仅用户点击后调用；
- 原文始终保留；
- 结果先预览并可编辑；
- 支持覆盖、追加、复制、撤回和直接发送；
- 未指定增强模型时跟随当前会话路由，再回退到 DSH 默认模型；
- 直接发送使用 `inputActions.setDraft()` 与 `inputActions.submit()`。

## 10. 设置

- 宠物尺寸与动画速度；
- 宠物位置和浮窗位置；
- 浮窗宽高；
- reduced-motion / 低性能模式；
- 中英文界面；
- 提示词增强开关、模板和模型；
- 动作预览；
- 索引状态、首次建立、立即同步、取消和趋势维护。

## 11. 工程结构

```text
src/index.ts                         宿主路由与后台维护
src/client/index.ts                  客户端挂载与浮窗状态
src/client/pet.tsx                   宠物 HUD
src/client/pet-action-player.tsx     双缓冲条带播放器
src/client/animation.ts              动作队列、抢占与事件合并
src/client/pet-action-sheets.generated.ts  内嵌动作条带
assets/pet/action-sheets/            可选宿主条带文件
scripts/                             生成、审计、文档媒体脚本
tests/                               host/client/持久化测试
```

## 12. 构建与发布

发布包只包含 `lib/`、`client/client.js`、`cordis.patch.yml` 和基础文档。不发布 sourcemap、Review、node_modules 或重复独立条带。当前包约 16.4MiB 压缩 / 22MiB 解包。

用户安装方式以仓库 README 为准；内部发布与市场操作不属于产品规范。

## 13. 安全与隐私

- 路径和 manifest 均校验；
- 不允许脚本、HTML或可执行资源；
- 提示词增强不写完整文本到插件日志；
- 面板 GET 不触发历史扫描；
- Review 中的生成视频、ZIP、逐帧源和审核记录不提交 GitHub；
- 发布公开版本前必须确认宠物美术与动作资源授权范围。

## 14. 性能边界

- 默认 size=120、DPR≤2 时清晰；
- DPR=2 且大尺寸会受 540px 源 cell 上限影响；
- client.js 内嵌条带约 22.9MB；
- 浏览器可能缓存已解码图片，播放器只保留两层 DOM 资源；
- 重任务不得由浮窗打开触发。

## 15. 验收标准

- 右上角显示真实动作状态，下方仅显示上下文百分比；
- 12 动作完整 32 帧、100ms / 帧；
- click 无人工水平平移；
- prompt-enhancing 无 31→0 硬接缝；
- 动作切换无空白、串帧、重影或拉伸；
- 打开浮窗不 POST 自动同步、不读取历史日志；
- 请求超时进入错误终态；
- typecheck、tests、QPet audit、稳定性门全部通过；
- GitHub 克隆不包含 Review 时仍能运行测试与构建。
