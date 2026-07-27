# Phase 30 Completion

## Scope

- Completed the Demo compatibility, delivery, and manual-feedback closure.
- Kept the 3-5 minute and 5-8 minute windows as settlement references only.
- Added the in-raid threat progress HUD, dungeon gold status, curse icons and localized curse tips.
- Allowed searching and shooting to proceed together.
- Made non-ammo backpack items occupy individual grid entries without stacking.

## Verification

- `node tools\smoke.js` passed with `89 passed, 0 failed`.
- `node tools\smoke.js --phase27-baseline` passed with `89 passed, 0 failed` and retained all ten scripted routes.
- Local `8080`, loopback `8082`, and the host LAN address `8082` returned HTTP 200.
- Browser visual checks covered the Chinese Demo HUD, three settlement outcomes, backpack, challenge HUD layout, and continuous runs.

## Acceptance Note

The current environment did not independently provide Chrome, Edge, a physical touch device, or a second LAN device. Those external-device checks remain supplemental coverage; Phase 30 is marked complete by the user's final acceptance decision.

## Next Phase

Phase 31 starts the reusable in-raid challenge framework and challenge entry flow. It does not add progression, permanent unlocks, or external services.
