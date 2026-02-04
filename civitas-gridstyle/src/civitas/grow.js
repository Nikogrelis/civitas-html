import { Grid } from "../grid/grid.js";
import { DIRS_8, dirIndexDelta } from "../grid/neighbors8.js";
import { Graph } from "../graph/graph.js";
import { generateObstacles } from "../fields/obstacles.js";
import { buildAttraction, goalBiasToPoint } from "../fields/attraction.js";
import { baseCellCost, repelCost } from "../fields/cost.js";
import { findSnapTarget } from "./snap.js";
import { wouldSelfCollide } from "./collisions.js";
import { canAttachNode } from "./rules.js";
import { antiZigZagReorder } from "./smooth.js";
import { buildBlocksAndConnectors } from "./blocks.js";
import { floodFillBlocksByMask } from "../grid/raster.js";
import { ROAD_TYPE_MASK, roadTypeToMask } from "./roadTypes.js";

class MinHeap {
  constructor() {
    this.a = [];
  }
  push(it) {
    const a = this.a;
    a.push(it);
    let i = a.length - 1;
    while (i > 0) {
      const p = ((i - 1) / 2) | 0;
      if (a[p].f <= a[i].f) break;
      const t = a[p];
      a[p] = a[i];
      a[i] = t;
      i = p;
    }
  }
  pop() {
    const a = this.a;
    if (!a.length) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        const t = a[m];
        a[m] = a[i];
        a[i] = t;
        i = m;
      }
    }
    return top;
  }
}

function key(x, y) {
  return `${x},${y}`;
}

function heuristic(x, y, gx, gy) {
  return Math.hypot(gx - x, gy - y);
}

function turnPenalty(prevDirI, nextDirI, typeCfg, cfg) {
  if (prevDirI === null || prevDirI === undefined) return 0;
  const d = dirIndexDelta(prevDirI, nextDirI);
  if (cfg.gridStyle?.forbidBacktrack && d === 4) return Infinity;
  if (!cfg.gridStyle?.allow135 && d === 3) return Infinity;
  if (d === 0) return 0;
  if (d === 1) return typeCfg.turnPenalty45 ?? 0.3;
  if (d === 2) return typeCfg.turnPenalty90 ?? 0.9;
  if (d === 3) return typeCfg.turnPenalty135 ?? 2.5;
  return Infinity;
}

function gateCandidates(w, h) {
  const pad = 3;
  const midX = (w / 2) | 0;
  const midY = (h / 2) | 0;
  return [
    { x: midX, y: pad },
    { x: w - pad - 1, y: midY },
    { x: midX, y: h - pad - 1 },
    { x: pad, y: midY },
    { x: w - pad - 1, y: pad },
    { x: w - pad - 1, y: h - pad - 1 },
    { x: pad, y: h - pad - 1 },
    { x: pad, y: pad },
  ];
}

