// ─────────────────────────────────────────────────────────────────────────────
// ITEMS / RINGSIDE PROPS. Add a new prop by adding an entry here and (optionally)
// a mesh builder in client/src/render/ItemMeshes.js (falls back to a crate).
//   swingDamage  – damage when used as a melee weapon
//   throwDamage  – damage when it hits someone while flying
//   twoHanded    – carried with both hands (slower swing, overhead smash)
//   breakable    – `hp` hits before it breaks (table breaks when bodies land on it)
// ─────────────────────────────────────────────────────────────────────────────
export const ITEMS = {
  chair:       { id: 'chair', name: 'Steel Chair', radius: 0.35, mass: 6, swingDamage: 115, throwDamage: 80, twoHanded: true, sound: 'metal', restitution: 0.3, friction: 5, hp: 12, weight: 3 },
  kendo_stick: { id: 'kendo_stick', name: 'Kendo Stick', radius: 0.4, mass: 1, swingDamage: 72, throwDamage: 35, twoHanded: false, sound: 'wood', restitution: 0.4, friction: 4, hp: 10, fast: true, weight: 1 },
  trash_can:   { id: 'trash_can', name: 'Trash Can', radius: 0.3, mass: 5, swingDamage: 100, throwDamage: 90, twoHanded: true, sound: 'metal', restitution: 0.35, friction: 3, hp: 12, weight: 2 },
  table:       { id: 'table', name: 'Table', radius: 0.9, mass: 18, swingDamage: 110, throwDamage: 110, twoHanded: true, sound: 'wood', restitution: 0.1, friction: 8, hp: 1, breakable: true, breakDamage: 150, weight: 5 },
  ring_bell:   { id: 'ring_bell', name: 'Ring Bell', radius: 0.2, mass: 3, swingDamage: 105, throwDamage: 75, twoHanded: false, sound: 'bell', restitution: 0.3, friction: 5, hp: 20, weight: 2 },
  cone:        { id: 'cone', name: 'Traffic Cone', radius: 0.25, mass: 0.8, swingDamage: 30, throwDamage: 20, twoHanded: false, sound: 'plastic', restitution: 0.5, friction: 3, hp: 99, weight: 0.5 },
};
export const ITEM_IDS = Object.keys(ITEMS);
