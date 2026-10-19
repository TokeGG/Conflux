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
};

export const MARK_ICONS: Record<MarkId, Icon> = {
  blind: { glyph: '🕶', color: '#9a9a9a' },
  rooted: { glyph: '🌿', color: '#6fbf4a' },
  slowed: { glyph: '🐌', color: '#8ab4d8' },
  brittle: { glyph: '💠', color: '#c07a40' },
  stunned: { glyph: '💫', color: '#ffe066' },
  airborne: { glyph: '☁', color: '#dff4ff' },
};
