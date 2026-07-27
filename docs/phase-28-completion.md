# Phase 28 Completion

## Change

- Added `G.DemoConfig.raidTimeLimit = 510` seconds.
- Demo raids use the new limit; regular raids retain `G.Config.RAID_TIME = 360` seconds.
- The 30-second headroom after the 480-second pace-window maximum allows a target-window settlement to resolve before MIA.

## Scripted Regression

The seeded Phase 27 controller was rerun with `node tools\smoke.js --phase27-baseline`.

- 45 rooms entered, including 3 reward rooms, and 41 resource searches completed.
- 53 gold collected, 9 spent, and 3 paid portals opened.
- 20 build choices: 11 curses and 9 skills.
- 3 failed, 4 normal extracts, 2 perfect extracts, and 1 MIA settlement.
- Normal extracts at 300, 360, and 480 seconds fall in the 3-5 minute target window; perfect extracts at 330 and 450 seconds fall in the 5-8 minute target window.
- The only MIA result occurs at 510 seconds, outside the target window.

## Verification

```powershell
cd D:\codex\ProjectSDC\third_party\search-strike-extract
node tools\smoke.js
node tools\smoke.js --phase27-baseline
```

Result:

```text
84 passed, 0 failed
```

## Manual Verification

- A fresh local Demo raid displayed an 8:29 countdown, confirming the 510-second Demo limit is active in the browser.
