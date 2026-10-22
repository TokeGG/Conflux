// The shape of the endless run in floors: a floor is eight rooms, the last one has the stairs down, and the depth (which opens the
// styles by `minDepth`) rises by one with each floor. Bosses keep their own rhythm, every fifth room.

/** Rooms in a floor. */
export const ROOMS_PER_FLOOR = 8;

/** The depth of room `index` (counted from 0): 1 on the first floor. */
export const depthAt = (index: number): number => 1 + Math.floor(index / ROOMS_PER_FLOOR);

/** The place of room `index` on its floor, 1 to ROOMS_PER_FLOOR. */
export const floorRoomAt = (index: number): number => (index % ROOMS_PER_FLOOR) + 1;

/** True for the last room of a floor: its gates lead down the stairs. */
export const hasStairs = (index: number): boolean => index % ROOMS_PER_FLOOR === ROOMS_PER_FLOOR - 1;

/** Every fifth room closes with a boss in the arena. */
export const isBossRoom = (index: number): boolean => index % 5 === 4;

/** Every third room from the third is an elite room. */
export const isEliteRoom = (index: number): boolean => index % 3 === 2;

/**
 * The quiet room before the stairs: the room second from last on a floor, or the one before it when a boss stands there, so every
 * floor has a place to spend souls before going down. All its gates lead to a quiet room, one of each kind.
 */
export const isLandingRoom = (index: number): boolean => {
  const at = index % ROOMS_PER_FLOOR;
  return (at === ROOMS_PER_FLOOR - 2 && !isBossRoom(index)) || (at === ROOMS_PER_FLOOR - 3 && isBossRoom(index + 1));
};
