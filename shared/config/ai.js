// ─────────────────────────────────────────────────────────────────────────────
// AI DIFFICULTY. All AI decisions read these numbers.
// ─────────────────────────────────────────────────────────────────────────────
export const AI_DIFFICULTY = {
  easy: {
    name: 'Easy', reaction: 0.55, thinkInterval: 0.28, aggression: 0.35, blockChance: 0.12, dodgeChance: 0.08, parryChance: 0.0,
    comboChance: 0.3, grabChance: 0.18, specialChance: 0.35, itemChance: 0.25, pinChance: 0.45, mashRate: 3, reversalChance: 0.03,
    groundAttackChance: 0.35, turnbuckleChance: 0.02, tauntChance: 0.08, fleeHealth: 0.0, accuracy: 0.6,
  },
  normal: {
    name: 'Normal', reaction: 0.3, thinkInterval: 0.18, aggression: 0.6, blockChance: 0.38, dodgeChance: 0.22, parryChance: 0.05,
    comboChance: 0.6, grabChance: 0.25, specialChance: 0.75, itemChance: 0.45, pinChance: 0.75, mashRate: 6, reversalChance: 0.12,
    groundAttackChance: 0.55, turnbuckleChance: 0.08, tauntChance: 0.1, fleeHealth: 0.15, accuracy: 0.85,
  },
  hard: {
    name: 'Hard', reaction: 0.14, thinkInterval: 0.1, aggression: 0.8, blockChance: 0.6, dodgeChance: 0.4, parryChance: 0.18,
    comboChance: 0.9, grabChance: 0.3, specialChance: 1.0, itemChance: 0.55, pinChance: 0.95, mashRate: 9, reversalChance: 0.3,
    groundAttackChance: 0.7, turnbuckleChance: 0.15, tauntChance: 0.06, fleeHealth: 0.22, accuracy: 1.0,
  },
};
