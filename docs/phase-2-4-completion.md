# Phase 2/4 完成记录：残页、普通撤离与死亡分支

## 1. 阶段目标

本次推进优先实现搜打撤 Demo 的核心保底规则：

```text
残页不足死亡 -> 本局失败，收益清零
残页足够死亡 -> 普通撤离，收益保留
残页足够主动按 X -> 普通撤离，收益保留
```

这部分横跨 Phase 2 的搜索掉落和 Phase 4 的撤离规则，因此作为交叉阶段完成。

## 2. 已完成内容

| 能力 | 状态 |
|---|---|
| 新增撤离卷轴残页道具 | 已完成 |
| 资源点掉落残页 | 已完成 |
| 怪物死亡掉落残页 | 已完成 |
| 残页不进入背包 | 已完成 |
| HUD 显示残页进度 | 已完成 |
| 残页满后提示普通撤离 | 已完成 |
| 按 `X` 主动普通撤离 | 已完成 |
| 残页不足死亡收益清零 | 已完成 |
| 残页足够死亡保底撤离 | 已完成 |
| Demo 结算不写正式仓库 | 已完成 |
| 自动测试覆盖新规则 | 已完成 |

## 3. 代码改动

### `js/data.js`

新增 Demo 配置：

```js
G.DemoConfig = {
  locationId: 'factory',
  scrollItemId: 'd_scroll_fragment',
  requiredFragments: 4,
};
```

新增道具：

```text
d_scroll_fragment: 撤离卷轴残页
```

并加入容器掉落表和敌人掉落表。

### `js/main.js`

Demo 入口会给 raid 标记：

```js
carried.demo = true;
```

Demo 结算只展示结果，不调用正式仓库和经济提交逻辑。

### `js/raid.js`

新增 Demo 局内状态：

```js
this.demo = !!carried.demo;
this.dungeon = {
  scrollFragments: 0,
  requiredFragments: 4,
};
```

新增能力：

- `_collectDungeonItem()`：处理残页拾取。
- `_canNormalExtract()`：判断是否可普通撤离。
- `_scrollParams()`：统一输出残页显示参数。
- `X -> normal_extract`：残页满后主动普通撤离。
- `_finish('death')` 在 Demo 模式下会分流：
  - 残页不足：`failed`
  - 残页足够：`normal_extract`

### `js/ui.js`

结果页支持：

- `failed`
- `normal_extract`
- `perfect_extract` 的预留标题
- 残页进度展示

### `js/i18n.js`

新增中英文文本：

- 撤离卷轴残页
- 残页 HUD
- 普通撤离提示
- 失败结算
- 普通撤离结算
- 完美撤离预留文本

### `tools/smoke.js`

新增自动测试：

- Demo 残页不足死亡 -> `failed`
- Demo 残页足够死亡 -> `normal_extract`
- Demo 残页足够按 `X` -> `normal_extract`
- UI 结果页支持 `failed` 和 `normal_extract`

## 4. 验证结果

已执行：

```text
node tools\smoke.js
```

结果：

```text
42 passed, 0 failed
```

## 5. 当前试玩方式

启动静态服务：

```powershell
node D:\CODEX\ProjectSDC\tools\local-static-server.js D:\CODEX\ProjectSDC\third_party\search-strike-extract 8080
```

打开：

```text
http://localhost:8080
```

进入主菜单后点击：

```text
关卡内 Demo
```

局内验证：

- 搜索资源点或击杀怪物，有概率获得撤离卷轴残页。
- 右上角 HUD 会显示残页进度。
- 残页达到 `4/4` 后，按 `X` 普通撤离。
- 残页不足时死亡，本局失败，收益清零。
- 残页足够时死亡，按普通撤离结算。

## 6. 下一步建议

建议进入 Phase 3：简化背包与收益容器。

当前原项目背包仍按“堆叠项数量”计算容量：

```text
backpack.length
```

目标 Demo 需要改成“占格容量”：

```text
普通宝物碎片：1 格
高级宝物碎片：2 格
完整宝物：3 格
```

这是下一步让玩家产生“背包取舍”的关键。
