# Phase 27 Completion

## Scope

- Replaced the original manual-playtest requirement with the approved scripted route baseline.
- Added `node tools\smoke.js --phase27-baseline`, which runs the regular smoke suite and then executes ten seeded Demo route scenarios.
- Kept all game parameters and gameplay rules unchanged.

## Coverage

- Ten routes cover horizontal and vertical room chains.
- Routes cover failed, normal-extract, and perfect-extract settlements before the raid clock expires.
- Routes exercise resource searches, paid gold portals, and both curse and skill choices.
- The script reports settlement pace and all `playtestMetrics` fields for each route.

## Result

- 44 rooms entered, including 2 reward rooms.
- 41 resource searches completed.
- 45 gold collected, 6 spent, and 2 paid portals opened.
- 20 build choices: 12 curses and 8 skills.
- 1 failed, 2 normal extracts, 1 perfect extract, and 6 MIA settlements.

## Finding

- `G.Config.RAID_TIME` is 360 seconds. Scenarios scheduled at or above that limit settle as `mia` before their requested outcome.
- This prevents the current build from validating the 6-8 minute portion of the perfect-extract target window. The conflict is recorded for Phase 28; no configuration change was made in Phase 27.

## Limitation

The scripted controller verifies deterministic route, state, metric, and settlement behavior. It does not substitute for desktop keyboard or mobile touch feel; that coverage remains in Phase 30.

## Verification

```powershell
cd D:\codex\ProjectSDC\third_party\search-strike-extract
node tools\smoke.js --phase27-baseline
```

Result:

```text
83 passed, 0 failed
```
