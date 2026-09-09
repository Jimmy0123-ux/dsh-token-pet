# DSH Token Pet 接手记录

核对日期：2026-09-08（本机 UTC+8）。首次交接为只读检查；随后经用户授权完成下述本地修复。未提交、推送、安装/升级运行中插件或发布，未修改实际历史账本。线上数据为首次核对快照。

## 项目定位与维护入口

DSH 的宿主 + Web 客户端双端插件，TypeScript / React 18 / Cordis。不是独立桌面程序，需要加载 Web UI 的 web 或 desktop profile。

- `src/index.ts`：宿主 HTTP 路由、持久化统计服务与后台索引协调器。
- `src/session-usage-index.ts`：会话用量缓存、指纹增量刷新。
- `src/hourly-trend-index.ts`：持久化小时趋势、游标重放与修复。
- `src/lifetime-ledger.ts`：跨会话终身累计、文件锁、原子写入、备份恢复和清空水位。
- `src/usage.ts`：用量归并、去重与模型分类。
- `src/client/index.ts`：客户端挂载、宿主请求、会话与 composer 桥接。
- `src/client/panel.tsx`：总览、模型、设置浮窗。
- `src/client/events.ts`、`animation.ts`、`pet-action-player.tsx`：事件优先级、12 动作调度、双图片缓冲逐帧播放。
- `src/client/prompt-panel.tsx`、`src/prompt-route.ts`：显式提示词增强与编辑/发送。
- `src/client/pet-action-sheets.generated.ts`：大型内嵌资源注册表，避免无目的全文读取或手工编辑。
- `cordis.patch.yml`：单个 token-pet 行挂载双端。
- `package.json`、`.github/workflows/ci.yml`：构建与发布门禁。

## 不应破坏的约束

1. 面板 GET 只读快照，不能因打开界面扫描全部会话；同步归后台协调器和显式维护操作所有。
2. Lifetime Ledger 保持单调、删除/归档会话不丢累计；清空后的反重放水位与备份必须同时正确维护。
3. 请求带 deadline、取消与旧快照保留，避免面板无限加载。
4. 动画语义状态和视觉运动分离；12 动作固定角色身份、32 帧；双缓冲切换不能空白、拉伸或截断 one-shot。
5. 提示词增强须用户主动触发；发送使用 DSH 官方 inputActions，不自动提交结果。
6. 发布包保留 lib、内嵌客户端与 patch，不打包 Review 生产源、重复条带或 sourcemap。

## 初次交接基线验证

本机 Node v24.17.0 / npm 11.17.0：

- `npm run typecheck`：通过。
- `npm test`：126/126 通过（包含 host 编译）。
- `npm run audit:qpet-art`：通过，12 动作完整，problems 为空。
- 初次只读验证后 Git 已跟踪文件无变化；后续本地改动与验证见下方。
- 未做本机真实浏览器交互、视觉回归、24 小时稳定性或全新 profile 安装验收。

CI 使用 Ubuntu / Node 22.19.0，依次 npm ci、typecheck、test、资源审计、build、pack dry-run；没有自动 npm 发布步骤。

## 线上状态

### GitHub