function findNearestFree(grid, x, y, r = 6) {
  if (grid.inBounds(x, y) && !grid.isObstacle(x, y)) return { x, y };
  for (let rr = 1; rr <= r; rr++) {
    for (let oy = -rr; oy <= rr; oy++) {
      for (let ox = -rr; ox <= rr; ox++) {
        const nx = x + ox;
        const ny = y + oy;
        if (!grid.inBounds(nx, ny)) continue;
        if (!grid.isObstacle(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return { x, y };
}

function aStar8({ grid, start, goal, typeCfg, cfg }) {
  const open = new MinHeap();
  const gScore = new Map();
  const came = new Map();
  const startK = key(start.x, start.y);
  gScore.set(startK, 0);
  open.push({ x: start.x, y: start.y, f: heuristic(start.x, start.y, goal.x, goal.y), prevDirI: null });

  const maxExpand = grid.w * grid.h;
  let expanded = 0;

  while (true) {
    const cur = open.pop();
    if (!cur) return null;
    const ck = key(cur.x, cur.y);
    const curG = gScore.get(ck);
    if (curG === undefined) continue;
    if (cur.x === goal.x && cur.y === goal.y) {
      const path = [];
      let k = ck;
      while (k) {
        const [sx, sy] = k.split(",").map((v) => Number(v));
        path.push([sx, sy]);
        k = came.get(k) ?? null;
      }
      path.reverse();
      return path;
    }

    expanded++;
    if (expanded > maxExpand) return null;

    for (const d of DIRS_8) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (!grid.inBounds(nx, ny)) continue;
      if (grid.isObstacle(nx, ny)) continue;

      const tp = turnPenalty(cur.prevDirI, d.i, typeCfg, cfg);
      if (!Number.isFinite(tp)) continue;

      const rep = repelCost({ grid, x: nx, y: ny, dirI: d.i, typeCfg });
      const diag = d.dx !== 0 && d.dy !== 0;
      const diagBias = diag ? (typeCfg.diagonalBias ?? 0) : 0;
      const stepCost = d.cost * baseCellCost({ grid, x: nx, y: ny }) + tp + rep + diagBias;
      const nk = key(nx, ny);
      const ng = curG + stepCost;
      const old = gScore.get(nk);
      if (old === undefined || ng < old) {
        gScore.set(nk, ng);
        came.set(nk, ck);
        open.push({ x: nx, y: ny, f: ng + heuristic(nx, ny, goal.x, goal.y), prevDirI: d.i });
      }
    }
  }
}

function directionScore({ grid, x, y, prevDirI, dirI, typeCfg, cfg, goalVec }) {
  const d = DIRS_8[dirI];
  const nx = x + d.dx;
  const ny = y + d.dy;
  if (!grid.inBounds(nx, ny)) return { ok: false, score: Infinity };
  if (grid.isObstacle(nx, ny)) return { ok: false, score: Infinity };

  const tp = turnPenalty(prevDirI, dirI, typeCfg, cfg);
  if (!Number.isFinite(tp)) return { ok: false, score: Infinity };

  const rep = repelCost({ grid, x: nx, y: ny, dirI, typeCfg });
  const diag = d.dx !== 0 && d.dy !== 0;
  const base = d.cost + (diag ? (typeCfg.diagonalBias ?? 0) : 0);

  let goalBias = 0;
  if (goalVec) {
    const dot = d.dx * goalVec.dx + d.dy * goalVec.dy;
    goalBias = -dot * goalVec.strength;
  }

  const w = cfg.weights;
  const score = w.alphaCost * base + w.betaTurn * tp + w.gammaRepel * rep + w.deltaGoal * goalBias;
  return { ok: true, score };
}

function pickDirection(rng, scored) {
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best) return null;
  // Немного стохастики: иногда берём один из топ-3.
  const k = Math.min(3, scored.length);
  const pickI = rng.chance(0.20) ? rng.int(0, k - 1) : 0;
  return scored[pickI].dirI;
}

function resetRoadLayers(grid) {
  grid.clearRoadLayers();
}

function connectWithinRadius8({ grid, start, goal, radius, allowedDirIs = null }) {
  // Dijkstra по состояниям (x,y,prevDir) с жёстким приоритетом:
  // 1) минимум поворотов, 2) минимум длины, 3) затем лёгкая стоимость клеток.
  const r = Math.max(1, radius | 0);
  const minX = start.x - r;
  const maxX = start.x + r;
  const minY = start.y - r;
  const maxY = start.y + r;

  const dirs = allowedDirIs ? allowedDirIs.map((i) => DIRS_8[i]) : DIRS_8;

  const open = new MinHeap();
  const best = new Map();
  const came = new Map();

  const startState = `${start.x},${start.y},n`;
  best.set(startState, { turns: 0, len: 0, cost: 0 });
  came.set(startState, null);
  open.push({ x: start.x, y: start.y, prevDirI: null, turns: 0, len: 0, cost: 0, f: 0 });

  let bestGoal = null;
  let expand = 0;
  while (true) {
    const cur = open.pop();
    if (!cur) break;
    if (expand++ > 12000) break;

    if (cur.x === goal.x && cur.y === goal.y) {
      bestGoal = cur;
      break;
    }

    const curKey = `${cur.x},${cur.y},${cur.prevDirI ?? "n"}`;
    const curBest = best.get(curKey);
    if (!curBest) continue;
    if (curBest.turns !== cur.turns || curBest.len !== cur.len || curBest.cost !== cur.cost) continue;

    for (const d of dirs) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      if (!grid.inBounds(nx, ny)) continue;
      if (grid.isObstacle(nx, ny)) continue;
      if (grid.isRoad(nx, ny) && !(nx === goal.x && ny === goal.y)) continue;

      const turn = cur.prevDirI === null || cur.prevDirI === undefined ? 0 : d.i === cur.prevDirI ? 0 : 1;
      const nt = cur.turns + turn;
      const nl = cur.len + 1;
      const nc = cur.cost + baseCellCost({ grid, x: nx, y: ny }) * 0.05;

      const st = `${nx},${ny},${d.i}`;
      const old = best.get(st);
      if (
        !old ||
        nt < old.turns ||
        (nt === old.turns && (nl < old.len || (nl === old.len && nc < old.cost)))
      ) {
        best.set(st, { turns: nt, len: nl, cost: nc });
        came.set(st, curKey);
        const f = nt * 1000000 + nl * 1000 + nc;
        open.push({ x: nx, y: ny, prevDirI: d.i, turns: nt, len: nl, cost: nc, f });
      }
    }
  }

  if (!bestGoal) return null;
  const goalState = `${bestGoal.x},${bestGoal.y},${bestGoal.prevDirI ?? "n"}`;
  const path = [];
  let k = goalState;
  while (k) {
    const [sx, sy] = k.split(",");
    path.push([Number(sx), Number(sy)]);
    k = came.get(k) ?? null;
  }
  path.reverse();
  return path;
}

function markRoadCellTyped({ grid, cfg, typeName, x, y, dirI, boundaryMask = null }) {
  const typeMask = roadTypeToMask(typeName);
  grid.markRoadCell(x, y, dirI, typeMask);

  if (boundaryMask && (typeName === "MAIN" || typeName === "SECONDARY")) markBoundaryCell(boundaryMask, grid, x, y);

  if (typeName === "MAIN") {
    const r = cfg.roadTypes.MAIN.hardBufferCells ?? cfg.roadTypes.MAIN.minSpacingParallelCells;
    if (dirI !== null && dirI !== undefined) grid.markReservedMainSideBands(x, y, dirI, r);
  } else if (typeName === "SECONDARY") {
    const r = cfg.roadTypes.SECONDARY.hardBufferCells ?? cfg.roadTypes.SECONDARY.minSpacingParallelCells;
    if (dirI !== null && dirI !== undefined) grid.markReservedSecondarySideBands(x, y, dirI, r);
  }
}

function markPathOnGrid(grid, path) {
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    const prev = path[i - 1];
    if (prev) {
      const dx = x - prev[0];
      const dy = y - prev[1];
      const dirI = DIRS_8.find((d) => d.dx === dx && d.dy === dy)?.i ?? null;
      grid.markRoadCell(x, y, dirI);
    } else {
      grid.markRoadCell(x, y, null);
    }
  }
}

function spawnPointsAlong(path, every) {
  const out = [];
  for (let i = every; i < path.length - every; i += every) out.push({ x: path[i][0], y: path[i][1] });
  return out;
}

function dirFromStep(dx, dy) {
  return DIRS_8.find((d) => d.dx === dx && d.dy === dy)?.i ?? null;
}

function anyDirFromMask(mask) {
  for (let i = 0; i < 8; i++) if (mask & (1 << i)) return i;
  return null;
}

function perpendicularDirs(dirI) {
  // 90° перпендикуляр (delta=2)
  return [((dirI + 2) % 8) | 0, ((dirI + 6) % 8) | 0];
}

function markBoundaryCell(boundaryMask, grid, x, y) {
  if (!grid.inBounds(x, y)) return;
  boundaryMask[y * grid.w + x] = 1;
}

function markPathAsRoad({ grid, path, boundaryMask = null }) {
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    const prev = path[i - 1];
    if (prev) {
      const dirI = dirFromStep(x - prev[0], y - prev[1]);
      grid.markRoadCell(x, y, dirI);
    } else {
      grid.markRoadCell(x, y, null);
    }
    if (boundaryMask) markBoundaryCell(boundaryMask, grid, x, y);
  }
}

