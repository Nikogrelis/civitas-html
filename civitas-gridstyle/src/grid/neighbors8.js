export const DIRS_8 = [
  { name: "N", dx: 0, dy: -1, cost: 1, i: 0 },
  { name: "NE", dx: 1, dy: -1, cost: Math.SQRT2, i: 1 },
  { name: "E", dx: 1, dy: 0, cost: 1, i: 2 },
  { name: "SE", dx: 1, dy: 1, cost: Math.SQRT2, i: 3 },
  { name: "S", dx: 0, dy: 1, cost: 1, i: 4 },
  { name: "SW", dx: -1, dy: 1, cost: Math.SQRT2, i: 5 },
  { name: "W", dx: -1, dy: 0, cost: 1, i: 6 },
  { name: "NW", dx: -1, dy: -1, cost: Math.SQRT2, i: 7 },
];

export function dirIndexDelta(prevI, nextI) {
  const raw = (nextI - prevI + 8) % 8;
  return Math.min(raw, 8 - raw);
}

export function dirFromIndex(i) {
  return DIRS_8[(i + 8) % 8];
}

export function dirToBit(i) {
  return 1 << ((i + 8) % 8);
}

export function isOppositeDir(aI, bI) {
  return ((aI - bI + 8) % 8) === 4;
}
