# Phase 24 Completion

## Scope

- Adjusted the perfect extract challenge into a two-step flow:
  - Stand still in the green extract zone for 2 seconds to arm the challenge.
  - After activation, survive for 30 seconds to complete perfect extraction.
- Active perfect extract challenges no longer require the player to stay inside the green zone.
- Fixed vertical demo room visual artifacts by clearing the full viewport before each raid draw.
- Added a player-only overhead health bar while keeping the existing top-left HUD health display.

## Implementation Notes

- `G.DemoConfig.perfectExtractArmTime` controls the 2 second arming duration.
- `Raid.dungeon.extractionChallenge.phase` now separates `arming` from `active`.
- Leaving the extract zone before activation resets the arming state.
- Moving during the arming phase resets the arm timer.
- Once active, the perfect extract timer keeps running until success or player death.
- The raid renderer now fills the whole viewport before world rendering so narrow vertical maps do not leave stale canvas pixels around the world.

## Verification

Command:

```powershell
cd D:\CODEX\ProjectSDC\third_party\search-strike-extract
node tools\smoke.js
```

Result:

```text
81 passed, 0 failed
```
