# Phase 12 Completion: Automatic Resource Harvesting

## Scope

Phase 12 changes Demo resource-point interaction from key-driven looting to stationary automatic harvesting.

## Implemented

- Demo resource points no longer require `E`, Space, or the touch `SEARCH` button.
- Standing near an unsearched resource point starts harvesting automatically.
- Moving interrupts the harvesting process.
- The existing progress bar is reused while harvesting.
- Resource-point harvest duration is driven by `G.DemoConfig.resourceSearchTimes`.
- Higher-value resource types take longer to harvest.
- Unsearched resource points display a floating magnifying-glass marker.

## Current Harvest Times

- `crate`: 1.1 seconds.
- `locker`: 1.4 seconds.
- `medbox`: 1.6 seconds.
- `weaponrack`: 2.1 seconds.
- `safe`: 2.8 seconds.

## Non-Demo Behavior

Non-Demo raids still use the original key/touch interaction flow.

## Verification

`tools/smoke.js` covers:

- Stationary Demo auto-harvest without key input.
- Harvest duration using the Demo quality table.
- Movement interrupting Demo harvesting.
