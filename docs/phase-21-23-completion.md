# Phase 21-23 Completion

## Scope

- Phase 21: Replaced the demo backpack capacity check with an 8x6 occupancy grid.
- Phase 22: Finished resource searches even when the backpack is full, and drops overflow loot from the searched resource point.
- Phase 23: Added high-quality ground loot light pillars and a visible backpack entry icon in the raid HUD.

## Implementation Notes

- `G.Config.BACKPACK_GRID_W` and `G.Config.BACKPACK_GRID_H` define the 8x6 backpack grid.
- Backpack entries now support `{ id, n, x, y, w, h }`.
- Legacy `{ id, n }` backpack entries are normalized into the grid on first use.
- Stack counts still work, but each stack occupies one item footprint.
- Demo valuables, meds, armor, and weapons now define or infer grid footprints.
- The in-raid inventory overlay renders the backpack as a true grid and supports targeted drag placement.
- Resource overflow uses `Raid._dropGroundItem()` at the resource point location.
- Rare and epic ground loot use `Raid._groundQualityBeamColor()` for visible quality beams.

## Verification

Command:

```powershell
cd D:\CODEX\ProjectSDC\third_party\search-strike-extract
node tools\smoke.js
```

Result:

```text
79 passed, 0 failed
```
