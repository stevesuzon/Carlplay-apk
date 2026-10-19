# Pedestrian WebAR validation

The camera view uses the existing pedestrian route from `couteauGps.getState()`.
The optional “Activer le chemin AR” control loads Three.js 0.160.1 and the
unmodified 8th Wall distributed engine 1.0.0. No account or paid subscription
is configured. The binary's license and attribution are linked in the view.

## Coordinate alignment

The user must face the route's departure direction before pressing “Aligner au
sol”. A horizontal detected/estimated surface and normal visual tracking are
required, as is a recent GPS fix with reported accuracy no worse than 20 m.
The nearest route segment must be within 25 m. This manual alignment places
the nearest route point under the camera; it does not establish an exact
geographic/sidewalk position. GPS and route mapping errors remain possible.

A maximum of 60 m of the actual route is drawn as world-space geometry. It is
not parented to the camera, and it is not repositioned by compass updates.
Recalibration is required after 35 m of visual displacement, a route change,
screen rotation, or tracking loss. The surface is treated as locally flat;
the user must recalibrate at changes in slope. No obstacle, pavement-edge or
safe-crossing detection is implemented.

## Automated checks

- `node tests/walk-ar-math.test.cjs`: coordinate conventions and route clipping.
- `node tests/walk-ar.browser.cjs`: mocked camera-pipeline integration, geometry
  invariance under camera motion, tracking-loss removal and teardown; separate
  real-engine SLAM/WASM initialization. The mock does not validate physical SLAM.
- GitHub workflow `test-walk-ar.yml` runs these checks and saves a layout image.

## Required device acceptance test (not yet performed)

On an iPhone, open Couteau Suisse → GPS → short pedestrian route. Enable the AR
path, grant camera/motion/location access, face the departure direction and
align over a flat textured ground. Rotate and translate the phone: the route
must remain in world space. Cover the camera to trigger tracking loss, then
realign. Verify portrait/landscape, background/foreground, return to the map,
short-press photo, held video with microphone, and optional client effects.
Compare the overlay with a known pedestrian crossing and a right-angle route.
Do not treat browser tests as proof of geographic accuracy on a real street.

References: https://8thwall.org/docs/engine/overview,
https://8thwall.org/docs/api/engine/xrcontroller/configure,
https://8thwall.org/docs/api/engine/xrcontroller/hittest,
https://8thwall.org/docs/troubleshooting/browser-requirements.
