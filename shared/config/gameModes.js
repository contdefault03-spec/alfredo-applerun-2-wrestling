// ─────────────────────────────────────────────────────────────────────────────
// GAME MODES. MatchSystem reads these rules; the lobby shows them.
// ─────────────────────────────────────────────────────────────────────────────
export const GAME_MODES = {
  normal: {
    id: 'normal', name: 'Normal Match', short: 'NORMAL',
    description: 'Standard singles (or team) match. Win by pinfall or knockout.',
    minFighters: 2, maxFighters: 4, teams: 'free',     // free = lobby assigns teams (1v1, 2v1, 2v2 …)
    winBy: ['pin', 'ko'], pinsInRingOnly: true, timeLimit: 300,
    items: 'ringside', itemRespawn: 0, cage: false, tag: false,
  },
  ffa: {
    id: 'ffa', name: 'Free-For-All', short: 'FFA',
    description: 'Everyone for themselves. Pinned or knocked-out wrestlers are eliminated. Last one standing wins.',
    minFighters: 3, maxFighters: 6, teams: 'solo',
    winBy: ['pin', 'ko'], pinsInRingOnly: true, timeLimit: 420, eliminations: true,
    items: 'ringside', itemRespawn: 0, cage: false, tag: false,
  },
  tag: {
    id: 'tag', name: 'Tag Team', short: 'TAG',
    description: 'Two teams of two. Only the legal wrestler fights — tag your partner at your corner.',
    minFighters: 4, maxFighters: 4, teams: 'two',
    winBy: ['pin', 'ko'], pinsInRingOnly: true, timeLimit: 480,
    items: 'ringside', itemRespawn: 0, cage: false, tag: true,
  },
  items: {
    id: 'items', name: 'Items Match', short: 'ITEMS',
    description: 'No disqualification. Weapons everywhere, and the crowd keeps throwing more in.',
    minFighters: 2, maxFighters: 6, teams: 'free',
    winBy: ['pin', 'ko'], pinsInRingOnly: false, timeLimit: 360,
    items: 'lots', itemRespawn: 12, cage: false, tag: false,
  },
  cell: {
    id: 'cell', name: 'Hell in a Cell', short: 'CELL',
    description: 'A steel cell surrounds the ring. Climb the walls, ram rivals into the steel. Falls count anywhere.',
    minFighters: 2, maxFighters: 4, teams: 'free',
    winBy: ['pin', 'ko'], pinsInRingOnly: false, timeLimit: 420,
    items: 'cell', itemRespawn: 0, cage: true, tag: false,
  },
};
export const MODE_IDS = Object.keys(GAME_MODES);
