# QPet 运行时资产

当前项目只维护一个固定角色身份和 12 个通用动作。

## 结构

```text
assets/qpet/
├─ identity/                 当前固定身份母版
├─ contracts/                动作请求、审核和运行合同
└─ manifest.draft.json       当前12动作资源清单

assets/pet/action-sheets/    12个最终WebP条带
```

## 当前身份

```text
identity/qpet-stage-01-newborn-v02-resident.png
SHA-256: 3df1cea1a9bfdc3ae1c1159e4af6701654caab3cb473d45dba1c6a74e3b3327c
```

内部压力档位只控制颜色和柔和警示，不改变角色、服装或动作路径。

## 动作

`idle`、`working`、`eating`、`digesting`、`warning`、`evolve`、`click`、`archive`、`tool-success`、`tool-failure`、`prompt-enhancing`、`prompt-ready`。

每个动作32帧、100ms/帧。权威运行时注册表为：

```text
src/client/pet-action-sheets.generated.ts
```

审计：

```powershell
npm run audit:qpet-art
```
