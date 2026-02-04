import { floodFillBlocksByMask } from "../grid/raster.js";
import { DIRS_8 } from "../grid/neighbors8.js";
import { ROAD_TYPE_MASK } from "./roadTypes.js";

function key(x, y) {
  return `${x},${y}`;
}

export function buildBlocksAndConnectors({ grid, graph, cfg, rng, boundaryMask = null }) {
  let mask = boundaryMask;
  if (!mask) {
    mask = new Uint8Array(grid.w * grid.h);
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (grid.isRoad(x, y)) mask[y * grid.w + x] = 1;
      }
    }
  }

  const blocks = floodFillBlocksByMask({ grid, boundaryMask: mask });
  const connectors = [];

  const roadCells = [];
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (grid.isRoad(x, y)) roadCells.push([x, y]);
    }
  }
  const roadSet = new Set(roadCells.map((c) => key(c[0], c[1])));

  function bfsToRoad(start) {
    const q = [start];
    const prev = new Map();
    prev.set(key(start[0], start[1]), null);
    let qi = 0;
    while (qi < q.length) {
      const [x, y] = q[qi++];
      for (let k = 0; k < 4; k++) {
        const d = DIRS_8[k * 2];
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (!grid.inBounds(nx, ny)) continue;
        if (grid.isObstacle(nx, ny)) continue;
        const nk = key(nx, ny);
        if (prev.has(nk)) continue;
        prev.set(nk, [x, y]);
        if (roadSet.has(nk)) {
          const path = [];
          let cur = [nx, ny];
          while (cur) {
            path.push(cur);
            const pk = key(cur[0], cur[1]);
            cur = prev.get(pk);
          }
          path.reverse();
          return path;
        }
        q.push([nx, ny]);
      }
      if (q.length > 30000) break;
    }
    return null;
  }

  for (const b of blocks) {
    if (b.hasAccess) continue;
    const seedCell = rng.pick(b.cells);
    const pathToRoad = bfsToRoad(seedCell);
    if (!pathToRoad || pathToRoad.length < 2) continue;

    b.hasAccess = true;
    connectors.push(pathToRoad);
  }

  for (const p of connectors) {
    // Не затираем существующие дороги: добавляем только новые клетки.
    const cleaned = [];
    for (let i = 0; i < p.length; i++) {
      const [x, y] = p[i];
      cleaned.push([x, y]);
      if (!grid.isRoad(x, y)) {
        const prev = p[i - 1];
        const dirI = prev ? DIRS_8.find((d) => d.dx === x - prev[0] && d.dy === y - prev[1])?.i ?? null : null;
        grid.markRoadCell(x, y, dirI, ROAD_TYPE_MASK.LOCAL | ROAD_TYPE_MASK.CONNECTOR);
      }
    }
    graph.addRoad({
      type: "LOCAL",
      widthCells: cfg.roadTypes.LOCAL.widthCells,
      path: cleaned,
      tag: "CONNECTOR",
    });
  }

  return blocks;
}
