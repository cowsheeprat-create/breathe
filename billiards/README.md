# Cue — physics billiards

Open `billiards/index.html` in a browser. No build, no dependencies.

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
`node billiards/test/physics.test.js` checks closed-form results (rolling distance, 5/7 rule, 90° rule, energy never increases, mirror law, pockets, racks).

Rules are intentionally light (turns, scratches, scoring); group assignment and snooker colour order are not enforced.
