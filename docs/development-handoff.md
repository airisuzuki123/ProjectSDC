# ProjectSDC 开发交接文档

> 更新时间：2026-07-27
>
> 当前阶段：Phase 36 已完成，Phase 37 尚未启动。
>
> 本次交接目标：将仓库推送到 `origin/master` 后，后续开发从五关入口与顺序解锁展示开始，不重复实现上一阶段内容。

## 1. 项目定位

ProjectSDC 是基于纯 HTML、CSS 和 JavaScript 的搜打撤 Web 游戏原型，业务代码位于 `third_party/search-strike-extract`。

Phase 1-36 已完成单局 Demo、房间战斗、随机挑战包、局内构筑、占格背包、脚本化挑战基线、五关数据、房间预算和进度存档迁移。下一版本目标是构建五关入口与顺序解锁展示，并在后续阶段接入轻量局外资产循环；不进入装备强化或角色长期养成。

## 2. 仓库信息

| 项目 | 内容 |
| --- | --- |
| 本地仓库 | `D:\codex\ProjectSDC` |
| 远程仓库 | `https://github.com/airisuzuki123/ProjectSDC.git` |
| 分支 | `master` |
| 远程目标 | `origin/master` |
| 当前提交 | 以 `git log -1 --oneline` 为准 |
| 自动验证 | `99 passed, 0 failed` |

交接完成后的预期状态：`master` 与 `origin/master` 同步，工作区干净。

## 3. 已完成阶段

- Phase 1-24：Demo 入口、残页、撤离、房间地图、波次、金币门、背包与反馈基础。
- Phase 25-30：节奏指标、脚本化基线、信息反馈、HUD、搜索射击并行、非堆叠背包与兼容回归。
- Phase 31：挑战数据框架与随机入口。
- Phase 32：突击和射手职责、攻击预警与受击打断。
- Phase 33：技能、诅咒和风险收益构筑扩展。
- Phase 34：6 个随机挑战包及统一随机池。
- Phase 35：挑战脚本基线、价值品与掉落调整、附近战利品占格显示、撤离挑战传送门锁定。
- Phase 36：五关数据、4-8 个常规挑战房预算、关卡进度存档和旧存档迁移。

## 4. Phase 35 最终状态

### 4.1 挑战基线

- 命令：`node tools\smoke.js --phase35-baseline`
- 10 局脚本覆盖 6 个挑战包、横竖地图、失败/普通撤离/完美撤离、金币支路和技能/诅咒分支。
- 脚本指定结算结果，只用于路线和回归覆盖，不能作为真实胜率或平衡结论。

### 4.2 掉落与背包

- Demo 加权掉落池包含 16 个条目和局内金币。
- 新增野战电台、长焦镜头、古董花瓶、服务器机箱。
- 价值品占格覆盖 `1x1`、`1x2`、`2x1`、`2x2`、`3x1`、`3x2`。
- 普通敌人固定掉落 1 枚局内金币，并有 65% 概率掉落 1 件物品。
- 精英敌人掉落 1-2 枚金币和 1 件物品。
- 附近战利品按真实网格尺寸展示，点击拾取和拖拽行为保持不变。

### 4.3 完美撤离

- 绿色撤离圈内静止 2 秒进入 30 秒主动存活阶段。
- 主动阶段可离开绿色圈，但挑战不可取消。
- 主动阶段所有传送门关闭，不能切换房间规避撤离验证。
- 倒计时结束时存活则完美撤离。

## 5. Phase 36 最终状态

### 5.1 五关数据

- 新增 `G.DemoLevels`，共 5 个顺序关卡。
- 关卡常规挑战房预算为 4、5、6、7、8。
- 常规挑战房只统计主线 combat 房；出生房、奖励房和撤离房不计入该数量。
- 每关保存独立的 `challengePool`，抽取对象仍来自统一的 `G.Challenges` 挑战包注册表。
- `G.pickChallengeForLevel(level)` 会从该关对应池自动抽取挑战包；玩家入口仍不选择挑战包。

### 5.2 存档与解锁

- 本地存档新增 `demoProgress`，包含最高已解锁关卡、各关统计和最近历史。
- 旧版 `searchstrike_save_v1` 存档加载后会自动补齐 `demoProgress`，并保留语言、金钱、仓库等既有基础字段。
- 初始只开放第 1 关；锁定关卡通过启动入口会被拒绝。
- 普通撤离只记录本关普通撤离次数，不解锁下一关。
- 完美撤离记录本关完成并只解锁紧邻下一关。
- 失败或放弃只记录历史和失败/放弃次数，不解锁下一关。
- Demo 结算只记录关卡进度，不接入遗物货币、商店、仓库配装或跨关卡资产结算。

## 6. 下一版本已确认规则

### 6.1 五关与房间

