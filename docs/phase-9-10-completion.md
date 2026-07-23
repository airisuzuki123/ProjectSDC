# Phase 9-10 Completion: Room Waves and Gold Portals

## Scope

This slice adds the first playable version of room-gated combat and paid side portals for the Demo room-map flow.

## Phase 9: Room Waves

- Demo raids no longer spawn every room's enemies at raid start.
- The spawn room starts cleared.
- Entering a combat, reward, or extract room starts that room's configured waves.
- Outgoing portals stay locked until the room's configured waves are cleared.
- After all configured waves are cleared, portals open.
- Cleared rooms continue to revive smaller groups of monsters after `G.DemoConfig.roomReviveInterval`.
- Room pressure spawns prefer the player's current room.

## Phase 10: Gold Portals

- Gold is a Demo-only dungeon currency.
- Gold does not enter the backpack or consume slots.
- Monsters drop dungeon gold.
- Reward-room entrance portals can require gold.
- Required gold is also seeded into earlier room containers so paid reward rooms are not impossible.
- Paid portals require the player to stand still beside the portal.
- Gold is paid one coin at a time using `G.DemoConfig.coinPortalPayInterval`.
- When the required amount is paid, the portal immediately transfers the player.

## Tunable Values

- `roomReviveInterval`: 14 seconds.
- `roomWaveBaseCount`: 3 monsters.
- `coinPortalBaseCost`: 3 gold.
- `coinPortalPayInterval`: 0.18 seconds per gold.

## Not Included Yet

- Full coin flight animation from player to portal.
- Room-completion UI beyond portal labels and toasts.
- Special portal variants other than reward-room gold doors.
- Automatic harvesting and magnifying-glass resource markers.
- Auto-aim and projectile-growth skill choices.

## Verification

`tools/smoke.js` covers:

- Locked portals before combat-room waves are cleared.
- Portal unlock after room waves are cleared.
- Revive timer spawning more monsters in cleared rooms.
- Dungeon gold collection without backpack usage.
- Paid portal standing payment and transfer.
