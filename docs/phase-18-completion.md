# Phase 18 Completion: Demo Validation Shortcuts

## Scope

Phase 18 adds lightweight Demo-only validation shortcuts so core branches can be tested quickly during playtest.

## Implemented

- `F1`: show or hide the Demo debug panel.
- `F2`: add one extraction scroll fragment.
- `F3`: add five dungeon gold.
- `F4`: open the shared upgrade choice overlay.
- `F5`: teleport to the perfect extract point.
- `F6`: clear the current room and open its portals.
- `F7`: force normal extract.
- `F8`: force perfect extract.
- `F9`: force player death.

## Rules

- Debug shortcuts only run in Demo raids.
- Non-Demo raid input behavior is unchanged.
- Browser default F-key behavior is prevented while the game is focused, so validation shortcuts work reliably.
- The debug panel is informational and does not pause the raid by itself.

## Verification

`tools/smoke.js` covers:

- Debug panel toggle.
- Scroll fragment and gold injection.
- Upgrade choice opening.
- Extract teleport.
- Current-room clear.
- Forced normal extract.
- Forced perfect extract.
- Forced Demo death into failed settlement.
