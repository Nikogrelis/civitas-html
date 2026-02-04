import { dirToBit } from "../grid/neighbors8.js";

function manhattan(a, b, c, d) {
  return Math.abs(a - c) + Math.abs(b - d);
}

export function repelCost({ grid, x, y, dirI, typeCfg }) {
  const minSpacing = typeCfg.minSpacingParallelCells ?? 2;
  const scanR = Math.max(1, minSpacing);
  let penalty = 0;

  const bit = dirToBit(dirI);
  const oppBit = dirToBit((dirI + 4) % 8);

  for (let oy = -scanR; oy <= scanR; oy++) {
    for (let ox = -scanR; ox <= scanR; ox++) {
      if (ox === 0 && oy === 0) continue;
      const nx = x + ox;
      const ny = y + oy;
      if (!grid.inBounds(nx, ny)) continue;
      if (!grid.isRoad(nx, ny)) continue;
      const d = manhattan(x, y, nx, ny);
      const closeness = Math.max(0, scanR + 1 - d);
      penalty += closeness * 0.25;

      const mask = grid.getDirMask(nx, ny);
      const parallelish = (mask & bit) !== 0;
      const oppositeish = (mask & oppBit) !== 0;
      if (parallelish || oppositeish) {
        if (d < minSpacing) penalty += 20;
        else penalty += 2.5;
      }
    }
  }
  return penalty;
}

export function baseCellCost({ grid, x, y }) {
  if (!grid.inBounds(x, y)) return Infinity;
  if (grid.isObstacle(x, y)) return Infinity;
  return 1;
}
