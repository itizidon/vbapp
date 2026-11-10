// Shared descriptions for indoor and beach volleyball.
const passing = 'How consistently the player controls serve reception and directs the first touch toward a teammate for a playable next contact.';
const setting = 'How consistently the player delivers an accurate, controlled set that gives a teammate a useful attacking opportunity.';
const attack = 'How effectively the player chooses and executes hits, shots, and placements to challenge the opposing defense.';
const serving = 'How consistently the player serves accurately and uses placement, pace, or spin to pressure the opponent.';
export const beachSkillDescriptions: Record<string, string> = {
 passing,
 bump: passing,
 setting,
 set: setting,
 attack,
 attacking: attack,
 spike: attack,
 defense: 'How effectively the player reads attacks, positions themselves, and uses digs or blocks to keep the ball in play.',
 serving,
 serve: serving,
};