function markPathAsTypedRoad({ grid, cfg, typeName, path, boundaryMask = null }) {
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    const prev = path[i - 1];
    const dirI = prev ? dirFromStep(x - prev[0], y - prev[1]) : null;
    markRoadCellTyped({ grid, cfg, typeName, x, y, dirI, boundaryMask });
  }
}

function isCardinalDir(dirI) {
  return (dirI & 1) === 0;
}

function sampleSecondaryLenTarget({ rng, cfg }) {
  const mean = Math.max(6, cfg.growth.secondaryLenTargetMean | 0);
  const min = Math.max(4, Math.min(mean, cfg.growth.secondaryLenTargetMin | 0));
  const max = Math.max(mean + 2, cfg.roadTypes.SECONDARY.maxLenCells | 0);
  // Треугольное распределение (min..max) с модой около mean.
  const u = rng.f32();
  const v = rng.f32();
  const tri01 = (u + v) * 0.5;
  const mode01 = (mean - min) / Math.max(1, max - min);
  const t = tri01 < mode01 ? Math.sqrt(tri01 * mode01) : 1 - Math.sqrt((1 - tri01) * (1 - mode01));
  const n = Math.round(min + t * (max - min));
  return Math.max(min, Math.min(max, n));
}

function trace8(a, b) {
  let x = a.x;
  let y = a.y;
  const out = [[x, y]];
  let guard = 0;
  while ((x !== b.x || y !== b.y) && guard++ < 10000) {
    const dx = Math.sign(b.x - x);
    const dy = Math.sign(b.y - y);
    x += dx;
    y += dy;
    out.push([x, y]);
  }
  return out;
}

function buildOctagonRing({ cx, cy, r }) {
  const cut = Math.max(1, Math.round(r * 0.45));
  const v = [
    { x: cx + r - cut, y: cy - r },
    { x: cx + r, y: cy - r + cut },
    { x: cx + r, y: cy + r - cut },
    { x: cx + r - cut, y: cy + r },
    { x: cx - r + cut, y: cy + r },
    { x: cx - r, y: cy + r - cut },
    { x: cx - r, y: cy - r + cut },
    { x: cx - r + cut, y: cy - r },
  ];
  const path = [];
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    const seg = trace8(a, b);
    if (!path.length) path.push(...seg);
    else path.push(...seg.slice(1));
  }
  return path;
}

function nearestCellInPath(path, x, y) {
  let best = null;
  for (const p of path) {
    const dx = p[0] - x;
    const dy = p[1] - y;
    const d2 = dx * dx + dy * dy;
    if (!best || d2 < best.d2) best = { x: p[0], y: p[1], d2 };
  }
  return best;
}

function clearArea(grid, cx, cy, r) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!grid.inBounds(x, y)) continue;
      grid.setObstacle(x, y, 0);
    }
  }
}

function borderTarget({ w, h, pad, dirI, cx, cy }) {
  if (dirI === 0) return { x: cx, y: pad };
  if (dirI === 4) return { x: cx, y: h - pad - 1 };
  if (dirI === 2) return { x: w - pad - 1, y: cy };
  if (dirI === 6) return { x: pad, y: cy };
  if (dirI === 1) return { x: w - pad - 1, y: pad };
  if (dirI === 3) return { x: w - pad - 1, y: h - pad - 1 };
  if (dirI === 5) return { x: pad, y: h - pad - 1 };
  if (dirI === 7) return { x: pad, y: pad };
  return { x: cx, y: cy };
}

function makeSecondarySeeds({ rng, grid, mainRoads, cfg }) {
  const seeds = [];
  const everyMin = cfg.growth.spawnSecondaryEveryMin;
  const everyMax = cfg.growth.spawnSecondaryEveryMax;

  for (const r of mainRoads) {
    if (r.tag === "PLAZA") continue;
    const p = r.path;
    if (!p || p.length < 4) continue;
    let i = rng.int(everyMin, everyMax);
    while (i < p.length - everyMin) {
      const a = p[i - 1];
      const b = p[i];
      const c = p[i + 1];
      const dirI = dirFromStep(c[0] - b[0], c[1] - b[1]) ?? dirFromStep(b[0] - a[0], b[1] - a[1]);
      if (dirI !== null) {
        seeds.push({ x: b[0], y: b[1], parentDirI: dirI });
      }
      i += rng.int(everyMin, everyMax);
    }
  }

  // Фильтруем семена на препятствиях и вне карты.
  return seeds.filter((s) => grid.inBounds(s.x, s.y) && !grid.isObstacle(s.x, s.y));
}

function tooCloseParallel({ grid, x, y, dirI, minSpacing }) {
  const r = Math.max(1, minSpacing | 0);
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      if (!ox && !oy) continue;
      const nx = x + ox;
      const ny = y + oy;
      if (!grid.inBounds(nx, ny)) continue;
      if (!grid.isRoad(nx, ny)) continue;
      const mask = grid.getDirMask(nx, ny);
      if ((mask & (1 << dirI)) !== 0 || (mask & (1 << ((dirI + 4) % 8))) !== 0) return true;
    }
  }
  return false;
}

