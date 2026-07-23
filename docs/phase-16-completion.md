# Phase 16 Completion: Room Wave Pressure Tuning

## Scope

Phase 16 strengthens Demo room combat pressure and makes room revive spawning safer.

## Implemented

- Room wave count now scales from configurable Demo values.
- Combat room wave count increases with main-path depth.
- Combat room wave size increases with main-path depth.
- Extract rooms now use dedicated wave count and wave size values.
- Reward rooms now use dedicated wave count and wave size values.
- Cleared-room revive spawning is now treated as an active room wave.
- Revive waves must be cleared before the next revive timer can create another wave.
- Revive waves respect a per-room alive monster cap.

## DemoConfig Additions

- `roomReviveMinCount`: minimum monsters in a revive wave.
- `roomReviveBatchRatio`: revive wave size as a ratio of the room's normal wave size.
- `roomReviveMaxAlive`: alive cap for revive spawning in one room.
- `roomWaveSizePerDepth`: added combat wave size per path depth.
- `roomWaveSizeDepthCap`: maximum depth bonus for combat wave size.
- `roomWaveCountBase`: base combat wave count.
- `roomWaveCountPerDepth`: added combat wave count per path depth.
- `roomWaveCountMax`: maximum combat wave count.
- `roomRewardWaveCount`: reward room wave count.
- `roomRewardWaveSize`: reward room wave size.
- `roomExtractWaveCount`: extract room wave count.
- `roomExtractWaveSize`: extract room wave size.

## Verification

`tools/smoke.js` covers:

- Combat wave size scales by path depth.
- Combat wave count scales by path depth.
- Extract room wave settings use DemoConfig values.
- Cleared rooms spawn revive monsters after the revive timer.
- Revive monsters become an active wave.
- A revive wave does not stack more monsters before it is cleared.
- Revive waves can be cleared and return the room to cleared state.