- 仓库公开、未归档：[仓库](https://github.com/Jimmy0123-ux/dsh-token-pet)。核对时 54 Stars、0 Fork、0 open issues（GitHub 该总数含 PR）。
- [main API](https://api.github.com/repos/Jimmy0123-ux/dsh-token-pet/git/ref/heads/main) 为 `9c8cf3e479b55514a0908a665415b4950aa16521`，与本地 HEAD 相同。
- [最新 CI](https://github.com/Jimmy0123-ux/dsh-token-pet/actions/runs/33584469343)：success。
- [最新正式 Release](https://github.com/Jimmy0123-ux/dsh-token-pet/releases/tag/v0.1.1)：v0.1.1，2026-09-02 发布；附件 17,188,436 字节，下载计数 12。
- 本地 `dsh-token-pet-0.1.1.tgz` SHA256 与 GitHub 附件元数据一致：`c67b29cd678ed9701d0890042a7793e9955809db416918f4faba1dc2180696a4`。
- v0.1.1 到已提交 main 仅 README 修改；本地工作区现包含下述未提交业务修复。
- 本机 git HTTPS 直连失败，以上远端状态改由公开 GitHub API 核验；未测试 push 权限。

### npm

[官方 latest 元数据](https://registry.npmjs.org/dsh-token-pet/latest) 为 0.1.1，包包含 DSH bundle/client 元数据，28 文件、解包 23,117,766 字节。

npm gitHead 为 `44b98f2`，与 GitHub release 提交不同；应在后续发布流程中保证先提交版本与变更日志再打包发布，改善来源追溯。本轮未下载 npm tgz 并逐文件比对。

### DSH 插件市场

[主市场公开目录](https://awesome-dsh-plugin.com/plugins.json) 已收录，详情页：
https://awesome-dsh-plugin.com/p/Jimmy0123-ux/dsh-token-pet/

目录核对值：

- name / npm：dsh-token-pet
- version：0.1.1
- category：usage
- added：2026-09-02
- stars：54；downloads：194（目录字段，不能当成实际安装人数）
- 安装命令：`dsh plugin --profile web add dsh-token-pet`
- 8 张截图链接已登记。
- **元数据不一致**：tarball 仍指向 v0.1.0 的 tgz，建议随下次维护更新。

本机已安装 dshmarket 实现中，`installTargetFor` 优先选择 npm，再选择 tarball，所以该旧链接不等于当前常规市场安装一定安装旧版；直接使用旧 tarball 则会拿到 0.1.0。

另一个社区源 `dsh-marketplace.qilewl.net` 请求 TLS/fetch 失败，本轮无法核对；当前 GUI 的 `/dsh-market/registry` 返回 403，未绕过认证，因此未确认当前界面缓存、安装版本或启用状态。

## 2026-09-08 本地修复（未发布）

### 已确认并修复

1. **多模型统计归属**：原逻辑将去重后的 usage 追加到所有模型 header 之后。回归复现模型 A=20、B=40 被算成 B=60；7 条新增用例中原逻辑 5 条失败。`src/usage.ts` 现保留获胜事件的原始顺序，不改变 terminal 优先和 streaming 去重规则。
2. **会话草稿与发送隔离**：核实宿主 snapshot 的实际身份字段为 `sessionId`。客户端 feed 使用提交阶段的独占租约和 epoch；旧 feed 的更新/卸载不能覆盖新会话，旧 composer 动作失效，submit 微任务再次校验。增强面板按 epoch 重挂载，卸载后忽略异步结果和旧按钮；原微任务跨会话提交已在修复前复现。
3. **首次账本更新**：原代码无 usage index 直接退出，新增宿主回归中启动及刚关闭会话均保持 0。现仅读取 live 或本进程收到 durability fence 的会话，旧 closed 日志仍待用户显式首次建索引；保留纯快照 GET。增加 generation 防止刷新期间的新 fence 丢失、失败重试预算、独立 retry 与 debounce 交错收敛、dispose 后禁止重建重试 timer。
4. **文档**：README 已发布版本改为 0.1.1；CHANGELOG 的 0.1.1 日期修正为 2026-09-02；开发清单更新公开仓库及已存在的 CI；客户端过时挂载说明已修正。

新增测试：

- `tests/usage-model-attribution.test.mjs`：7 条。
- `tests/session-isolation.test.mjs`：10 条（执行真实 TS 组件体的轻量 hook 测试宿主，不是实际浏览器）。
- `tests/lifetime-bootstrap-host.test.mjs`：6 条（宿主 fake services + fake timers + 真实临时文件账本）。

### 修复后验证

- `npm run typecheck`：通过。
- `npm test`：149/149 通过。
- `npm run audit:qpet-art`：通过，problems 为空。
- `npm run build`：宿主及客户端构建成功，客户端约 22.94 MB。
- `npm pack --dry-run --json`：通过，28 个文件，未生成或覆盖 tgz；无 Review、源码映射或重复素材。
- `git diff --check`：通过。
- SSR 静态渲染测试有 React 对 client-only `useLayoutEffect` 的标准警告，不是测试失败；未做真实 GUI 交互验收。

### 发布前仍需处理

- **旧账迁移**：未自动改动已持久化的错误模型归属。旧 closed 索引可能继续命中原缓存；重算后与单调 Ledger 的旧模型桶合并可能重复累计。不能仅删索引重建或清空账本宣称修复，需先备份并制定保留删除会话及清零水位的迁移方案。未确认本机实际历史数据是否受影响。
- **市场元数据**：线上备用 tgz 仍指向 0.1.0，须获线上更新授权后修改；本轮仅记录，未请求外部写入。
- **版本与发布**：package.json 保持 0.1.1，本地改动列在 CHANGELOG Unreleased。后续选择新版本号、提交/tag、发布 npm/Release 并核对市场，不得重新发布/覆盖 0.1.1。
- 最新 README 安装说明及本轮修正文档需随新版本发布才进入分发包。

### 额外维护注意

- 宿主接口多为手写 interface / 类型断言，DSH 升级后要验证投影、事件和 composer 契约。
- `scripts/runtime-smoke.mjs` 可能自动 POST 同步，不是纯只读检查。
- 正式资源生产应辨别 `scripts/build-runtime-from-freecut.py`；旧 `build-runtime-webp-sheets.py` 仍可能以 8 帧覆盖相同生成文件，不能随意运行。生产依赖未入仓 Review 素材和本地环境，普通 bundle 可构建不代表素材生产可完整复现。
- 旧 `/usage` 路由可能扫描历史；“纯快照”约束针对当前面板数据接口，不能泛化为所有 GET。
- 提示增强的取消/超时、多进程索引写入和长期文件规模，需另做专项验证。

### 完善验收

补真实浏览器动画交接回归、全新 profile 安装/升级验收、隐私安全的真实 UI 截图和 24 小时内存/延迟记录。以后发布应依次检查本地门禁、包内容、提交/tag/npm 来源一致性、GitHub CI/Release、npm latest、市场版本和下载链接。

## 本轮双语、浮窗与提示音交付（仅本地，未发布）

### 实现范围

- `src/client/i18n.ts`、各 `*-messages.ts` 与 `settings-hook.ts`：类型化中英字典、占位符、Intl 日期和共享设置订阅。覆盖宠物语义状态、外壳、三标签浮窗、增强抽屉、设置、维护、皮肤提示和可访问名称；注册到宿主的设置名称也随语言更新。
- `src/client/panel.tsx`、`layout.ts` 与 `index.ts`：上下文、当前会话和 Lifetime 明确分区；当前会话 token 分类不再放在上下文卡内。自适应卡片、完整换行模型名、单正文滚动、42px 标题栏与窄宽图标按钮。设置 range 默认 margin 与原生文件按钮的浏览器语言泄漏已修正。
- `src/client/completion.ts`：读取真实 `snapshot.openState` 和 `chat.timeline` 的 `turn/start`、`turn/end`，仅观察过实时开始且成功完成的当前会话回合通知。检查原活跃 turn ID，避免队列下一回合同一快照启动时漏掉前一回合；epoch、静音水位、断连和移除保护防止旧完成回放。
- `src/client/completion-sound.ts`：默认关闭的本地两音符 Web Audio 合成；开关仅解锁，试听显式发声；通知不主动 resume。静音、会话切换和卸载取消旧声音，generation 防止“停止后已 resolved 试听续行仍播放”；设置异步状态也有操作代次和卸载保护。
- `README.en.md`：英文安装边界、语言/提示音/浮窗/增强使用说明及维护安全说明；已加入 npm files 白名单，package 描述改英文，版本仍是 0.1.1。
- 保留自定义模板、草稿、已编辑预览及正在执行的增强请求；不翻译机器确认 token、用户内容或服务商/模型 ID。
- 未做跨平台适配、素材生产、播放器性能修改或性能测量；未改安装中的插件、真实配置、账本或历史数据，未 commit/push/publish。

### 验证结果

- `npm run typecheck`、`npm test`：通过，**190/190**（本轮新增 41 条，既有隔离 mock 与文案/包清单断言已适配）。
- `npm run audit:qpet-art`：通过，12 动作，problems 为空；`npm run build` 通过，客户端约 **22.99 MB**。
- `npm pack --dry-run --json`：通过，**29 文件**，包含英文说明；仍仅一个内嵌客户端，无重复素材/sourcemap，未覆盖既有 tgz。
- `node scripts/verify-ui-local.mjs`：真实 Chrome、临时 `file://` fixture、假宿主数据与 FakeAudioContext。500/360/180px × 中英 × 三标签 **18 组合均无横向溢出**；正文单滚动，textarea 自身正常滚动。
- 实际调用客户端 `apply` 注册外壳后，宠物打开/标题栏关闭、语言热切、提示抽屉保持原标签通过；360/180px 外壳标题栏及正文无溢出。完成提示音 **11 项浏览器调度检查全部通过**，含默认静音、仅解锁、试听、成功完成、去重、工具/取消/历史切换不响、关闭后不响。
- 最后一轮浏览器报告及 24 张截图在本机临时目录 `C:\Users\Administrator.CHINAMI-LGIVRJF\AppData\Local\Temp\token-pet-ui-hLLtdK`；脚本可复现，临时浏览器/profile 已清理。
- `git diff --check` 通过。SSR 仍报告既有 client-only useLayoutEffect 警告，新增 SVG fallback 覆盖暴露旧 eyesFor 子元素缺 key 警告；均非测试失败。

### 验证边界

浏览器验证使用真实组件和外壳，但 **不是正在运行的 DSH 页面或真实会话**，也未连接扬声器检查音质；180px 是拥挤有效宽度模拟，不是实际浏览器 200% 缩放。尚未安装/升级本机运行中的插件。旧账迁移风险与线上市场备用 tgz 问题仍按上节保留，不能把这些 UI 更新当作已完成迁移或已发布版本。

## 2026-09-08 本机试用安装（用户随后授权）

- 已执行 `dsh plugin --profile desktop add "link:H:\ds\dsh-token-pet"`，退出码 0；desktop profile 的依赖由 `^0.1.1` 改为 `link:H:/ds/dsh-token-pet`，原 bundle 列表保持不变。
- `node_modules/dsh-token-pet` 已核验为指向工作区的 SymbolicLink，宿主 `lib/index.js` 与客户端 `client/client.js` 的安装路径/源码路径 SHA256 分别一致；从 desktop profile 直接 import 插件成功，`apply` 为函数。
- 发现用户层 patch 原本禁用了 `token-pet`，已仅将该条 `disabled` 改为 `false`，未改 `infinite-gen-3` 等其他插件开关。
- 操作前备份 5 个 profile 配置/锁文件和 4 个用量快照文件到 `C:\Users\Administrator.CHINAMI-LGIVRJF\.dsh\backups\token-pet-local-20260908-151948`。不清空、不重建、不迁移实际账本。
- 安装时 pnpm 报 peer 提示；专项 `peers check` 返回 1，列出其他已装插件对宿主依赖的缺失/冲突，没有 token-pet 条目。本次不顺手改动其他插件或宿主依赖。
- 未重启 DSH。对现有 `http://127.0.0.1:43120/` 的无认证命令行请求返回 HTTP 403，因此不声称已经验收当前登录页面的新 UI。用户完整退出并重开 DSH Desktop 后试用，若页面仍旧再刷新。
- 后续本地构建会更新该 link 指向的文件；不要删除或移动 `H:\ds\dsh-token-pet`。需要退回线上版时可安装 `dsh-token-pet@0.1.1` 并重启，不应直接覆盖备份账本来回滚代码。
