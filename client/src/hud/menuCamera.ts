// The camera behind the main menu: a slow orbit round the middle of a dark room, so the menu opens on the game's own look.
export function menuCamera(t: number, size: [number, number]): { pos: { x: number; y: number; z: number }; look: { x: number; y: number; z: number } } {
  const radius = Math.max(size[0], size[1]) * 0.33;
  const a = t * 0.07;
  return { pos: { x: Math.cos(a) * radius, y: 4.2, z: Math.sin(a) * radius }, look: { x: 0, y: 1.4, z: 0 } };
}
