# Phase 13 Completion: Demo Auto-Aim Combat

## Scope

Phase 13 changes Demo combat input from pointer-driven shooting to automatic nearest-target shooting.

## Implemented

- Demo raids automatically aim at the nearest visible enemy in weapon range.
- Demo room maps prefer targets in the current room.
- Demo raids fire automatically when a valid target exists.
- Demo shooting no longer depends on mouse input.
- Demo shooting no longer consumes magazine ammo.
- Demo reload input is ignored.
- Demo resource harvesting is not interrupted by mouse fire input.
- The weapon HUD shows automatic combat state instead of magazine and reserve ammo in Demo raids.

## Preserved

- Non-Demo raids still use the original mouse or touch aiming and firing flow.
- Non-Demo raids still consume magazine ammo and use reload behavior.
- Existing player damage multiplier effects still apply to Demo bullets.
- A projectile-count modifier hook is available for future skill upgrades.

## Verification

`tools/smoke.js` covers:

- Mouse fire input does not interrupt Demo resource harvesting.
- Demo combat auto-aims the nearest enemy.
- Demo combat fires without mouse input.
- Demo combat can fire with an empty magazine without changing magazine count.