function initConstrainedBranch({
  graph,
  typeCfg,
  type,
  x,
  y,
  forwardDirI,
  lenTarget,
  minRunRemaining = 0,
  diagEscapeRemaining = 0,
  initialPath = null,
}) {
  const path = initialPath ?? [[x, y]];
  const visited = new Set(path.map((p) => key(p[0], p[1])));
  return {
    type,
    widthCells: typeCfg.widthCells,
    path,
    visited,
    prevDirI: forwardDirI,
    forwardDirI,
    len: 0,
    lenTarget,
    minRunRemaining,
    turnCooldownRemaining: 0,
    diagEscapeRemaining,
    done: false,
    originNodeId: graph.ensureNode(path[0][0], path[0][1]),
  };
}

function stepBranchConstrained({ grid, graph, rng, cfg, branch, boundaryMask = null, goal = null }) {
  const typeCfg = cfg.roadTypes[branch.type];
  const last = branch.path[branch.path.length - 1];
  const x = last[0];
  const y = last[1];

  const typeName = branch.type;
  const isSecondary = typeName === "SECONDARY";
  const isLocal = typeName === "LOCAL";

  const snapRoadMask = isSecondary ? ROAD_TYPE_MASK.MAIN | ROAD_TYPE_MASK.SECONDARY : 0;

  // Snap
  // SECONDARY: snap=terminate (квартальный критерий остановки)
  if (isSecondary) {
    const snap = findSnapTarget({
      grid,
      graph,
      x,
      y,
      radiusCells: typeCfg.snapRadiusCells,
      forbidNodeId: branch.originNodeId,
      roadTypeMask: snapRoadMask,
    });
    if (snap && snap.d2 > 0) {
      const targetNodeId = snap.kind === "node" ? snap.nodeId : graph.ensureNode(snap.x, snap.y);
      if (canAttachNode(graph, targetNodeId, typeCfg.maxNodeDegree)) {
        const allowed = [0, 2, 4, 6];
        const seg = connectWithinRadius8({
          grid,
          start: { x, y },
          goal: { x: snap.x, y: snap.y },
          radius: typeCfg.snapRadiusCells,
          allowedDirIs: allowed,
        });
        if (seg && seg.length >= 2) {
          markPathAsTypedRoad({ grid, cfg, typeName, path: seg, boundaryMask });
          graph.addRoad({ type: typeName, widthCells: typeCfg.widthCells, path: seg, tag: "SNAP_CONNECTOR" });
        }
        branch.done = true;
        return;
      }
    }
  }

  const forward = branch.forwardDirI;
  if (forward === null || forward === undefined) {
    branch.done = true;
    return;
  }

  // SECONDARY: жёсткий minRun: только forward или terminate.
  if (isSecondary && branch.minRunRemaining > 0) {
    if (!isCardinalDir(forward) && branch.diagEscapeRemaining <= 0) {
      branch.done = true;
      return;
    }
    const d = DIRS_8[forward];
    const nx = x + d.dx;
    const ny = y + d.dy;
    const nk = key(nx, ny);
    if (branch.visited.has(nk)) {
      branch.done = true;
      return;
    }
    if (!grid.inBounds(nx, ny) || grid.isObstacle(nx, ny) || grid.isRoad(nx, ny)) {
      branch.done = true;
      return;
    }
    // Hard anti-parallel/spacing: запрещаем заходить в боковые reserved-полосы.
    if (grid.isReservedBySecondary(nx, ny) || grid.isReservedByMain(nx, ny)) {
      branch.done = true;
      return;
    }
    branch.path.push([nx, ny]);
    branch.visited.add(nk);
    branch.len++;
    branch.prevDirI = forward;
    markRoadCellTyped({ grid, cfg, typeName, x: nx, y: ny, dirI: forward, boundaryMask });
    branch.minRunRemaining--;
    if (branch.turnCooldownRemaining > 0) branch.turnCooldownRemaining--;
    if (branch.len >= branch.lenTarget || branch.len >= typeCfg.maxLenCells) branch.done = true;
    return;
  }
  const candidates = [];

  const allowTurn = !isSecondary || branch.turnCooldownRemaining <= 0;
  const tryForwardFirst = true;

  const add = (dirI) => {
    if (dirI === null || dirI === undefined) return;
    if (!cfg.gridStyle?.allow135 && dirIndexDelta(forward, dirI) === 3) return;
    if (cfg.gridStyle?.forbidBacktrack && dirIndexDelta(forward, dirI) === 4) return;
    if (isSecondary && !isCardinalDir(dirI)) return;
    candidates.push(dirI);
  };

  if (tryForwardFirst) add(forward);
  if (allowTurn) {
    add((forward + 2) % 8);
    add((forward + 6) % 8);
  }

  // LOCAL: может диагоналить, но с более сильным spacing.
  if (typeName === "LOCAL" && allowTurn) {
    candidates.push(((forward + 1) % 8) | 0, ((forward + 7) % 8) | 0);
  }

  const goalVec = goal ? goalBiasToPoint({ x, y }, goal, 0.8) : null;

  const scored = [];
  for (const dirI of candidates) {
    // Hard buffers
    const d = DIRS_8[dirI];
    const nx = x + d.dx;
    const ny = y + d.dy;
    if (!grid.inBounds(nx, ny) || grid.isObstacle(nx, ny)) continue;
    if (grid.isRoad(nx, ny)) continue;
    if (isSecondary) {
      if (grid.isReservedBySecondary(nx, ny) || grid.isReservedByMain(nx, ny)) continue;
    }
    if (isLocal) {
      if (grid.isReservedBySecondary(nx, ny)) continue;
    }

    // SECONDARY: поворот по cooldown невозможен (кроме forward)
    if (isSecondary && dirI !== forward && !allowTurn) continue;

    // SECONDARY: небольшой бонус прямой линии
    const extraTurn = isSecondary && dirI !== forward ? 0.25 : 0;

    const { ok, score } = directionScore({
      grid,
      x,
      y,
      prevDirI: branch.prevDirI,
      dirI,
      typeCfg,
      cfg,
      goalVec,
    });
    if (!ok) continue;
    scored.push({ dirI, score: score + extraTurn });
  }

  scored.sort((a, b) => a.score - b.score);
  const pick = scored[0];
  if (!pick) {
    // SECONDARY: диагонали только аварийно и только по бюджету.
    if (isSecondary && (cfg.growth.secondaryAllowDiagonals || branch.diagEscapeRemaining > 0)) {
      const fallback = [((forward + 1) % 8) | 0, ((forward + 7) % 8) | 0];
      for (const dirI of fallback) {
        if (branch.diagEscapeRemaining <= 0 && !cfg.growth.secondaryAllowDiagonals) break;
        const d = DIRS_8[dirI];
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (!grid.inBounds(nx, ny) || grid.isObstacle(nx, ny) || grid.isRoad(nx, ny)) continue;
        // Диагональ допускаем только если явно «застряли» (нет forward) или рядом диагональная MAIN.
        const f = DIRS_8[forward];
        const fx = x + f.dx;
        const fy = y + f.dy;
        const forwardBlocked = !grid.inBounds(fx, fy) || grid.isObstacle(fx, fy) || grid.isRoad(fx, fy);
        let nearDiagMain = false;
        const k = cfg.growth.secondaryDiagMainInfluenceDist | 0;
        if (k > 0) {
          for (let oy = -k; oy <= k && !nearDiagMain; oy++) {
            for (let ox = -k; ox <= k; ox++) {
              const tx = x + ox;
              const ty = y + oy;
              if (!grid.inBounds(tx, ty)) continue;
              if (!grid.hasRoadType(tx, ty, ROAD_TYPE_MASK.MAIN)) continue;
              const m = grid.getDirMask(tx, ty);
              if ((m & (1 << 1)) || (m & (1 << 3)) || (m & (1 << 5)) || (m & (1 << 7))) {
                nearDiagMain = true;
                break;
              }
            }
          }
        }
        if (!forwardBlocked && !nearDiagMain) continue;

        const { ok, score } = directionScore({ grid, x, y, prevDirI: branch.prevDirI, dirI, typeCfg, cfg, goalVec });
        if (ok) scored.push({ dirI, score: score + 4.0 });
      }
      scored.sort((a, b) => a.score - b.score);
      if (!scored[0]) {
        branch.done = true;
        return;
      }
    } else {
      // Некуда идти — terminate.
      branch.done = true;
      return;
    }
  }

  const dirI = scored[0].dirI;
  const d = DIRS_8[dirI];
  const nx = x + d.dx;
  const ny = y + d.dy;
  const nk = key(nx, ny);
  if (branch.visited.has(nk)) {
    branch.done = true;
    return;
  }
  if (wouldSelfCollide({ grid, x: nx, y: ny, allowOnRoad: true })) {
    branch.done = true;
    return;
  }

  branch.path.push([nx, ny]);
  branch.visited.add(nk);
  branch.len++;
  branch.prevDirI = dirI;
  markRoadCellTyped({ grid, cfg, typeName, x: nx, y: ny, dirI, boundaryMask });

  // cooldown убывает на каждом шаге
  if (branch.turnCooldownRemaining > 0) branch.turnCooldownRemaining--;

  if (isSecondary) {
    if (dirI === forward && branch.minRunRemaining > 0) branch.minRunRemaining--;
    if (dirI !== forward) {
      // SECONDARY: базово держим 4 направления. Диагональ — лишь короткий «escape» без смены forward.
      if (isCardinalDir(dirI)) branch.forwardDirI = dirI;
      branch.minRunRemaining = cfg.growth.secondaryMinRunCells | 0;
      branch.turnCooldownRemaining = cfg.growth.secondaryTurnCooldownCells | 0;
    }
    if (!isCardinalDir(dirI)) {
      branch.diagEscapeRemaining = Math.max(0, (branch.diagEscapeRemaining | 0) - 1);
    }
  } else {
    if (dirI !== forward) branch.forwardDirI = dirI;
  }

  if (branch.len >= branch.lenTarget) branch.done = true;
  if (branch.len >= typeCfg.maxLenCells) branch.done = true;
}