- 可挑战关卡扩展为 5 关，初始只开放第 1 关。
- 普通撤离保留资产但不解锁下一关。
- 完美撤离视为通关并解锁下一关。
- 已解锁关卡可重复挑战。
- 常规挑战房按 4、5、6、7、8 逐关递增。
- 上述数量不包含出生房、奖励房和撤离房。
- 关卡与挑战包是两套数据：关卡负责进度，挑战包从对应随机池自动抽取，玩家不选择挑战包。
- 在五关扩展过程中继续扩充挑战包池，仍使用统一随机池，不拆分多套独立脚本。

### 6.2 遗物货币与资产

- 普通或完美撤离时，`valuable` 类型遗物折算为永久货币。
- 局内金币和撤离残页不进入局外经济。
- 成功撤离的武器、护甲和允许携带的道具进入仓库，可带入后续关卡。
- 失败、死亡或放弃时，带入资产和局内获得物全部消失。
- 商店使用遗物货币购买武器、护甲和道具，商品随关卡逐步解锁。
- 手枪不在商店出售；破产且没有可用武器时，进入关卡默认发放应急手枪。
- 应急手枪不可出售、不可永久入库，避免形成免费货币或复制来源。

## 7. Phase 37-42 顺序

1. Phase 37：五关入口、锁定状态、普通撤离与完美撤离解锁展示。
2. Phase 38：遗物永久货币与结算明细。
3. Phase 39：商店、仓库、配装和破产应急手枪。
4. Phase 40：跨关卡资产返还、再次带入和失败销毁。
5. Phase 41：五关内容、挑战包和数值扩展。
6. Phase 42：完整经济闭环、五关和桌面/移动端回归。

正式拆分和验收标准见 `docs/development-plan.md`。

## 8. 明确未启动内容

- 当前没有 Phase 37 业务代码。
- 尚未新增五关主界面入口、关卡锁定展示、遗物货币结算或新主界面经济入口。
- 尚未恢复旧商店、仓库和配装页面到当前 Demo 主流程。
- 尚未扩展第 7 个及后续挑战包。

后续开发不得把计划描述误认为已经实现。

## 9. 可复用旧代码

- `js/meta.js` 已有本地存档、货币、仓库、购买、配装、出发扣除、成功返还和死亡不返还逻辑。
- `js/ui.js` 已有旧商店、仓库、配装和关卡列表页面，但当前 `showHub()` 提前返回，将它们隐藏。
- `js/main.js` 的 Demo 结算当前明确跳过局外经济，需要在 Phase 38-40 分阶段接回，不能一次性解除所有分支。
- `js/data.js` 已有商品池、物品价值和旧地点数据，可作为迁移基础，不应另建平行商店系统。

旧代码只能视为可复用基础，必须按五关规则补充存档迁移、幂等结算和自动验证后再接入。

## 10. 开发边界

Phase 37-42 不包含：

- 祭坛、钥匙门、条件资源点和特殊传送门。
- 完整 Boss 战。
- 装备强化、角色等级、技能树和其他深度局外养成。
- 付费、商业化、联网交易、服务器和正式埋点平台。

继续保持：局内金币不占背包、自动瞄准最近敌人、搜索不阻断射击、技能与诅咒共享三选一、完美撤离主动阶段关闭传送门。

## 11. 验证命令

```powershell
cd D:\codex\ProjectSDC\third_party\search-strike-extract
node tools\smoke.js
node tools\smoke.js --phase35-baseline
```

最近验证结果：两条命令均为 `99 passed, 0 failed`。

启动本地服务：

```powershell
node D:\codex\ProjectSDC\tools\local-static-server.js D:\codex\ProjectSDC\third_party\search-strike-extract 8080
```

本机访问：`http://localhost:8080/`

## 12. 关键文件

- `third_party/search-strike-extract/js/data.js`
- `third_party/search-strike-extract/js/meta.js`
- `third_party/search-strike-extract/js/main.js`
- `third_party/search-strike-extract/js/raid.js`
- `third_party/search-strike-extract/js/ui.js`
- `third_party/search-strike-extract/js/i18n.js`
- `third_party/search-strike-extract/css/style.css`
- `third_party/search-strike-extract/tools/smoke.js`
- `docs/development-plan.md`

## 13. 后续接手顺序

1. 阅读 `AGENTS.md`、本交接文档和 `docs/development-plan.md`。
2. 执行 `git status --short` 和 `git log -3 --oneline`，确认工作区干净且与 `origin/master` 同步。
3. 运行完整 smoke 和 Phase 35 脚本基线。
4. 只启动 Phase 37：接入五关入口、锁定状态和顺序解锁展示，不提前接入商店或结算经济。
5. Phase 37 完成后更新计划、交接和测试，再提交推送。

## 14. 建议的新对话开场指令

```text
请读取 D:\codex\ProjectSDC\AGENTS.md、docs\development-handoff.md 和 docs\development-plan.md，检查 Git 状态并运行完整 smoke 与 Phase 35 脚本基线。确认 Phase 36 已推送且工作区干净后，只启动 Phase 37：接入五关入口、锁定状态和顺序解锁展示；不要提前开发遗物货币、商店或跨关卡资产结算。
```
