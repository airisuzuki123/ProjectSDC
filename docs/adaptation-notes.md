# Phase 0 原型改造清单

## 1. 改造策略

基于 `search-strike-extract` 推进关卡内 Demo，建议采用“保留骨架、替换规则、砍局外”的方式。

不要第一步重构项目。先在现有闭环里改出目标规则：

1. 保留移动、射击、敌人 AI、搜索容器、撤离点、结算页。
2. 增加撤离卷轴残页、魔物等级、狂暴、肉鸽三选一、完美撤离挑战。
3. 简化或绕过局外仓库、商店、任务、正式经济。

## 2. 保留模块

| 模块 | 文件 | 保留原因 |
|---|---|---|
| Canvas 渲染和主循环 | `js/main.js`、`js/core.js` | 已稳定，测试通过。 |
| 玩家移动射击 | `js/entities.js`、`js/raid.js` | 可直接支撑战斗体验。 |
| 敌人 AI | `js/entities.js` | 巡逻、警戒、战斗已经可用。 |
| 搜索容器 | `js/world.js`、`js/raid.js` | 可改名为宝箱、矿堆、资源点。 |
| 掉落生成 | `js/data.js`、`js/world.js`、`js/raid.js` | 可扩展残页和宝物碎片。 |
| 撤离点 | `js/world.js`、`js/raid.js` | 可改造成 30 秒挑战。 |
| 结算页 | `js/ui.js` | 可复用并增加撤离类型。 |
| 中文本地化 | `js/i18n.js` | 已有中文，可直接替换术语。 |
| Smoke 测试 | `tools/smoke.js` | 改造后用于回归验证。 |

## 3. 需要新增的局内状态

建议统一放在 `Raid` 实例上，第一版不要拆太多新文件。

```js
this.dungeon = {
  scrollFragments: 0,
  requiredFragments: 4,
  monsterLevel: 1,
  monsterLevelTimer: 0,
  monsterLevelInterval: 45,
  monsterLevelMax: 6,
  enraged: false,
  enrageTime: 300,
  rewardMultiplier: 1,
  selectedCurses: [],
  curseTriggerCount: 0,
  maxCurseTriggerCount: 2,
  extractionChallenge: null
};
```

后续如果 Demo 继续扩大，再把它拆成独立模块。

## 4. Phase 1 改造：单局基础流程

### 修改点

| 文件 | 任务 |
|---|---|
| `js/ui.js` | 增加快速进入 Demo 的入口，或默认使用 scavKit 直接开始。 |
| `js/main.js` | 保留当前状态机，不急着重构。 |
| `js/raid.js` | 在 `Raid` 构造函数中初始化 `this.dungeon`。 |
| `js/meta.js` | Demo 入口暂时使用 `Profile.scavKit()`，绕过正式出击扣装备。 |

### 完成状态

- 点击入口后直接进入一局。
- 不要求玩家配置装备。
- 结算后能返回入口并重开。

## 5. Phase 2 改造：搜索与掉落

### 修改点

| 文件 | 任务 |
|---|---|
| `js/data.js` | 将容器表改成资源点掉落表，增加残页和宝物碎片。 |
| `js/world.js` | 容器类型改名或映射为宝箱、矿堆、高价值宝箱。 |
| `js/raid.js` | `_collect(cont)` 中识别特殊掉落类型。 |
| `js/i18n.js` | 替换容器和道具中文名。 |

### 建议新增物品

| id | 名称 | 类型 | 说明 |
|---|---|---|---|
| `d_scroll_fragment` | 撤离卷轴残页 | 局内道具 | 不进背包，只累计进度。 |
| `d_coin` | 银币 | 局内货币 | 第一版可只显示，不做消耗。 |
| `d_treasure_low` | 宝物碎片 | 可带出物 | 占 1 格。 |
| `d_treasure_high` | 高级宝物碎片 | 可带出物 | 占 2 格。 |
| `d_treasure_full` | 完整宝物 | 可带出物 | 占 3 格。 |

