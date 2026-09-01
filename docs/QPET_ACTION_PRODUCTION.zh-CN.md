# QPet 动作资源与运行时规范

> 适用于当前固定角色身份与 12 个正式动作。

## 1. 资源矩阵

```text
1 个固定身份 × 12 个通用动作
```

不存在按上下文档位复制动作、换装或派生角色的生产要求。

## 2. 动作清单

| Action | 中文状态 | 类型 | 触发 |
| --- | --- | --- | --- |
| idle | 空闲 | loop | 无任务 |
| working | 工作中 | loop | 请求/会话运行 |
| eating | 压缩中 | one-shot | compact开始 |
| digesting | 整理中 | one-shot | compact完成 |
| warning | 上下文预警 | loop | 压力/提示异常 |
| evolve | 状态更新 | one-shot | 压力档位变化反馈 |
| click | 打招呼 | one-shot | 用户点击 |
| archive | 已归档 | one-shot | 会话归档/移除 |
| tool-success | 工具完成 | one-shot | 工具成功 |
| tool-failure | 工具失败 | one-shot | 工具失败 |
| prompt-enhancing | 提示生成中 | loop + ping-pong | 增强请求中 |
| prompt-ready | 提示已就绪 | one-shot | 增强结果返回 |

## 3. 当前运行时参数

- 每动作 32 帧；
- 每帧 100ms；
- bodyHeight：480；
- frameHeight：540；
- feetY：520；
- WebP quality：90；
- 宽动作超过 WebP 16383px 单边上限时自动 multi-row；
- `prompt-enhancing` 使用 ping-pong，避免 31→0 硬接缝。

权威运行时注册表：

```text
src/client/pet-action-sheets.generated.ts
```

可选独立条带：

```text
assets/pet/action-sheets/<action>.webp
```

## 4. 锚点与居中

- 全动作使用 idle 计算的全局身体缩放；
- 垂直方向使用固定脚底线；
- 每个 action 使用一个固定 bottom-body 水平锚点；
- 禁止逐帧根据手臂、粒子或特效重新居中整张图；
- cell 宽度按固定锚点到所有帧左右最远边界计算，确保特效不裁切。

验收目标：

- feet≈519–520；
- click 生成条带脚部位移与源帧缩放值差≤2px；
- prompt-enhancing 同样≤2px；
- 身体中心在动作切换前后保持稳定。

## 5. 播放器约定

- 每层独立单帧裁切窗口，禁止相邻条带帧泄漏；
- 固定最大 viewport，动作切换不改变布局尺寸；
- outgoing 在 incoming 解码期间继续播放；
- incoming 完成 `img.decode()` 和两个 RAF 准备后原子接管；
- 不使用 canvas 二次采样；
- 不使用 crossfade；
- 用户动作可 interrupt 立即抢占；
- one-shot 必须完整播放 32 帧并调用 onComplete。

## 6. 生成流程

完整生产源位于本地 `Review/h3-actions/`，不提交 GitHub。重建命令：

```powershell
python scripts/build-runtime-from-freecut.py
```

生成器会：

1. 读取免费抠图 ZIP 或复用已有逐帧 WebP；
2. 计算脚底、身体尺度和动作级锚点；
3. 生成单行或多行 WebP 条带；
4. 写入独立条带；
5. 生成内嵌 data URI 注册表。

没有 Review 生产源的 GitHub 克隆仍可直接使用已提交的最终条带和生成注册表，但不能重新生成素材。

## 7. 质量门禁

```powershell
npm run typecheck
npm test
node scripts/qpet-asset-audit.mjs
python scripts/check-strip-stability.py   # 仅本地有 Review 源时
python scripts/measure-baselines.py
python scripts/render-runtime-previews.py
npm run build:client
```

必须检查：

- 12 动作均为 32 帧；
- frameW/frameH/cols/rows 与实际条带一致；
- pingPong 仅用于 prompt-enhancing；
- 一次性动作不被队列提前截断；
- 不出现白闪、重影、拉伸、相邻角色或整帧水平漂移。

## 8. README媒体

README动作图由最终条带生成：

```powershell
python scripts/build-readme-media.py
```

输出：

- 12动作总览；
- 动作循环GIF；
- 每动作代表帧；
- 使用模拟数据的无隐私界面示意图。
