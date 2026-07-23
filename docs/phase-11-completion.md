# Phase 11 Completion: Gold Portal Payment Feedback

## Scope

Phase 11 improves the paid portal interaction feedback without changing the Phase 10 payment rules.

## Implemented

- Each paid coin now creates a coin-flight visual from the player to the portal.
- The coin follows a short arcing path with a small trail.
- Portal payment still consumes one dungeon gold at a time.
- Existing portal progress text remains visible at the portal.
- Coin flight duration is configurable through `G.DemoConfig.coinPortalFlyTime`.

## Current Values

- `coinPortalFlyTime`: 0.42 seconds.

## Not Included Yet

- Resource-point automatic harvesting visuals.
- Full UI prompt panel for paid portals.
- Sound effects for each paid coin.

## Verification

`tools/smoke.js` covers:

- Paid portal payment spawning coin-flight visuals.
- Coin-flight cleanup after the configured flight time.
- Paid portal transfer and gold consumption remain intact.
