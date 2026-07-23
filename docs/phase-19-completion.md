# Phase 19 Completion: Room Wave Warnings

## Scope

- Added a 5 second warning countdown before normal room waves spawn.
- Added the same warning countdown before post-clear revive spawns.
- Normal wave warnings keep the room locked until the planned waves are cleared.
- Revive warnings keep cleared-room portals open.
- Revived monsters no longer relock portals.
- Leaving a revive room pacifies monsters in the previous room so they do not chase through portals.

## Implementation Notes

- `G.DemoConfig.roomWaveWarningTime` controls the countdown duration.
- Room state now stores `waveWarning` with `kind`, `t`, and `total`.
- Normal room waves use `kind: "wave"` and set `cleared = false`.
- Revive warnings use `kind: "revive"` and keep `cleared = true`.
- HUD warning text is drawn near the center of the screen.

## Verification

- `node tools\smoke.js`
- Result: 73 passed, 0 failed.

