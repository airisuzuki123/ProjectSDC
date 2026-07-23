# Phase 5 完成记录：怪物刷新与压力曲线

## 1. 阶段目标

Phase 5 的目标是让 Demo 局内压力随时间上升，形成“搜得越久越危险”的撤离决策。

本阶段实现的是可调参的最小版本：

- 每隔固定时间提升魔物等级。
- 魔物等级影响新生成敌人的生命和伤害。
- 定时从地图已有刷怪点补充敌人。
- 达到指定时间后进入狂暴状态。
- HUD 显示魔物等级和狂暴状态。

## 2. 已完成内容

| 能力 | 状态 |
|---|---|
| Demo 配置化魔物等级间隔 | 已完成 |
| 魔物等级上限 | 已完成 |
| 新生成怪物生命倍率 | 已完成 |
| 新生成怪物伤害倍率 | 已完成 |
| 定时补充怪物 | 已完成 |
| 存活怪物数量上限 | 已完成 |
| 3 级触发一次精英怪 | 已完成 |
| 5 分钟后进入狂暴 | 已完成 |
| 狂暴后伤害、生命、刷新频率提升 | 已完成 |
| HUD 显示魔物等级和狂暴状态 | 已完成 |
| 自动测试覆盖压力曲线 | 已完成 |

## 3. 关键参数

位置：`third_party/search-strike-extract/js/data.js`

```js
G.DemoConfig = {
  monsterLevelInterval: 45,
  monsterLevelMax: 6,
  monsterHpPerLevel: 0.15,
  monsterDamagePerLevel: 0.10,
  monsterSpawnInterval: 20,
  monsterSpawnMinInterval: 9,
  monsterSpawnLevelReduction: 0.08,
  monsterSpawnMaxAlive: 18,
  eliteLevel: 3,
  enrageTime: 300,
  enrageHpBonus: 0.60,
  enrageDamageBonus: 0.40,
  enrageSpawnIntervalMultiplier: 0.65
};
```

## 4. 当前体验效果

- 开局怪物强度保持原型默认值。
- 每 45 秒魔物等级提升 1 级，最高 6 级。
- 魔物等级越高，新刷出的怪物血量和伤害越高。
- 魔物等级达到 3 级时，会额外补充一次精英怪。
- 5 分钟后进入狂暴，怪物更硬、伤害更高、刷新更快。
- 玩家可以在 HUD 右上角看到魔物等级和狂暴状态。

## 5. 验证

新增测试：

```text
demo monster pressure levels up and enrages over time
demo pressure spawns reinforcements with scaled stats
```

推荐验证命令：

```powershell
cd D:\CODEX\ProjectSDC\third_party\search-strike-extract
node tools\smoke.js
```

## 6. 下一步建议

进入 Phase 6：肉鸽三选一。

Phase 6 可以复用本阶段的压力入口，例如：

- 提高收益，但缩短刷怪间隔。
- 提高残页掉落，但降低治疗效果。
- 提高玩家伤害，但提高受到伤害。
- 提高背包容量，但降低移动速度。
