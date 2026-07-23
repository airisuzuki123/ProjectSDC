# Phase 8 Completion: Room Portal Map Skeleton

## Scope

Phase 8 replaces the Demo raid's large procedural map with a compact room-chain layout. Non-Demo raids still use the original procedural map generator.

## Rules Implemented

- Demo map generation creates a main path of 4-5 small rooms.
- The first room is the spawn room.
- The final room contains the perfect extract vent.
- A high-value reward room can appear as a side room.
- Rooms are connected by normal portals.
- Normal portals move the player immediately to the target room when touched.
- Pressure spawns prefer the player's current room when possible.

## Implementation Notes

- `G.MapGen.generate(loc, { demo: true })` uses the new Demo room-map generator.
- The room map exposes `map.roomGraph` and `map.portals`.
- `Raid._updatePortals()` handles immediate normal portal travel.
- Portal travel cancels active searches and perfect extract progress.
- Portal art is a simple in-world ring and label for the first playable pass.

## Not Included Yet

- Room lock rules and wave completion gates.
- Conditional coin portals.
- Coin delivery animation.
- Automatic resource-point harvesting.
- Automatic aim and projectile upgrade choices.

## Verification

`tools/smoke.js` covers:

- Demo room path length and portal generation.
- Smaller overall map area versus the base location.
- Spawn room and extract room placement.
- Immediate normal portal travel.
