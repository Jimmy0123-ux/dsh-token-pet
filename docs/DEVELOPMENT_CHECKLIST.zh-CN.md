# DSH Token Pet 开发与发布清单

> 本清单只记录当前真实架构、有效质量门禁与后续发布工作。

## 当前版本状态

- 仓库：`Jimmy0123-ux/dsh-token-pet`（当前 Private）；
- 运行目标：DSH Desktop Web GUI；
- 角色：单一固定身份；
- 动作：12 个正式动作，全部 32 帧；
- 发布包：约 16.4MiB 压缩 / 22MiB 解包；
- 自动化测试：126 项；
- 文档与动作媒体：已生成；
- Review 生产源：仅本地保留，不提交 GitHub。

## A. 核心产品

- [x] 固定角色身份和透明正式立绘；
- [x] 右上角显示真实动作状态；
- [x] 下方仅显示上下文百分比；
- [x] semanticAction 与 visualAction 分离；
- [x] 宠物与浮窗独立拖动、尺寸持久化和视口约束；
- [x] reduced-motion 与低性能模式；
- [x] 中英文设置基础。

## B. 动画运行时

- [x] 12 动作 × 32 帧 × 100ms；
- [x] 固定脚底与动作级水平锚点；
- [x] multi-row 宽条带；
- [x] prompt-enhancing ping-pong；
- [x] one-shot 完整播放与 onComplete；
- [x] 双图片缓冲；
- [x] 每层独立单帧裁切窗口；
- [x] outgoing 在 incoming 解码期间继续播放；
- [x] `img.decode()` + 双 RAF + 原子接管；
- [x] 立即 interrupt 与后台事件 40ms 合并；
- [x] click / prompt-enhancing 水平稳定性门；
- [ ] 增加真实 Electron/浏览器逐帧截图测试，检查任何切换帧均不为空白；
- [ ] 评估 DPR>2 与大尺寸的高分辨率资源档位。

## C. 用量与浮窗

- [x] 当前上下文占用；
- [x] Token 分类、轮次、步数和模型耗时；
- [x] Lifetime Ledger；
- [x] 模型与日期累计；
- [x] 本日小时趋势；
- [x] 三标签浮窗；
- [x] 面板分阶段渲染；
- [x] 面板 GET 纯快照，不自动同步；
- [x] 请求 10 秒 deadline；
- [x] 初次索引失败进入 error 并有限重试；
- [x] 旧趋势在后台刷新期间保持可见；
- [x] partial 状态显式“立即同步”；
- [x] 后台协调器：启动对账、flush/disposed 防抖、5 分钟兜底；
- [x] 无索引时只允许用户显式首次建立；
- [x] Lifetime refresh 节流和失败重试；
- [ ] 在长时间运行（24h+）环境记录 renderer/main 内存与浮窗首帧耗时；
- [ ] 增加 Host 后台同步性能预算与长任务 telemetry。

## D. 提示词增强

- [x] 用户点击后才增强；
- [x] 跟随当前会话路由与默认模型回退；
- [x] 自定义模板和 `{{prompt}}`；
- [x] 预览、编辑、覆盖、追加、复制、撤回；
- [x] 通过 DSH inputActions 直接发送；
- [x] 失败保留原文；
- [x] 不记录完整提示词；
- [ ] 增加多 provider 实机兼容矩阵。

## E. 持久化与安全

- [x] 文件索引原子写入、备份和校验；
- [x] pending-only 增量同步；
- [x] 删除会话/归档后保留 Lifetime；
- [x] 不可恢复清零水位；
- [x] 路径安全和资源白名单；
- [x] 配置损坏回退；
- [x] 敏感信息扫描和 `.gitignore`；
- [ ] 公开发布前确认角色、动作和字体/媒体的授权范围；
- [ ] 公开发布前再次执行依赖许可证和 npm audit。

## F. 质量门禁

- [x] `npm run typecheck`；
- [x] `npm test`；
- [x] `node scripts/qpet-asset-audit.mjs`；
- [x] `python scripts/check-strip-stability.py`（本地有 Review 生产源时）；
- [x] `npm run build`；
- [x] `npm pack --dry-run --json`；
- [x] README 媒体生成与完整性检查；
- [x] 克隆仓库无 Review 时测试可通过；
- [ ] 配置 GitHub Actions：typecheck、test、audit、build、pack dry-run；
- [ ] 增加 Windows DSH Desktop 重启后烟雾测试记录。

## G. 仓库质量与分享

- [x] 创建 Private GitHub 仓库；
- [x] 完善 README、界面示意、动作总览和动作 GIF；
- [x] 发布包去除 sourcemap与重复资源；
- [x] README 提供源码 link、私有 GitHub 和 tgz 安装方式；
- [ ] 用脱敏的真实 DSH 运行截图替换 README 界面示意图；
- [ ] 配置 GitHub Actions；
- [ ] 完成 24 小时性能回归；
- [ ] 完成许可证与素材授权审查；
- [ ] 在另一台 Windows/DSH Desktop 上验证安装、更新和卸载。

## 推荐后续顺序

```text
真实脱敏截图
→ GitHub Actions
→ 24 小时稳定性测试
→ 许可证/素材授权确认
→ 跨机器安装与更新验收
```
