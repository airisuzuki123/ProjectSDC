# Phase 15 Completion: Isaac-Style Room Map Deepening

## Scope

Phase 15 deepens the Demo room map from a fixed compact skeleton into a configurable room-chain layout.

## Implemented

- Demo maps now use a compact `isaac_chain` room graph.
- The main path is a straight horizontal or vertical chain.
- The main path contains 4-5 rooms from spawn to extract.
- Room size is now configurable through `G.DemoConfig`.
- Reward rooms can appear as side rooms attached to main-path rooms.
- Reward room generation supports up to 2 high-value rooms.
- Reward rooms use paid gold entry portals.
- `roomGraph.rewardRoomIds` records all generated reward rooms.
- The legacy `roomGraph.rewardRoomId` field is preserved as the first reward room for compatibility.
- Gold required by each paid reward portal is injected into earlier main-path rooms before that portal.

## DemoConfig Additions

- `roomMainPathMin`: minimum main-path rooms.
- `roomMainPathMax`: maximum main-path rooms.
- `roomRewardChance`: chance for a side reward room.
- `roomRewardMax`: maximum reward rooms.
- `roomTileW`: room width in tiles.
- `roomTileH`: room height in tiles.
- `roomGap`: tile gap between rooms.

## Verification

`tools/smoke.js` covers:

- Main path length remains 4-5 rooms.
- Main-path rooms are adjacent and connected by two-way portals.
- Rooms stay within configured small-room dimensions.
- Demo room maps remain compact compared with the base location.
- Reward room count respects `roomRewardMax`.
- Reward rooms have gold entry portals.
- Forced double reward-room generation is possible.
- Gold portal costs are funded by earlier rooms before entry.
