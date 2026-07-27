# Phase 26 Completion

## Scope

- Added Demo playtest recap metrics to settlement results.
- The result screen now summarizes route depth, searched resources, paid gold-door usage, and build choices.
- Demo runs now keep lightweight counters during play so tuning feedback is available without reading logs.

## Recap Metrics

- `roomsEntered`: number of rooms entered for the first time.
- `rewardRoomsEntered`: number of reward rooms entered for the first time.
- `resourcesSearched`: number of resource points completed.
- `goldCollected`: dungeon gold collected during the run.
- `goldSpent`: dungeon gold spent on paid portals.
- `paidPortalsOpened`: paid gold portals fully opened.
- `choicesTaken`: total shared upgrade choices selected.
- `cursesTaken`: curse choices selected.
- `skillsTaken`: skill choices selected.

## Implementation Notes

- Metrics live under `Raid.dungeon.playtest` during Demo raids.
- Metrics are copied into `result.playtestMetrics` during settlement.
- Room metrics count first entry only, so backtracking does not inflate route depth.
- Paid portal metrics use a per-portal `playtestOpened` flag to avoid double counting.
- Non-Demo raid behavior is unchanged.

## Verification

Command:

```powershell
cd D:\CODEX\ProjectSDC\third_party\search-strike-extract
node tools\smoke.js
```

Result:

```text
83 passed, 0 failed
```

## Manual Verification

- Verified Chinese and English settlement screens display route, resource search, gold-door, and build-choice recaps.
- Verified a normal extraction reports the current run metrics without exposing the recap outside Demo raids.