function growBranches({ grid, graph, rng, cfg, type, startPoints, attractor }) {
  const typeCfg = cfg.roadTypes[type];
  const branches = [];

  for (const p of startPoints) {
    if (branches.length >= cfg.growth.maxBranches) break;
    branches.push({
      type,
      widthCells: typeCfg.widthCells,
      path: [[p.x, p.y]],
      visited: new Set([key(p.x, p.y)]),
      prevDirI: null,
      len: 0,
      done: false,
      originNodeId: graph.ensureNode(p.x, p.y),
    });
  }

  const maxIter = cfg.growth.maxGrowIterations;
  for (let iter = 0; iter < maxIter; iter++) {
    let active = 0;
    for (const b of branches) {
      if (b.done) continue;
      active++;
      if (b.len >= typeCfg.maxLenCells) {
        b.done = true;
        continue;
      }

      const last = b.path[b.path.length - 1];
      const x = last[0];
      const y = last[1];
      const goalVec = attractor ? goalBiasToPoint({ x, y }, attractor, 0.9) : null;

      // Ветвление: делаем отдельную ветку от текущей точки.
      const density = grid.getRoadCount(x, y);
      const branchP = typeCfg.branchProb * (density ? 0.6 : 1.0);
      if (rng.chance(branchP) && branches.length < cfg.growth.maxBranches) {
        branches.push({
          type,
          widthCells: typeCfg.widthCells,
          path: [[x, y]],
          prevDirI: b.prevDirI,
          len: 0,
          done: false,
          originNodeId: graph.ensureNode(x, y),
        });
      }

      for (let s = 0; s < typeCfg.stepLenCells; s++) {
        const cur = b.path[b.path.length - 1];
        const cx = cur[0];
        const cy = cur[1];

        const snap = findSnapTarget({
          grid,
          graph,
          x: cx,
          y: cy,
          radiusCells: typeCfg.snapRadiusCells,
          forbidNodeId: b.originNodeId,
        });
        if (snap && snap.d2 > 0) {
          const targetNodeId = snap.kind === "node" ? snap.nodeId : graph.ensureNode(snap.x, snap.y);
          if (!canAttachNode(graph, targetNodeId, typeCfg.maxNodeDegree)) {
            // Узел перегружен — продолжаем рост, чтобы найти другой снап.
          } else {
            b.path.push([snap.x, snap.y]);
            b.done = true;
            break;
          }
        }

        const scored = [];
        for (let dirI = 0; dirI < 8; dirI++) {
          if (type === "LOCAL" && cfg.gridStyle.forbid135ForLocal && dirIndexDelta(b.prevDirI ?? dirI, dirI) === 3) continue;
          const { ok, score } = directionScore({
            grid,
            x: cx,
            y: cy,
            prevDirI: b.prevDirI,
            dirI,
            typeCfg,
            cfg,
            goalVec,
          });
          if (!ok) continue;
          scored.push({ dirI, score });
        }

        const dirI = pickDirection(rng, scored);
        if (dirI === null) {
          b.done = true;
          break;
        }
        const d = DIRS_8[dirI];
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        const nk = key(nx, ny);
        if (b.visited.has(nk)) {
          b.done = true;
          break;
        }
        const allowOnRoad = true; // чтобы можно было приткнуться и завершиться
        if (wouldSelfCollide({ grid, x: nx, y: ny, allowOnRoad })) {
          b.done = true;
          break;
        }

        b.path.push([nx, ny]);
        b.visited.add(nk);
        b.prevDirI = dirI;
        b.len++;

        // Если пришли в дорогу — завершаем как snap.
        if (grid.isRoad(nx, ny)) {
          b.done = true;
          break;
        }
      }
    }
    if (!active) break;
  }

  // Записываем ветки в граф.
  for (const b of branches) {
    if (b.path.length < 2) continue;
    const cleaned = antiZigZagReorder(b.path, grid);
    markPathOnGrid(grid, cleaned);
    graph.addRoad({ type: b.type, widthCells: b.widthCells, path: cleaned });
  }
}

