# Phase 15 Completion: Compact Room Map Layout

## Scope

Phase 15 deepens the Demo room-map experience by making the generated dungeon feel more like a chain of small enclosed rooms instead of a long horizontal map strip.

## Implemented

- Demo room generation now uses a compact snake layout.
- The main path remains a linear progression from spawn room to extract room.
- The main path still contains 4-5 rooms.
- Individual Demo rooms are smaller: 9 x 7 tiles.
- Room spacing and map margin were reduced to keep the generated map compact.
- Consecutive main-path rooms are connected by paired portals.
- Optional high-value reward rooms remain side rooms off the main path.
- Reward room placement now prefers the smallest horizontal footprint.
- Reward room entry still uses a gold portal when generated.

## Preserved

- Spawn room, combat rooms, reward rooms, and extract room keep their existing roles.
- Portal transfer behavior is unchanged.
- Gold portal payment behavior is unchanged.
- Room waves, revive spawning, resources, and extract placement continue to use room metadata.

## Verification

`tools/smoke.js` covers:

- Demo maps use the compact snake layout.
- The main path contains 4-5 rooms.
- Room dimensions stay within the small-room limit.
- Overall Demo map bounds remain compact.
- Every consecutive main-path room has forward and return portals.
- Reward rooms, when generated, have a gold entry portal.
