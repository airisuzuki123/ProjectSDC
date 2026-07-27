# ProjectSDC 新对话开发交接文档

> 当前状态（2026-07-27）：`master` HEAD 为 `f97bd90 Tune demo raid time window`，已推送到 `origin/master`。
>
> - Phase 25/26：已完成节奏显示和结算试玩指标，提交 `584f79b`。
> - Phase 27：已按确认改为脚本化路线基线验证，提交 `71af1d2`。
> - Phase 28：Demo 局时上限调整为 510 秒，解决 360 秒提前 MIA 与 5-8 分钟目标冲突；非 Demo raid 仍为 360 秒。
> - 下一阶段为 Phase 29，仅处理真实试玩暴露的可读性或反馈问题；当前没有据此新增功能的依据。

更新时间：2026-07-27

## 1. 项目定位

项目：ProjectSDC 搜打撤关卡内 Demo。

代码基于 `third_party/search-strike-extract` 的纯 HTML、CSS 和 JavaScript Web 游戏原型，当前目标是完成关卡内核心循环的试玩验证与演示交付，不接正式局外系统。

## 2. 仓库信息

| 项目 | 内容 |
| --- | --- |
| 本地仓库 | `D:\codex\ProjectSDC` |
| 远程仓库 | `https://github.com/airisuzuki123/ProjectSDC.git` |
| 当前分支 | `master` |
| 当前 HEAD | `a42ddb9 Complete phase 24 extraction polish` |
| 最新已推送阶段 | Phase 24 |

重要：工作区存在 Phase 25 和 Phase 26 的未提交改动，不得重置、覆盖或重新实现。

当前预期状态：

```text
 M third_party/search-strike-extract/js/data.js
 M third_party/search-strike-extract/js/i18n.js
 M third_party/search-strike-extract/js/raid.js
 M third_party/search-strike-extract/js/ui.js
 M third_party/search-strike-extract/tools/smoke.js
?? docs/phase-25-completion.md
?? docs/phase-26-completion.md
 M docs/development-plan.md
?? docs/development-handoff.md
```

## 3. 当前验证结果

验证命令：

```powershell
cd D:\codex\ProjectSDC\third_party\search-strike-extract
node tools\smoke.js
```

最近验证结果：

```text
83 passed, 0 failed
```

该结果已经覆盖地图生成、搜索、战斗、撤离、房间波次、金币门、背包、三选一、调试快捷键、UI、移动触控路径和连续 raid 压力测试。

## 4. 已完成阶段

- Phase 1-7：Demo 入口、残页、背包、压力曲线、诅咒、完美撤离。
- Phase 8-14：房间地图、房间波次、金币门、自动搜索、自动瞄准、技能/诅咒共享三选一。
- Phase 15-18：随机横竖房间链、奖励支路、波次调优、传送门反馈、调试快捷键。
- Phase 19：房间波次与复活前 5 秒预警，复活阶段不锁门。
- Phase 20：左背包、右附近地面战利品，打开背包暂停，支持拖拽和点击转移。
- Phase 21-23：8x6 占位背包、背包满后溢出落地、品质光柱、HUD 背包入口。
- Phase 24：完美撤离规则调整、竖向地图花屏修复、玩家头顶血条。
- Phase 25：5-8 分钟节奏评估。已实现，尚未提交。
- Phase 26：结算页试玩指标。已实现，尚未提交。

## 5. 用户最新确认

1. 当前版本冻结新机制。
2. 每轮试玩按 10 局执行。
3. 普通撤离目标时长为 3-5 分钟。
4. 完美撤离目标时长为 5-8 分钟。
5. 最终验收同时覆盖桌面键鼠和移动触控。
6. 当前对话只整理计划和交接文档，不进行业务开发。

## 6. 已确认玩法规则

### 6.1 完美撤离

- 玩家在绿色撤离圈内静止 2 秒后激活挑战。
- 挑战持续 30 秒。
- 激活后玩家可以离开绿色撤离圈。
- 激活后挑战不可取消，玩家不需要返回绿色撤离圈。
- 倒计时结束时玩家存活即可完美撤离。

### 6.2 其他规则

