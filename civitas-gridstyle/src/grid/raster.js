import { DIRS_8 } from "./neighbors8.js";

export function floodFillBlocks(grid) {
  // Backward-compatible: boundary = любые дороги
  const n = grid.w * grid.h;
  const boundaryMask = new Uint8Array(n);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (grid.isRoad(x, y)) boundaryMask[y * grid.w + x] = 1;
    }
  }
  return floodFillBlocksByMask({ grid, boundaryMask });
}

export function floodFillBlocksByMask({ grid, boundaryMask }) {
  const w = grid.w;
  const h = grid.h;
  const n = w * h;
  const label = new Int32Array(n);
  label.fill(-1);

  const blocks = [];
  let nextId = 1;

  const qx = new Int16Array(n);
  const qy = new Int16Array(n);

  const isBoundary = (x, y) => boundaryMask[y * w + x] !== 0;

  function pushBlock(startX, startY) {
    const id = nextId++;
    let qs = 0;
    let qe = 0;
    qx[qe] = startX;
    qy[qe] = startY;
    qe++;
    label[startY * w + startX] = id;

    const cells = [];
    let hasAccess = false;
    while (qs < qe) {
      const x = qx[qs];
      const y = qy[qs];
      qs++;
      cells.push([x, y]);

      // Доступ к дороге (любому типу) проверяем по grid.isRoad
      for (let k = 0; k < 8; k++) {
        const nx = x + DIRS_8[k].dx;
        const ny = y + DIRS_8[k].dy;
        if (!grid.inBounds(nx, ny)) continue;
        if (grid.isRoad(nx, ny)) hasAccess = true;
      }

      for (let k = 0; k < 4; k++) {
        const d = DIRS_8[k * 2];
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (!grid.inBounds(nx, ny)) continue;
        const ni = ny * w + nx;
        if (label[ni] !== -1) continue;
        if (grid.isObstacle(nx, ny) || isBoundary(nx, ny)) continue;
        label[ni] = id;
        qx[qe] = nx;
        qy[qe] = ny;
        qe++;
      }
    }

    blocks.push({ id, cells, hasAccess });
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (label[i] !== -1) continue;
      if (grid.isObstacle(x, y) || isBoundary(x, y)) continue;
      pushBlock(x, y);
    }
  }

  return blocks;
}
