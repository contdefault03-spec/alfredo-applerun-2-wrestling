// ─────────────────────────────────────────────────────────────────────────────
// ARENA SETTINGS – geometry shared by physics (server + client) and rendering.
// Origin = centre of the ring at floor level. +Z points toward the entrance.
// ─────────────────────────────────────────────────────────────────────────────
export const ARENA = {
  gravity: -18,

  ring: {
    height: 1.2,          // canvas surface height above the arena floor
    ropeLine: 3.2,        // |x| or |z| of the ropes (fighting area is inside this)
    apronHalf: 3.7,       // half-size of the ring platform (apron edge)
    postInset: 3.32,      // turnbuckle posts at (±postInset, ±postInset)
    postHeight: 1.45,     // post height above canvas
    ropeHeights: [0.42, 0.82, 1.22], // above canvas
    ropeStiffness: 55,    // spring pushing fighters back inside
    reboundSpeed: 3.6,    // faster than this into the ropes = rebound
    overTopSpeed: 7.2,    // airborne & faster than this = flies over the top rope
    cornerZone: 1.1,      // distance from a post counted as "in the corner"
  },

  barricade: { halfX: 8.6, halfZ: 7.6, height: 1.1, gapHalf: 1.7 }, // gap on +Z side
  entrance: { halfX: 1.7, zEnd: 15.5, halfRamp: 9 }, // walkway from barricade gap to the tunnel; halfRamp = reachable ramp/stage apron width (where the cars park)
  desk: { x: 0, z: -6.7, halfX: 1.8, halfZ: 0.45, height: 0.8 },  // commentary desk

  cage: { half: 6.4, height: 6.2, climbMax: 4.2, doorHalf: 1.0 }, // Hell-in-a-Cell; door on the +Z wall

  stands: { innerX: 10.2, innerZ: 9.4, rows: 11, rowDepth: 0.95, rowRise: 0.48 },

  // tag-team corners (team index -> corner)
  tagCorners: [[-1, -1], [1, 1]],
  spawnsRing: [[-2.2, -2.2], [2.2, 2.2], [-2.2, 2.2], [2.2, -2.2], [0, -2.5], [0, 2.5], [-2.5, 0], [2.5, 0]],
};
