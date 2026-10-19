// The closed list of event types the simulation may emit. The client maps each one to animation, effects and sound.
export const EVENT_TYPES = ['cast', 'hit', 'status_applied', 'reaction', 'guard_broken', 'telegraph', 'enemy_died', 'room_cleared', 'reward_offered', 'swap', 'dodge', 'shield_pop'] as const;
export type SimEventType = (typeof EVENT_TYPES)[number];
