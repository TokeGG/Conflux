// How each status and reaction mark looks above an enemy's head.
import type { MarkId, StatusId } from '@conflux/shared';

export interface Icon {
  glyph: string;
  color: string;
}

export const STATUS_ICONS: Record<StatusId, Icon> = {
  burning: { glyph: '🔥', color: '#ff7a30' },
  soaked: { glyph: '💧', color: '#4aa8ff' },
  rocked: { glyph: '🪨', color: '#b08a5a' },
  gusted: { glyph: '🌀', color: '#b8f0e0' },
  shocked: { glyph: '⚡', color: '#ffe94a' },
  exposed: { glyph: '✨', color: '#fff4c2' },
  cursed: { glyph: '🌑', color: '#8a5cc8' },
  rent: { glyph: '🩸', color: '#c0c8d4' },
  poisoned: { glyph: '☠', color: '#7bd44a' },
  dilated: { glyph: '⏳', color: '#e08ad8' },
};

export const MARK_ICONS: Record<MarkId, Icon> = {
  blind: { glyph: '🕶', color: '#9a9a9a' },
  rooted: { glyph: '🌿', color: '#6fbf4a' },
  slowed: { glyph: '🐌', color: '#8ab4d8' },
  brittle: { glyph: '💠', color: '#c07a40' },
  stunned: { glyph: '💫', color: '#ffe066' },
  airborne: { glyph: '☁', color: '#dff4ff' },
  stasis: { glyph: '⏸', color: '#e08ad8' },
  petrified: { glyph: '🗿', color: '#9a8a78' },
  corroded: { glyph: '🔩', color: '#b8793c' },
  fatigue: { glyph: '🥀', color: '#a9b4c2' },
  overheat: { glyph: '♨', color: '#ff9a50' },
  hellfire: { glyph: '👹', color: '#e0302a' },
  plague: { glyph: '🦠', color: '#7bd44a' },
  leech: { glyph: '💉', color: '#8a5cc8' },
  haste: { glyph: '⏩', color: '#e08ad8' },
  swift: { glyph: '💨', color: '#fff4c2' },
};
