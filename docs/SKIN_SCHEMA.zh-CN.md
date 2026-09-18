# 皮肤规范（Skin Schema v1）

> 版本：v1（`manifest.schemaVersion: 1`） · 客户端 0.3.0 起支持
> 插件：dsh-token-pet · 本文定义皮肤 ZIP 的目录布局、manifest 字段、安全约束与回退规则。

## 1. 目标

皮肤（Skin）让用户在不更换默认正式立绘的前提下，自定义宠物的**配色**与**逐帧动作素材**：

- **纯配色皮肤**：只需要 `manifest.json` 里的 `palette` / `styleOverrides`，无需任何图片；
- **动作素材皮肤**：提供精灵表（sprite sheet），按动作名（如 `common/working.webp`）存放；
- 皮肤只改变表现，不改变 12 个动作的身份、语义状态或压力档位逻辑。

## 2. ZIP 目录布局

```
skin.zip
├── manifest.json            # 必须，位于 ZIP 根目录
└── common/                  # 各动作精灵表（可选）
│   ├── idle.webp
│   ├── working.webp
│   └── ...
├── stages/<stage>/          # 分阶段覆盖（可选，stage ∈ newborn|growth|active|heavy|overload|critical）
└── preview/                 # 预览图（可选）
```

- 仅允许扩展名：`.png` / `.webp` / `.gif` / `.json`；
- 仅允许目录：`common/`、`stages/<stage>/`、`preview/` 与根 `manifest.json`；
- 禁止：路径穿越（`..`）、绝对路径、Windows 盘符、反斜杠、脚本/可执行文件。

## 3. manifest.json

```jsonc
{
  "id": "com.example.my-skin",          // 必填：小写字母开头，仅 [a-z0-9._-]
  "name": "我的皮肤",                    // 必填
  "version": "1.0.0",                   // 可选
  "schemaVersion": 1,                   // 可选，当前 1
  "author": "…",                        // 可选
  "license": "CC-BY-4.0",               // 可选
  "nameLocalized": { "zh-CN": "我的皮肤", "en-US": "My Skin" },
  "description": { "zh-CN": "…", "en-US": "…" },
  "canvas": { "width": 72, "height": 80 },   // 可选：精灵画布像素
  "palette": {                          // 可选：全阶段共享配色（纯配色皮肤）
    "body": "#7fb8e8",
    "belly": "#d9effc",
    "outline": "#4f8fc7",
    "eye": "#16344f",
    "pupil": "#0a1f30",
    "accent": "#ffd27d",
    "ring": "#7fb8e8"
  },
  "styleOverrides": {                   // 可选：按阶段覆盖，优先于 palette
    "active.ring": "#c5ae70",
    "critical.body": "#c96569"
  },
  "animations": {                       // 可选：逐动作精灵表
    "idle": { "file": "common/idle.webp", "frames": 12, "fps": 13, "loop": true },
    "working": { "file": "common/working.webp", "frames": 6, "fps": 10, "loop": true },
    "warning": { "file": "common/warning.webp", "frames": 4, "fps": 10 }
  },
  "assets": { "preview": "preview/thumb.webp" }   // 可选：普通资源映射
}
```

### palette / styleOverrides 的键

| 键 | 含义 |
| --- | --- |
| body | 身体主色 |
| belly | 肚皮色 |
| outline | 描边色 |
| eye / pupil | 眼睛 / 瞳孔 |
| accent | 腮红与点缀 |
| ring | 上下文压力环 |

`styleOverrides` 的键格式为 `<stage>.<key>`（如 `critical.ring`），优先级高于 `palette`。
未提供任何配色的皮肤自动回退到默认立绘配色。

## 4. 回退链

动作素材解析顺序（`resolveSkinAction`）：

1. `stages/<stage>/<action>`（分阶段动作）
2. `common/<action>`（通用动作）
3. `stages/<stage>/idle`（分阶段 idle）
4. `common/idle`（通用 idle）
5. 内置 SVG 兜底立绘

缺失的素材或图片加载失败时，同样回退到 SVG 兜底，不会出现空白。

## 5. 导入安全与大小限制（客户端内置）

皮肤 ZIP 在**客户端本地**解包（`fflate`，无需宿主适配器），所有校验在导入时完成：

| 限制 | 默认值 |
| --- | --- |
| `maxZipBytes`（ZIP 输入上限） | 24 MiB |
| `maxFiles`（条目数） | 256 |
| `maxFileBytes`（单文件解压后） | 16 MiB |
| `maxTotalBytes`（解压总量） | 64 MiB |

任何路径校验失败、manifest 缺失/非法或超出限制，导入都会以稳定错误码失败：

- `invalidZip`：不是有效 ZIP / 空文件
- `tooLarge`：超出大小限制
- `noManifest`：缺少 `manifest.json`
- `invalidManifest`：清单 JSON 或 id/name 非法
- `unsafeEntries`：包含不安全路径

## 6. 内置皮肤

| id | 名称 | 类型 |
| --- | --- | --- |
| `example.green-sprout` | 绿色小芽 Green Sprout | 纯配色（含动作声明） |
| `builtin.blue-ice` | 蓝冰 Blue Ice | 纯配色 palette |
| `builtin.purple-mist` | 紫雾 Purple Mist | 纯配色 palette |
| `builtin.orange-citrus` | 小橘 Orange Citrus | 纯配色 palette |

内置皮肤不可删除；自定义皮肤（ZIP 导入）存放在浏览器 IndexedDB（`skins` 库），
可随时删除并回退默认。