function initBranch({ graph, typeCfg, type, x, y }) {
  return {
    type,
    widthCells: typeCfg.widthCells,
    path: [[x, y]],
    visited: new Set([key(x, y)]),
    prevDirI: null,
    len: 0,
    done: false,
    originNodeId: graph.ensureNode(x, y),
  };
}

function stepOneCell({ grid, graph, rng, cfg, branch, attractor }) {
  const typeCfg = cfg.roadTypes[branch.type];
  const last = branch.path[branch.path.length - 1];
  const x = last[0];
  const y = last[1];

  const snap = findSnapTarget({
    grid,
    graph,
    x,
    y,
    radiusCells: typeCfg.snapRadiusCells,
    forbidNodeId: branch.originNodeId,
  });
  if (snap && snap.d2 > 0) {
    const targetNodeId = snap.kind === "node" ? snap.nodeId : graph.ensureNode(snap.x, snap.y);
    if (canAttachNode(graph, targetNodeId, typeCfg.maxNodeDegree)) {
      const seg = connectWithinRadius8({ grid, start: { x, y }, goal: { x: snap.x, y: snap.y }, radius: typeCfg.snapRadiusCells });
      if (seg && seg.length >= 2) {
        for (let i = 1; i < seg.length; i++) {
          const [sx, sy] = seg[i];
          const [px, py] = seg[i - 1];
          const dx = sx - px;
          const dy = sy - py;
          const dirI = DIRS_8.find((d) => d.dx === dx && d.dy === dy)?.i ?? null;
          const sk = key(sx, sy);
          if (branch.visited.has(sk)) break;
          branch.path.push([sx, sy]);
          branch.visited.add(sk);
          grid.markRoadCell(sx, sy, dirI);
        }
      }
      branch.done = true;
      return;
    }
  }

  const goalVec = attractor ? goalBiasToPoint({ x, y }, attractor, 0.9) : null;
  const scored = [];
  for (let dirI = 0; dirI < 8; dirI++) {
    if (branch.type === "LOCAL" && cfg.gridStyle.forbid135ForLocal && dirIndexDelta(branch.prevDirI ?? dirI, dirI) === 3) continue;
    const { ok, score } = directionScore({
      grid,
      x,
      y,
      prevDirI: branch.prevDirI,
      dirI,
      typeCfg,
      cfg,
      goalVec,
    });
    if (!ok) continue;
    scored.push({ dirI, score });
  }
  const dirI = pickDirection(rng, scored);
  if (dirI === null) {
    branch.done = true;
    return;
  }

  const d = DIRS_8[dirI];
  const nx = x + d.dx;
  const ny = y + d.dy;
  const nk = key(nx, ny);
  if (branch.visited.has(nk)) {
    branch.done = true;
    return;
  }
  if (wouldSelfCollide({ grid, x: nx, y: ny, allowOnRoad: true })) {
    branch.done = true;
    return;
  }

  branch.path.push([nx, ny]);
  branch.visited.add(nk);
  branch.prevDirI = dirI;
  branch.len++;
  grid.markRoadCell(nx, ny, dirI);

  if (grid.isRoad(nx, ny) && grid.getRoadCount(nx, ny) > 1) {
    branch.done = true;
  }
  if (branch.len >= typeCfg.maxLenCells) branch.done = true;
}

