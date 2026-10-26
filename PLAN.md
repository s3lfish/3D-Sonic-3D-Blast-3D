# Blast Grid: build plan (v2, revised after independent review 2026-10-25)

Goal: a browser-playable, true-3D prototype of an isometric tile platformer, built so real
level layouts can be dropped in later as data. Personal project. Phone first, desktop second.

## Constraints
- One self-contained `index.html`, publishable as an artifact. Three.js r128 global build
  from cdnjs. No build step.
- r128 gotchas: core build only (no BufferGeometryUtils, no OrbitControls); no THREE.Geometry
  (removed r125); no CapsuleGeometry (r139+). Build meshes by hand-filling BufferGeometry
  position/normal/color arrays.
- Original placeholder art and names only. Layouts come from data.

## File layout (inside index.html)
- `<script type="application/json" id="level">` level data.
- `<script id="sim">` pure simulation: no DOM, no THREE, deterministic. `const Sim = (()=>{...})()`.
- `<script id="game">` render, input, HUD. Reads sim state, interpolates between sim steps.
- `window.__game` debug hook. On-screen error panel for WebGL failure or level load errors.

## Level format
Units: 1 tile = 1 m. Heights authored in height units of 0.25 m.
Axes: x east (columns), z south (rows), y up. Tile (i,j) spans [i,i+1] x [j,j+1].
Three layers: collision (F floor, P pit, H hazard), visual (material id), entity list
`{type, x, z, y?, props?}` in metres.
Canonical form (what the sim uses): per-tile corner heights [nw, ne, se, sw] in metres.
Loader `importLevel(raw)` accepts:
- `format: "grid"` shorthand for hand authoring: height rows (base-36 char per tile),
  optional ramp rows (n/e/s/w: high side copies the neighbour's height), type rows,
  entity list with helpers (`ringLine`). The adapter converts to corner heights.
- `format: "tiles"` full per-tile records (for future imported data).
Every level has `version: 1`. Validation: equal row lengths, known chars, exactly one
start, start not on a pit, entities in bounds. Errors listed on screen.

## Player physics (custom)
- Fixed 60 Hz step, frame dt clamped to 250 ms, at most 5 steps per frame.
- Player = circle r 0.3 m in xz + feet y.
- Horizontal: substep so each substep moves <= r/2. Walls: any tile whose surface at the
  point nearest the player is higher than feet + 0.3 m. Circle-vs-tile-AABB push-out,
  then remove the velocity component into the wall (natural sliding, no per-axis snag).
  Out of bounds is solid. Pits are never walls.
- Floor = bilinear corner height at the player's centre. Grounded: snap up to +0.3 m,
  snap down to -0.3 m, otherwise go airborne (coyote time 0.1 s). Slope gravity along the
  bilinear gradient. Kill plane y < -6 m respawns.
- Speeds (m/s): run top 8, roll/dash up to 22, hard cap 25. Jump v 7.5, gravity 22
  (peak about 1.28 m: 1 m ledges reachable, 1.5 m not). Variable jump on release.
- Spin dash: hold dash while near stationary to charge, release to launch.

## Camera and view
- OrthographicCamera, true isometric pitch (35.26 deg), yaw 45 deg, Q/E rotate in 90 deg steps.
- Frustum scales with aspect: portrait shows at least 8 m across.
- Player silhouette pass (depthTest off) so blocks never hide the player.
- Blob shadow at floor height under the player (depth cue for jumps).

## Input
- Screen-relative: stick up = away from camera on the ground plane. Input basis frozen while
  the stick is held so a camera turn does not swerve the player.
- Keyboard: WASD/arrows, Space/J jump, Shift/K dash, Q/E camera, R restart, wheel zoom.
- Touch: floating left-half joystick (spawns under the thumb), jump and dash buttons on the
  right, Pointer Events by pointerId, touch-action none, safe-area insets, no zoom.
- Gamepad: left stick, A jump, X dash, LB/RB camera.

## Performance budget
- DPR capped at 1.75, no shadow maps, vertex colours, merged level mesh, no per-frame
  allocations in hot paths.

## Milestones
1. (this session) Loader + validation, level mesh, iso camera, keyboard/touch/gamepad, run,
   jump, spin dash, rings, blob shadow, silhouette, HUD, original test level.
2. Springs, spikes/hazards with invulnerability frames, ring scatter on hit.
3. Enemies, followers, goal, win/lose.
4. Polish: particles, audio, optional chase cam.

## Testing
- Node: extract the sim and level tags from index.html, run in `vm`. Cases: loader rejects
  bad levels; floor on ramps; 0.25 m step walkable, 0.5 m blocked; walk off ledge falls;
  jump onto 1 m block, not 1.5 m; full-speed dash into 1-tile wall does not tunnel; ramp
  side entry blocked; diagonal into convex corner keeps moving; pit respawn; ring pickup.
- Headless Chromium (available, WebGL via SwiftShader confirmed): load page with the
  three.js request served locally, no console errors after 120 frames, non-blank canvas,
  screenshot at phone and desktop sizes.