### 完成状态

- 搜索资源点能拿到残页和宝物。
- 残页不占背包。
- 宝物进入背包并计算收益。

## 6. Phase 3 改造：背包与收益

### 当前问题

当前 `Player.backpackCount()` 返回的是背包堆叠项数量，不是占格数量：

```js
backpackCount() { return this.backpack.length; }
```

目标 Demo 需要按物品占格计算。

### 修改点

| 文件 | 任务 |
|---|---|
| `js/data.js` | 给可带出物增加 `slotCost` 字段。 |
| `js/entities.js` | 新增 `backpackUsed()`，按 `slotCost * n` 计算。 |
| `js/entities.js` | 修改 `addLoot(id, n)`，按剩余容量决定是否加入。 |
| `js/raid.js` | HUD 背包显示从数量改为占格。 |
| `js/ui.js` | 局内背包弹窗显示占格和收益。 |

### 完成状态

- 背包容量按格子消耗。
- 背包满时阻止拾取。
- 当前收益估值可见。

## 7. Phase 4 改造：残页与普通撤离

### 修改点

| 文件 | 任务 |
|---|---|
| `js/raid.js` | `_collect(cont)` 中拾取残页时增加 `scrollFragments`。 |
| `js/raid.js` | `onEnemyKilled(e)` 中允许怪物概率掉残页。 |
| `js/raid.js` | `_finish(outcome)` 中根据残页数量改写死亡结算。 |
| `js/raid.js` | 新增 `normalExtract()` 或输入动作，残页满后可主动撤离。 |
| `js/i18n.js` | 增加残页进度和可撤离提示。 |

### 结算规则

```text
残页 < 4 且死亡 -> failed，收益清零
残页 >= 4 且死亡 -> normal_extract，背包收益带出
残页 >= 4 且主动撤离 -> normal_extract，背包收益带出
```

### 完成状态

- 玩家知道残页目标是 `4 / 4`。
- 残页满后有明确“可普通撤离”提示。
- 死亡结算和残页状态绑定。

## 8. Phase 5 改造：怪物压力曲线

### 修改点

| 文件 | 任务 |
|---|---|
| `js/data.js` | 增加魔物等级和狂暴配置。 |
| `js/raid.js` | 在 `update(dt)` 中推进等级计时。 |
| `js/entities.js` | 敌人生成或更新时读取当前怪物倍率。 |
| `js/raid.js` | 狂暴后提高刷怪频率或追加刷怪。 |
| `js/i18n.js` | 增加魔物等级、狂暴提示。 |

### 建议先做简单版本

不改敌人 AI，只改数值倍率：

```text
每 45 秒：
生命倍率 +15%
攻击倍率 +10%

5 分钟：
进入狂暴
攻击倍率额外 +40%
刷新间隔缩短 30%
```

### 完成状态

- 3 分钟后压力明显增加。
- 5 分钟后进入狂暴。
- 玩家能感知继续停留的风险。

## 9. Phase 6 改造：肉鸽三选一

### 建议实现方式

第一版用 DOM 弹窗，不做复杂动画。

### 修改点

| 文件 | 任务 |
|---|---|
| `js/data.js` | 增加 `CurseOptions` 配置。 |
| `js/raid.js` | 根据击杀数或搜索次数触发三选一。 |
| `js/ui.js` | 增加三选一弹窗。 |
| `js/raid.js` | 选择后应用效果，并累计收益倍率。 |
| `js/i18n.js` | 增加词条文本。 |

### 第一版触发条件

```text
搜索资源点 2 次 -> 触发一次
击杀怪物 15 个 -> 触发一次
单局最多 2 次
```

### 第一版效果类型

- 采集速度。
- 残页掉率。
- 背包容量。
- 玩家伤害。
- 怪物刷新间隔。
- 玩家受伤倍率。

### 完成状态