- 普通传送门碰到后立即切换房间。
- 条件传送门要求玩家在旁边静止交付资源，完成后立即切换房间。
- 金币只在局内使用，不占背包格子。
- 自动瞄准优先最近敌人。
- 技能与诅咒共用三选一池。
- 每组三选一至少包含一个诅咒。
- 只显示玩家头顶血条，不显示怪物头顶血条。

## 7. Phase 25-26 本地改动说明

### Phase 25

- `G.DemoConfig.targetRunMinTime = 300`。
- `G.DemoConfig.targetRunMaxTime = 480`。
- 结算结果包含 `paceTag`、`targetRunMinTime`、`targetRunMaxTime`。
- 结算页显示偏快、目标区间或偏慢。
- 调试面板显示当前时间与 5-8 分钟目标窗口。

### Phase 26

新增 `Raid.dungeon.playtest`，记录：

- `resourcesSearched`
- `goldCollected`
- `goldSpent`
- `paidPortalsOpened`
- `roomsEntered`
- `rewardRoomsEntered`
- `choicesTaken`
- `cursesTaken`
- `skillsTaken`

结算时复制到 `result.playtestMetrics`，并在结果页展示路线、搜索、金币和构筑汇总。

## 8. 后续计划

正式计划见 [development-plan.md](development-plan.md)。

执行顺序：

1. Phase 25-26：人工检查、完整测试、提交并推送。
2. Phase 27：不改参数，先完成 10 局试玩基线。
3. Phase 28：根据数据调整现有配置。
4. Phase 29：只修复真实试玩暴露出的反馈和可读性问题。
5. Phase 30：桌面、移动端、横竖地图、三种结算和内网访问回归。

暂不开发：祭坛、钥匙、条件资源点、特殊传送门、完整 Boss、多主题、多关卡、正式埋点平台和局外系统。

## 9. 新对话开始时的操作顺序

1. 阅读 `AGENTS.md`。
2. 阅读本交接文档和 `docs/development-plan.md`。
3. 执行 `git status --short`，确认 Phase 25/26 未提交改动仍在。
4. 检查 `git diff`，不要回退现有改动。
5. 运行 `node tools\smoke.js`。
6. 从 Phase 25-26 收口开始，不要直接跳到新功能。

## 10. 常用命令

检查仓库：

```powershell
cd D:\codex\ProjectSDC
git status --short
git diff --stat
```

运行自动验证：

```powershell
cd D:\codex\ProjectSDC\third_party\search-strike-extract
node tools\smoke.js
```

启动本地服务：

```powershell
node D:\codex\ProjectSDC\tools\local-static-server.js D:\codex\ProjectSDC\third_party\search-strike-extract 8080
```

本机访问：

```text
http://localhost:8080
```

内网同事访问时，使用服务端电脑的局域网 IPv4：

```text
http://<局域网IPv4>:8080
```

## 11. 关键文件

- `third_party/search-strike-extract/js/data.js`
- `third_party/search-strike-extract/js/entities.js`
- `third_party/search-strike-extract/js/raid.js`
- `third_party/search-strike-extract/js/ui.js`
- `third_party/search-strike-extract/js/i18n.js`
- `third_party/search-strike-extract/css/style.css`
- `third_party/search-strike-extract/tools/smoke.js`
- `docs/development-plan.md`

## 12. 风险与注意事项

- Phase 25/26 尚未提交，执行任何 Git 清理操作前必须确认不会丢失这些改动。
- `83 passed` 只代表自动逻辑验证，不代表 3-5 分钟和 5-8 分钟体验目标已经达成。
- 第一轮 10 局试玩期间不要边玩边调参，否则数据无法作为统一基线。
- 如需新增机制或改变已确认玩法规则，必须先向用户确认并更新开发计划。
- Windows PowerShell 读取中文文档时使用 UTF-8，避免文档乱码。

## 13. 新对话建议开场指令

```text
请读取 D:\codex\ProjectSDC\AGENTS.md、docs\development-handoff.md 和 docs\development-plan.md，检查当前 Git 状态和 Phase 25/26 未提交改动。先完成 Phase 25/26 的人工检查、自动验证、提交和推送，不要新增玩法机制。完成后按计划进入 Phase 27。
```
