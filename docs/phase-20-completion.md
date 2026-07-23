# Phase 20 Completion: In-Raid Backpack and Demo Loot Pool

## Scope

- Added an upgraded in-raid backpack overlay.
- Opening the backpack pauses the raid immediately and stops the rest of that update frame.
- The backpack overlay uses a two-panel layout:
  - Left: player backpack.
  - Right: nearby ground loot.
- Nearby loot is filtered by `G.DemoConfig.nearbyLootRadius`.
- Players can move loot from ground to backpack.
- Players can move backpack loot back to the ground.
- Players can reorder backpack entries.
- Drag and drop is supported for panel transfers and backpack reorder.
- Click fallback is kept for simple pickup/drop/use/equip interactions.
- Demo monster drops no longer include ammo.
- Demo monster drops now use `G.DemoLootDrops`, covering different rarities and 1/2/3 slot items.

## Implementation Notes

- `G.DemoConfig.nearbyLootRadius` controls which ground drops appear in the loot panel.
- Dungeon gold and scroll fragments still use their special collection paths, so gold does not enter backpack slots.
- The old raid inventory renderer remains in the file as an unreachable fallback; `openRaidInventory()` currently routes to the V2 overlay.

## Verification

- `node tools\smoke.js`
- Result: 76 passed, 0 failed.

