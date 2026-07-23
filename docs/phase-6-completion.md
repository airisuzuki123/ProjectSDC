# Phase 6 Completion: Roguelite Curse Rewards

## Scope

Phase 6 adds an in-raid roguelite choice layer to the Demo mode. Players can accept curses during a run to increase final salvage rewards while taking an immediate gameplay risk.

## Trigger Rules

- Demo raids can trigger up to 2 curse choices.
- The first choice triggers at 3 kills or 90 seconds in raid.
- The second choice triggers at 8 kills or 180 seconds in raid.
- The raid is paused while the three-choice overlay is open.

## Curses

- Greedy Hand: search speed +30%, monster spawn interval -15%, reward +15%.
- Blood Tax Pact: scroll fragment drops +20%, healing effect -20%, reward +25%.
- Burden March: backpack capacity +2, movement speed -8%, reward +20%.
- Frenzy Guide: high-value drops +20%, monster level interval -10 seconds, reward +35%.
- Glass Edge: player damage +20%, incoming damage +15%, reward +20%.
- Elite Offering: elite drops +30%, elite appearance chance +30%, reward +30%.

## Implementation Notes

- `Raid.dungeon.rewardMultiplier` starts at `1.0` and stacks selected curse bonuses multiplicatively.
- Successful Demo result `lootValue` is multiplied by `rewardMultiplier`.
- Results retain `baseLootValue` and `baseItems` so the settlement screen can show the base salvage alongside the final reward.
- Curse modifiers are recomputed from `selectedCurses` after each selection and applied to search time, monster pressure, player damage, incoming damage, healing, movement speed, backpack capacity, and enemy drop weighting.
- Demo results remain display-only and do not mutate the formal stash or economy.

## Verification

`tools/smoke.js` covers:

- Curse choice triggering and pause behavior.
- Reward multiplier increase after selection.
- Settlement `lootValue` multiplier application.
- A concrete cost effect through Burden March's backpack and speed modifiers.
