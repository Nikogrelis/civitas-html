import { DIRS_8 } from "../grid/neighbors8.js";

function dirIndexFromDelta(dx, dy) {
  for (const d of DIRS_8) {
    if (d.dx === dx && d.dy === dy) return d.i;
  }
  return null;
}

function isAllowedDelta(dx, dy) {
  for (const d of DIRS_8) {
    if (d.dx === dx && d.dy === dy) return true;
  }
  return false;
}

function pathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    len += dx === 0 || dy === 0 ? 1 : Math.SQRT2;
  }
  return len;
}

export function computeMetrics({ grid, graph, cfg = null }) {
  let non45Segments = 0;
  let mainDetourSum = 0;
  let mainCount = 0;

  // SECONDARY quality metrics
  let secondarySeg = 0;
  let secondaryTurns = 0;
  let secondaryDiagSeg = 0;
  let secondaryRunSum = 0;
  let secondaryRunCount = 0;

  // Connector staircase
  let connectorCount = 0;
  let connectorStaircaseCount = 0;
  let connectorTurnsSum = 0;

  // Для параллельных нарушений: карта клетка -> mask направлений (только SECONDARY)
  const secMask = new Uint16Array(grid.w * grid.h);

  for (const r of graph.roads) {
    const p = r.path;
    let prevDir = null;
    let runLen = 0;
    let turnsInThisRoad = 0;

    for (let i = 1; i < p.length; i++) {
      const dx = p[i][0] - p[i - 1][0];
      const dy = p[i][1] - p[i - 1][1];
      if (!isAllowedDelta(dx, dy)) non45Segments++;

      const dirI = dirIndexFromDelta(dx, dy);
      if (r.type === "SECONDARY" && dirI !== null) {
        secondarySeg++;
        if (dx !== 0 && dy !== 0) secondaryDiagSeg++;
        const idx = p[i][1] * grid.w + p[i][0];
        secMask[idx] |= 1 << dirI;

        if (prevDir === null) {
          prevDir = dirI;
          runLen = 1;
        } else if (dirI === prevDir) {
          runLen++;
        } else {
          secondaryTurns++;
          turnsInThisRoad++;
          secondaryRunSum += runLen;
          secondaryRunCount++;
          prevDir = dirI;
          runLen = 1;
        }
      } else if ((r.tag === "SNAP_CONNECTOR" || r.tag === "CONNECTOR") && dirI !== null) {
        if (prevDir === null) {
          prevDir = dirI;
        } else if (dirI !== prevDir) {
          turnsInThisRoad++;
          prevDir = dirI;
        }
      }
    }

    if (r.type === "SECONDARY" && prevDir !== null) {
      secondaryRunSum += runLen;
      secondaryRunCount++;
    }

    if (r.tag === "SNAP_CONNECTOR" || r.tag === "CONNECTOR") {
      connectorCount++;
      connectorTurnsSum += turnsInThisRoad;
      if (turnsInThisRoad > 2) connectorStaircaseCount++;
    }
    if (r.type === "MAIN" && p.length >= 2) {
      const L = pathLength(p);
      const ex = p[p.length - 1][0] - p[0][0];
      const ey = p[p.length - 1][1] - p[0][1];
      const D = Math.hypot(ex, ey) || 1;
      mainDetourSum += L / D;
      mainCount++;
    }
  }

  let intersectionsCount = 0;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (grid.getRoadCount(x, y) > 1) intersectionsCount++;
    }
  }

  // Parallel violations (SECONDARY): ищем близкие параллели на расстоянии < spacing
  const spacing = Math.max(2, (cfg?.roadTypes?.SECONDARY?.minSpacingParallelCells ?? 5) | 0);
  const r = Math.max(1, (spacing - 1) | 0);
  let parallelViolations = 0;

  function isCollinearOffset(dirI, dx, dy) {
    if (dx === 0 && dy === 0) return true;
    if ((dirI & 1) === 0) {
      // cardinal
      if (dirI === 0 || dirI === 4) return dx === 0;
      if (dirI === 2 || dirI === 6) return dy === 0;
      return false;
    }
    // diagonal
    if (Math.abs(dx) !== Math.abs(dy)) return false;
    if (dirI === 1) return dx > 0 && dy < 0;
    if (dirI === 3) return dx > 0 && dy > 0;
    if (dirI === 5) return dx < 0 && dy > 0;
    if (dirI === 7) return dx < 0 && dy < 0;
    return false;
  }

  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const i1 = y * grid.w + x;
      const m1 = secMask[i1];
      if (!m1) continue;
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (!grid.inBounds(nx, ny)) continue;
          const i2 = ny * grid.w + nx;
          if (i2 <= i1) continue;
          const m2 = secMask[i2];
          if (!m2) continue;

          for (let dirI = 0; dirI < 8; dirI++) {
            const bit = 1 << dirI;
            if ((m1 & bit) === 0) continue;
            const opp = 1 << ((dirI + 4) % 8);
            if ((m2 & bit) === 0 && (m2 & opp) === 0) continue;
            // не считаем коллинеарные соседства (скорее всего это продолжение той же улицы)
            if (isCollinearOffset(dirI, ox, oy)) continue;
            parallelViolations++;
            break;
          }
        }
      }
    }
  }

  const turnsPer100CellsSecondary = secondarySeg ? (secondaryTurns / secondarySeg) * 100 : 0;
  const avgRunLenSecondary = secondaryRunCount ? secondaryRunSum / secondaryRunCount : 0;
  const diagonalStepsSecondaryPct = secondarySeg ? (secondaryDiagSeg / secondarySeg) * 100 : 0;
  const connectorStaircaseRate = connectorCount ? connectorStaircaseCount / connectorCount : 0;
  const avgConnectorTurns = connectorCount ? connectorTurnsSum / connectorCount : 0;

  return {
    non45Segments,
    intersectionsCount,
    avgDetour: mainCount ? mainDetourSum / mainCount : 0,
    roadsCount: graph.roads.length,
    nodesCount: graph.nodes.size,

    turnsPer100CellsSecondary,
    avgRunLenSecondary,
    diagonalStepsSecondaryPct,
    parallelViolations,
    connectorStaircaseRate,
    avgConnectorTurns,
  };
}
