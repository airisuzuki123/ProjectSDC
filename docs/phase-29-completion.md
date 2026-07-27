# Phase 29 Completion

## Finding

Demo resources are searched automatically while the player stands still nearby. The first in-raid help panel incorrectly instructed players to press `E` or the search button, although that interaction path is intentionally disabled for Demo raids.

## Change

- Added a localized Demo-specific help line: stand still by resources to auto-search.
- Kept the existing key and touch search instructions for regular raids.
- Added a draw-level smoke regression so a Demo raid must render the automatic-search instruction.

## Verification

- Chinese and English local browser checks confirmed the corrected first-screen help panel renders without HUD overlap.
- `node tools\smoke.js` passed with `85 passed, 0 failed`.
- `node tools\smoke.js --phase27-baseline` passed with `85 passed, 0 failed`.

## Scope

No gameplay behavior, configuration value, or input mechanic changed.