function finalizeBranch({ graph, grid, branch }) {
  if (branch.path.length < 2) return;
  graph.addRoad({ type: branch.type, widthCells: branch.widthCells, path: branch.path });
}

export function createCitySimulation({ rng, cfg, w, h }) {
  const grid = new Grid(w, h);
  const graph = new Graph(grid);
  generateObstacles(grid, rng, cfg.fields.obstacles);

  const boundaryMask = new Uint8Array(w * h);

  const hub = findNearestFree(grid, (w / 2) | 0, (h / 2) | 0, 10);
  const gatesRaw = gateCandidates(w, h).map((g) => findNearestFree(grid, g.x, g.y, 10));
  const gates = [];
  for (const g of gatesRaw) {
    if (gates.some((q) => Math.hypot(q.x - g.x, q.y - g.y) < 6)) continue;
    gates.push(g);
  }

  const attraction = buildAttraction({ hub, gates });
  graph.ensureNode(hub.x, hub.y);

  // Центральная площадь — октокольцо
  const plazaR = rng.int(cfg.growth.plazaRadiusMin, cfg.growth.plazaRadiusMax);
  clearArea(grid, hub.x, hub.y, plazaR + 3);
  const plazaRing = buildOctagonRing({ cx: hub.x, cy: hub.y, r: plazaR });
  markPathAsTypedRoad({ grid, cfg, typeName: "MAIN", path: plazaRing, boundaryMask });
  graph.addRoad({ type: "MAIN", widthCells: cfg.roadTypes.MAIN.widthCells, path: plazaRing, tag: "PLAZA" });

  // MAIN — две орт-оси + 1–2 диагонали
  const mainTypeCfg = cfg.roadTypes.MAIN;
  const pad = 2;

  function connectMainTo(dirI) {
    const t = borderTarget({ w, h, pad, dirI, cx: hub.x, cy: hub.y });
    const start = nearestCellInPath(plazaRing, t.x, t.y) ?? { x: hub.x, y: hub.y };
    const goal = findNearestFree(grid, t.x, t.y, 10);
    const path = aStar8({ grid, start, goal, typeCfg: mainTypeCfg, cfg });
    if (!path || path.length < 2) return null;
    markPathAsTypedRoad({ grid, cfg, typeName: "MAIN", path, boundaryMask });
    const cleaned = antiZigZagReorder(path, grid);
    graph.addRoad({ type: "MAIN", widthCells: mainTypeCfg.widthCells, path: cleaned });
    return { type: "MAIN", widthCells: mainTypeCfg.widthCells, path: cleaned };
  }

  const mainRoads = [];
  for (const dirI of [0, 4, 2, 6]) {
    const r = connectMainTo(dirI);
    if (r) mainRoads.push(r);
  }

  const diagPairs = [
    [1, 5],
    [7, 3],
  ];
  const diagCount = rng.int(cfg.growth.diagMainCountMin, cfg.growth.diagMainCountMax);
  rng.shuffleInPlace(diagPairs);
  for (let i = 0; i < Math.min(diagCount, diagPairs.length); i++) {
    const pair = diagPairs[i];
    const a = connectMainTo(pair[0]);
    const b = connectMainTo(pair[1]);
    if (a) mainRoads.push(a);
    if (b) mainRoads.push(b);
  }

  const meta = { w, h, cellScale: cfg.meta.cellScaleBlocks, seed: rng.seed };

  // SECONDARY seeds
  const seeds = makeSecondarySeeds({ rng, grid, mainRoads: graph.roads.filter((r) => r.type === "MAIN"), cfg });
  rng.shuffleInPlace(seeds);

  const targetSeeds = Math.min(
    Math.max(0, cfg.growth.secondarySeedMax | 0),
    Math.round(((w * h) / 1000) * (cfg.growth.secondarySeedDensityPer1000 ?? 0))
  );
  const pickedSeeds = seeds.slice(0, Math.max(0, targetSeeds));

  const secondaryBranches = [];
  const secondaryCfg = cfg.roadTypes.SECONDARY;
  for (const s of pickedSeeds) {
    const perps = perpendicularDirs(s.parentDirI);
    // Спавним чаще одну сторону, иногда обе.
    const spawnBoth = rng.chance(0.10);
    for (let j = 0; j < perps.length; j++) {
      if (!spawnBoth && j > 0) break;
      const dirI = perps[j];
      if ((dirI & 1) !== 0) continue; // SECONDARY базово 4 направления
      if (tooCloseParallel({ grid, x: s.x, y: s.y, dirI, minSpacing: secondaryCfg.minSpacingParallelCells })) continue;
      const minRun = cfg.growth.secondaryMinRunCells | 0;
      const lenTarget = sampleSecondaryLenTarget({ rng, cfg });
      secondaryBranches.push(
        initConstrainedBranch({
          graph,
          typeCfg: secondaryCfg,
          type: "SECONDARY",
          x: s.x,
          y: s.y,
          forwardDirI: dirI,
          lenTarget,
          minRunRemaining: minRun,
          diagEscapeRemaining: cfg.growth.secondaryDiagEscapeBudget | 0,
        })
      );
    }
  }

  const localBranches = [];

  const sim = {
    grid,
    graph,
    blocks: [],
    meta,
    attraction,
    stage: "SECONDARY",
    done: false,
    _boundaryMask: boundaryMask,
    _secondaryBranches: secondaryBranches,
    _localBranches: localBranches,
    _rrSecondary: 0,
    _rrLocal: 0,
    _localSeeded: false,
    step(steps = 1) {
      if (this.done) return;
      const microBudget = Math.max(8, cfg.growth.microBudgetPerStep ?? 36);
      for (let s = 0; s < steps; s++) {
        if (this.stage === "SECONDARY") {
          let progressed = 0;
          for (let k = 0; k < microBudget; k++) {
            if (!this._secondaryBranches.length) break;
            const b = this._secondaryBranches[this._rrSecondary++ % this._secondaryBranches.length];
            if (!b || b.done) continue;
            stepBranchConstrained({ grid, graph, rng, cfg, branch: b, boundaryMask: this._boundaryMask, goal: hub });
            progressed++;
            if (b.done) finalizeBranch({ graph, grid, branch: b });
          }
          let active = 0;
          for (const b of this._secondaryBranches) if (!b.done) active++;
          if (!active || progressed === 0) {
            // Переходим к кварталам (по boundaryMask: MAIN+SECONDARY)
            this.blocks = floodFillBlocksByMask({ grid, boundaryMask: this._boundaryMask });
            this.stage = "LOCAL";
          }
        } else if (this.stage === "LOCAL") {
          if (!this._localSeeded) {
            // LOCAL: только «карманы/подъезды» от boundary (MAIN/SECONDARY) внутрь кварталов.
            const localCfg = cfg.roadTypes.LOCAL;

            const candidates = [];
            const borderPad = 2;
            for (let y = borderPad; y < h - borderPad; y++) {
              for (let x = borderPad; x < w - borderPad; x++) {
                if (!grid.isRoad(x, y)) continue;
                if (!grid.hasRoadType(x, y, ROAD_TYPE_MASK.MAIN | ROAD_TYPE_MASK.SECONDARY)) continue;
                // Ищем свободную клетку в квартале рядом, чтобы начать карман.
                for (let k = 0; k < 4; k++) {
                  const d = DIRS_8[k * 2];
                  const sx = x + d.dx;
                  const sy = y + d.dy;
                  if (!grid.inBounds(sx, sy)) continue;
                  if (grid.isObstacle(sx, sy) || grid.isRoad(sx, sy)) continue;
                  if (grid.isReservedBySecondary(sx, sy)) continue;
                  // Стартовая клетка должна быть внутри блока (не boundaryMask).
                  if (this._boundaryMask[sy * w + sx] !== 0) continue;
                  candidates.push({ ox: x, oy: y, x: sx, y: sy, dirI: d.i });
                }
              }
            }

            rng.shuffleInPlace(candidates);
            for (const c of candidates) {
              if (this._localBranches.length >= cfg.growth.localCountTarget) break;
              const dirI = c.dirI;
              if (tooCloseParallel({ grid, x: c.x, y: c.y, dirI, minSpacing: localCfg.minSpacingParallelCells })) continue;
              const lenTarget = rng.int(cfg.growth.localLenMin, cfg.growth.localLenMax);
              // Включаем якорь на boundary дороге, чтобы LOCAL не были «оторванными».
              const initialPath = [
                [c.ox, c.oy],
                [c.x, c.y],
              ];
              // Маркируем первый шаг кармана.
              markRoadCellTyped({ grid, cfg, typeName: "LOCAL", x: c.x, y: c.y, dirI, boundaryMask: null });
              this._localBranches.push(
                initConstrainedBranch({
                  graph,
                  typeCfg: localCfg,
                  type: "LOCAL",
                  x: c.x,
                  y: c.y,
                  forwardDirI: dirI,
                  lenTarget,
                  minRunRemaining: 0,
                  initialPath,
                })
              );
            }
            this._localSeeded = true;
          }

          let progressed = 0;
          for (let k = 0; k < microBudget; k++) {
            if (!this._localBranches.length) break;
            const b = this._localBranches[this._rrLocal++ % this._localBranches.length];
            if (!b || b.done) continue;
            stepBranchConstrained({ grid, graph, rng, cfg, branch: b, boundaryMask: null, goal: null });
            progressed++;
            if (b.done) finalizeBranch({ graph, grid, branch: b });
          }

          let active = 0;
          for (const b of this._localBranches) if (!b.done) active++;
          if (!active || progressed === 0) {
            this.stage = "CONNECTORS";
          }
        } else if (this.stage === "CONNECTORS") {
          // Финальный постпроцесс: anti-zigzag + пересборка road layer
          resetRoadLayers(grid);
          this._boundaryMask.fill(0);
          for (const r of graph.roads) {
            r.path = antiZigZagReorder(r.path, grid);
            const isBoundary = r.type === "MAIN" || r.type === "SECONDARY";
            markPathAsTypedRoad({
              grid,
              cfg,
              typeName: r.type,
              path: r.path,
              boundaryMask: isBoundary ? this._boundaryMask : null,
            });
          }

          // Кварталы по boundaryMask и обязательный выход
          this.blocks = buildBlocksAndConnectors({ grid, graph, cfg, rng, boundaryMask: this._boundaryMask });
          this.stage = "DONE";
          this.done = true;
        } else {
          this.done = true;
        }
      }
    },
  };

  return sim;
}

export function generateCity({ rng, cfg, w, h }) {
  const sim = createCitySimulation({ rng, cfg, w, h });
  // Дожимаем до конца за один вызов (старое API).
  let guard = 0;
  while (!sim.done && guard++ < 5000) sim.step(1);
  return { grid: sim.grid, graph: sim.graph, blocks: sim.blocks, meta: sim.meta, attraction: sim.attraction };
}