- 单局能触发 1 - 2 次。
- 选项明确显示“获得 / 代价 / 收益”。
- 选择能影响局内或结算。

## 10. Phase 7 改造：撤离点 30 秒挑战

### 当前逻辑

`raid.js` 当前撤离逻辑：

```text
站在撤离区内 -> extracting.t 累计 -> 达到 EXTRACT_TIME -> outcome=extract
```

当前 `EXTRACT_TIME` 是 6 秒。

### 目标逻辑

```text
进入撤离点 -> 点击/停留激活挑战
挑战开始 -> 30 秒倒计时
倒计时期间持续刷怪
结束时玩家存活 -> perfect_extract
挑战期间死亡 -> 根据残页状态结算
```

### 修改点

| 文件 | 任务 |
|---|---|
| `js/data.js` | `EXTRACT_TIME` 改为 30，或新增 `PERFECT_EXTRACT_TIME`。 |
| `js/raid.js` | `_checkExtract(dt)` 改为挑战状态机。 |
| `js/raid.js` | 挑战期间追加刷怪逻辑。 |
| `js/raid.js` | `_finish()` 增加 `perfect_extract`。 |
| `js/ui.js` | 结算页支持完美撤离。 |
| `js/i18n.js` | 增加挑战开始、倒计时、完美撤离文本。 |

### 完成状态

- 玩家主动触发 30 秒挑战。
- 挑战期间不能无脑站桩。
- 成功后显示完美撤离。
- 完美撤离收益高于普通撤离。

## 11. Phase 8 改造：HUD、结算与调试

### HUD 新增字段

| 字段 | 来源 |
|---|---|
| 残页进度 | `raid.dungeon.scrollFragments` |
| 魔物等级 | `raid.dungeon.monsterLevel` |
| 狂暴状态 | `raid.dungeon.enraged` |
| 当前收益倍率 | `raid.dungeon.rewardMultiplier` |
| 背包占用 | `player.backpackUsed()` |
| 撤离挑战倒计时 | `raid.dungeon.extractionChallenge.remainingTime` |

### 调试能力

建议先绑定到键盘或临时按钮：

| 操作 | 用途 |
|---|---|
| 加 1 个残页 | 验证普通撤离。 |
| 触发三选一 | 验证词条。 |
| 提升魔物等级 | 验证压力曲线。 |
| 进入狂暴 | 验证狂暴提示。 |
| 传送撤离点 | 验证完美撤离。 |
| 强制死亡 | 验证失败分支。 |

## 12. 建议最先动的文件顺序

1. `js/data.js`：先加 Demo 配置和新物品。
2. `js/raid.js`：加 `this.dungeon` 和残页/结算分支。
3. `js/entities.js`：改背包容量计算。
4. `js/i18n.js`：补 HUD 和结算文本。
5. `js/ui.js`：改结果页和三选一弹窗。
6. `tools/smoke.js`：补残页、普通撤离、完美撤离测试。

## 13. 不建议第一轮做的事

- 不要重写地图生成。
- 不要重写敌人 AI。
- 不要接正式账号背包。
- 不要做完整装备养成。
- 不要做正式 UI 美术。
- 不要做多主题地图。
- 不要做复杂 Boss。

这些都会拖慢 Demo 验证。

## 14. Phase 0 之后的第一个开发目标

第一个可开发目标应该是：

```text
在现有项目中加入撤离卷轴残页，并改造死亡/普通撤离结算。
```

原因：

- 它最能体现目标玩法和原项目的差异。
- 它依赖较少，只需要改掉落、HUD、结算。
- 完成后就能验证“失败清零 vs 残页保底撤离”的核心风险底线。

建议验收：

- 搜索容器能拿到残页。
- HUD 显示 `撤离残页 0/4`。
- 残页不足死亡，结算显示失败，收益为 0。
- 残页满后可以主动普通撤离。
- 残页满后死亡，结算显示普通撤离，收益保留。
