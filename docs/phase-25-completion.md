# Phase 25 Completion

## Scope

- Added a Demo playtest pacing window for tuning and acceptance.
- Demo settlement results now report whether the run was shorter than target, inside the target window, or longer than target.
- The in-raid Demo debug panel now shows current run time against the target window.
- Smoke coverage now verifies pace tags and UI rendering with pace data.

## Implementation Notes

- `G.DemoConfig.targetRunMinTime` is set to 300 seconds.
- `G.DemoConfig.targetRunMaxTime` is set to 480 seconds.
- `Raid._demoPaceCheck()` returns:
  - `short`: run time is below the target window.
  - `target`: run time is inside the 5-8 minute target window.
  - `long`: run time is above the target window.
- Demo result objects now include `paceTag`, `targetRunMinTime`, and `targetRunMaxTime`.
- The result screen displays a localized pace check row when `paceTag` exists.

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

- Verified Chinese and English settlement screens render the pace row correctly.
- Verified a short Demo run displays the below-target pace label and the current 5-8 minute target window.
- Verified the in-raid debug panel at 1280x720 and 390x844. The panel is positioned above the quick-slot and weapon HUD.
