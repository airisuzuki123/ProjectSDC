# Phase 17 Completion: Portal Interaction Polish

## Scope

Phase 17 polishes Demo portal readability and confirms paid portal interaction rules.

## Implemented

- Portal rendering now uses a dedicated requirement badge.
- Normal portals continue to show a directional marker.
- Locked portals continue to show a locked marker until the room is cleared.
- Gold portals now show a coin badge with `paid/cost` progress.
- Gold portal payment still uses the existing coin-flight animation.
- Gold portal payment only progresses while the player stands still beside the portal.
- Moving beside a gold portal does not consume gold and does not advance payment.
- Paid gold portals still transfer immediately after the requirement is satisfied.

## Preserved

- Normal portals still transfer immediately on contact.
- Gold remains dungeon-only currency and never enters backpack slots.
- Existing room-lock behavior is unchanged.
- Existing paid portal transfer and cooldown behavior is unchanged.

## Verification

`tools/smoke.js` covers:

- Normal portal contact transfers immediately.
- Locked combat rooms block portal exits.
- Gold remains dungeon currency.
- Standing payment opens paid portals.
- Coin-flight animation is spawned and cleaned up.
- Moving beside a gold portal does not pay.
- Standing beside a gold portal pays one coin after the configured interval.
