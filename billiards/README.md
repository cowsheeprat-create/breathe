# Cue — physics billiards

Two pages, one physics engine. No build step.

- `closeup.html` — **3-D close-up**: one rail, one pocket and two balls, with the cue ball’s contact on the object ball shown in detail. Eight-plus scenarios (straight-in stun, cut, thin cut, follow, draw, cut with english/throw, rail-hugging pot, bank shot, cushion lab), slow motion down to 0.01×, ghost ball, trails, spin axes and exact readouts at the moment of contact (cut angle, throw, speeds, turn angle, cushion in/out angle vs the perfect mirror). Uses a vendored copy of three.js (`vendor/`, MIT).
- `index.html` — the full-table top-down game (8-ball, 9-ball, snooker, carom) with radiating bounce lines.

Games: 8-ball, 9-ball, snooker (22 balls), 3-cushion carom, practice.

## Physics (`physics.js`)
Rigid-body, 2 kHz fixed step, each ball has full 3-D spin.
- Cloth: analytic slide→roll (slip decays at 7/2·μg; a no-spin ball ends at 5/7 of its speed), rolling resistance, side-spin decay.
- Ball-ball: restitution 0.95, Coulomb friction at the contact (throw, spin transfer), speed-dependent μ, exact time-of-impact rewind.
- Cushions: nose contact above the ball centre (tilted normal), cushion + cloth friction solved as an impulse problem, speed-dependent restitution. Topspin, backspin and side spin change the rebound angle.
- Cue strike: tip offset → speed, spin and squirt.
- Pockets: point knuckles; potted when the centre crosses the mouth line.

Not modelled: massé/jump shots, miscues, cloth nap, table slope.

## Radiating lines
Press **R** (or the button). Rays leave the cue ball (or any ball you click) in all directions.
- **Ideal**: perfect mirror reflections off the cushion noses; stops at the first ball (ring = cue-ball position at contact) or pocket.
- **Physical**: each ray runs the real simulation with your current power and tip position, so spin and speed bend the bounces.

## Tests
`node billiards/test/physics.test.js` and `node billiards/test/scenarios.test.js` check closed-form results (rolling distance, 5/7 rule, 90° rule, energy never increases, mirror law, pockets, racks).

Rules are intentionally light (turns, scratches, scoring); group assignment and snooker colour order are not enforced.
