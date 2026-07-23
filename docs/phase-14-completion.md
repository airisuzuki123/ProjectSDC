# Phase 14 Completion: Shared Skill and Curse Choices

## Scope

Phase 14 expands the Demo three-choice system from curse-only choices into a shared upgrade pool with both curses and skills.

## Implemented

- Demo upgrade choices now draw from curses and projectile skills.
- Every upgrade choice set includes at least one curse when an unselected curse is available.
- Skills are recorded in `dungeon.selectedSkills`.
- Curses continue to use `dungeon.selectedCurses` and reward multiplier behavior.
- The choice UI title is now upgrade-focused instead of curse-only.
- Skill cards show a skill label instead of a reward multiplier.

## First Skill Set

- `sharp_rounds`: projectile damage +15%.
- `twin_shot`: one extra projectile.
- `rapid_focus`: fire rate +20%.
- `longshot_charm`: projectile range +20%.

## Preserved

- Existing curse choices still increase `dungeon.rewardMultiplier`.
- Existing curse effects still apply through the modifier system.
- Existing `chooseCurse` and `curseChoices` names are retained for compatibility with the current UI and tests.

## Verification

`tools/smoke.js` covers:

- Upgrade choices include at least one curse.
- The shared pool can surface skill choices.
- Selecting a skill records it without changing reward multiplier.
- `twin_shot` increases player projectile count.
- The UI renders mixed curse and skill choices.
