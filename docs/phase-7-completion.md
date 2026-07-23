# Phase 7 Completion: Perfect Extract Challenge

## Scope

Phase 7 adds a Demo-only perfect extract route. The existing scroll route remains the safer normal extract path, while the map extract vent now creates a high-pressure holdout challenge.

## Rules

- Demo players can still press `X` for `normal_extract` after collecting enough scroll fragments.
- Standing inside a green extract vent starts the perfect extract challenge.
- The perfect extract hold timer is 30 seconds.
- Leaving the extract vent cancels the challenge and resets its progress.
- Pressure enemies are spawned during the holdout.
- Completing the holdout finishes the raid with `perfect_extract`.

## Reward

- Perfect extract applies `G.DemoConfig.perfectExtractRewardMultiplier`.
- The current value is `1.50x`.
- This multiplier stacks with curse reward multipliers.
- Result data keeps `baseLootValue`, `curseRewardMultiplier`, `perfectRewardMultiplier`, and final `rewardMultiplier`.

## Files

- `js/data.js`: perfect extract timing and reward config.
- `js/raid.js`: Demo perfect extract state machine, pressure spawns, result multiplier.
- `js/ui.js`: settlement display for the perfect extract multiplier.
- `js/i18n.js`: prompts and toasts.
- `tools/smoke.js`: challenge start/cancel/success and reward coverage.

## Follow-up Candidates

- Tune spawn pacing after hands-on testing.
- Add a visible extract-zone marker for "perfect route" versus scroll route.
- Add audio or screen effects while the holdout is active.
