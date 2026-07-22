# Phase 1 完成记录：单局基础流程

## 1. 阶段目标

Phase 1 的目标是把参考项目改造成可以直接进入关卡内测试的 Demo 框架，绕过局外配装、商店、仓库管理等流程。

本阶段不改搜索、背包、残页、怪物成长、三选一和撤离挑战规则，只建立后续开发的最小运行入口。

## 2. 已完成内容

| 内容 | 状态 |
|---|---|
| 项目可运行 | 已在 Phase 0 验证，smoke 测试通过。 |
| 直接进入关卡入口 | 已完成。 |
| 默认 Demo 地点 | 已配置为 `factory`。 |
| 绕过局外配装 | 已完成，直接使用 `Profile.scavKit()`。 |
| 原有出击流程 | 保留不动。 |
| 原有测试 | 仍全部通过。 |

## 3. 代码改动

### `js/data.js`

新增 Demo 默认配置：

```js
G.DemoConfig = {
  locationId: 'factory',
};
```

### `js/main.js`

新增：

```js
startDemoRaid()
```

作用：

- 读取 `G.DemoConfig.locationId`。
- 找到默认地点。
- 使用 `G.Profile.scavKit()` 生成免费基础装备。
- 调用原有 `startRaid(loc, carried)` 进入关卡。

### `js/ui.js`

在主菜单顶部新增按钮：

```text
关卡内 Demo
```

点击后直接进入一局 Demo。

### `js/i18n.js`

新增中英文文本：

- `ui.hub.menu.demo.title`
- `ui.hub.menu.demo.sub`

## 4. 验证结果

已执行：

```text
node tools\smoke.js
```

结果：

```text
39 passed, 0 failed
```

说明：

- 原有地图生成、搜索、战斗、撤离、死亡、UI、中文本地化、移动端 HUD 等流程没有被破坏。
- Phase 1 改造没有影响原项目基础稳定性。

## 5. 当前可试玩方式

进入项目目录：

```powershell
cd D:\CODEX\ProjectSDC\third_party\search-strike-extract
```

启动静态服务：

```powershell
node D:\CODEX\ProjectSDC\tools\local-static-server.js D:\CODEX\ProjectSDC\third_party\search-strike-extract 8080
```

打开：

```text
http://localhost:8080
```

在主菜单点击：

```text
关卡内 Demo
```

即可直接进入一局。

如果不启服务，也可以直接打开：

```text
D:\CODEX\ProjectSDC\third_party\search-strike-extract\index.html
```

## 6. 本阶段完成标准对照

| 标准 | 结果 |
|---|---|
| 玩家可以开始一局 | 已完成。 |
| 不要求玩家配置装备 | 已完成。 |
| 结算后可以返回入口 | 复用原结果页和返回逻辑。 |
| 单局状态不污染下一局 | 复用原 Raid 构造和重开流程。 |
| 原有功能不被破坏 | smoke 测试通过。 |

## 7. 下一阶段建议

建议进入 Phase 2/Phase 4 的交叉改造：

```text
先加入撤离卷轴残页，并改造死亡/普通撤离结算。
```

原因：

- 这是目标玩法和原型差异最大的核心规则。
- 改造范围集中在 `data.js`、`raid.js`、`i18n.js`、`ui.js`。
- 完成后可以立刻验证“残页不足死亡清零，残页足够保底撤离”的搜打撤底线。
