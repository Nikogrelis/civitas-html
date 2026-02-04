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

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash2(x, y, seed) {
  let n = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 1442695041;
  n = (n ^ (n >>> 13)) * 1274126177;
  n ^= n >>> 16;
  return (n >>> 0) / 4294967295;
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

function buildDistanceToObstacles(grid) {
  // Multi-source BFS distance (4-neighborhood) to nearest obstacle.
  const w = grid.w;
  const h = grid.h;
  const n = w * h;
  const dist = new Int16Array(n);
  dist.fill(-1);

  const qx = new Int16Array(n);
  const qy = new Int16Array(n);
  let qs = 0;
  let qe = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid.isObstacle(x, y)) continue;
      const i = y * w + x;
      dist[i] = 0;
      qx[qe] = x;
      qy[qe] = y;
      qe++;
    }
  }

  const dirs4 = [DIRS_8[0], DIRS_8[2], DIRS_8[4], DIRS_8[6]];
  while (qs < qe) {
    const x = qx[qs];
    const y = qy[qs];
    qs++;
    const i = y * w + x;
    const d = dist[i];
    for (const dd of dirs4) {
      const nx = x + dd.dx;
      const ny = y + dd.dy;
      if (!grid.inBounds(nx, ny)) continue;
      const ni = ny * w + nx;
      if (dist[ni] !== -1) continue;
      dist[ni] = d + 1;
      qx[qe] = nx;
      qy[qe] = ny;
      qe++;
    }
  }
  return dist;
}

function aStar8({ grid, start, goal, typeCfg, cfg, allowedDirIs = null, extraCostFn = null }) {
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

    const dirs = allowedDirIs ? allowedDirIs.map((i) => DIRS_8[i]) : DIRS_8;
    for (const d of dirs) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (!grid.inBounds(nx, ny)) continue;
      if (grid.isObstacle(nx, ny)) continue;

      const tp = turnPenalty(cur.prevDirI, d.i, typeCfg, cfg);
      if (!Number.isFinite(tp)) continue;

      const rep = repelCost({ grid, x: nx, y: ny, dirI: d.i, typeCfg });
      const diag = d.dx !== 0 && d.dy !== 0;
      const diagBias = diag ? (typeCfg.diagonalBias ?? 0) : 0;
      const extra = extraCostFn ? extraCostFn(nx, ny) : 0;
      const stepCost = d.cost * baseCellCost({ grid, x: nx, y: ny }) + tp + rep + diagBias + extra;
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

// RoadGen v2: Spiral point cloud -> 45/90/diag(45) shortest-bend roads -> no intersections.
function generateSpiralPoints({ rng, grid, count, c, step, noiseR, noiseTheta, center, minDist, distToObs, waterAvoidDist }) {
  const out = [];
  const seen = new Set();
  const phi = 2.399963229728653; // golden angle in radians
  const w = grid.w;
  const h = grid.h;
  const cx = center.x;
  const cy = center.y;
  const minDist2 = Math.max(0, minDist ?? 0) ** 2;
  const avoid = Math.max(0, waterAvoidDist ?? 0);

  for (let n = 0; n < count; n++) {
    const r = c * Math.sqrt(n) + (rng.f32() - 0.5) * (noiseR ?? 0);
    const theta = n * phi + (rng.f32() - 0.5) * (noiseTheta ?? 0);
    let x = cx + r * Math.cos(theta);
    let y = cy + r * Math.sin(theta);
    x = Math.round(x / step) * step;
    y = Math.round(y / step) * step;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    if (grid.isObstacle(x, y)) continue;
    if (distToObs && avoid > 0) {
      const d = distToObs[y * w + x];
      if (d !== -1 && d <= avoid) continue;
    }
    const k = key(x, y);
    if (seen.has(k)) continue;

    if (minDist2 > 0) {
      let ok = true;
      for (const p of out) {
        const dx = p.x - x;
        const dy = p.y - y;
        if (dx * dx + dy * dy < minDist2) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }

    seen.add(k);
    out.push({ x, y });
  }
  return out;
}

function buildKnnCandidates(points, k) {
  const edges = [];
  const seen = new Set();
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const dists = [];
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const b = points[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      dists.push({ j, d2: dx * dx + dy * dy });
    }
    dists.sort((p, q) => p.d2 - q.d2);
    for (let n = 0; n < Math.min(k, dists.length); n++) {
      const j = dists[n].j;
      const aId = i < j ? i : j;
      const bId = i < j ? j : i;
      const ek = `${aId}-${bId}`;
      if (seen.has(ek)) continue;
      seen.add(ek);
      edges.push({ a: aId, b: bId, d2: dists[n].d2 });
    }
  }
  edges.sort((p, q) => p.d2 - q.d2);
  return edges;
}

function traceLine8(a, b, step = 1) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return [[a.x, a.y]];
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (dx !== 0 && dy !== 0 && adx !== ady) return null;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const steps = Math.max(adx, ady) / step;
  const path = [];
  for (let i = 0; i <= steps; i++) {
    path.push([a.x + sx * i * step, a.y + sy * i * step]);
  }
  return path;
}

function buildPathVia(a, p, b, step = 1) {
  const s1 = traceLine8(a, p, step);
  if (!s1) return null;
  const s2 = traceLine8(p, b, step);
  if (!s2) return null;
  return s1.concat(s2.slice(1));
}

function candidatePaths45_90(a, b, step = 1) {
  const out = [];
  const dx = (b.x - a.x) / step;
  const dy = (b.y - a.y) / step;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx === 0 && ady === 0) return out;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const m = Math.min(adx, ady);

  const P = { x: a.x + sx * m * step, y: a.y + sy * m * step }; // diag then ortho
  const P2 = { x: b.x - sx * m * step, y: b.y - sy * m * step }; // ortho then diag
  const P1 = { x: b.x, y: a.y }; // L
  const P3 = { x: a.x, y: b.y }; // L

  const base = [P, P2, P1, P3];
  for (const p of base) {
    const path = buildPathVia(a, p, b, step);
    if (path && path.length >= 2) out.push(path);
  }

  const shifts = [
    [step, 0],
    [-step, 0],
    [0, step],
    [0, -step],
    [step, step],
    [step, -step],
    [-step, step],
    [-step, -step],
  ];
  for (const baseP of [P, P2]) {
    for (const s of shifts) {
      const p = { x: baseP.x + s[0], y: baseP.y + s[1] };
      const path = buildPathVia(a, p, b, step);
      if (path && path.length >= 2) out.push(path);
    }
  }

  return out;
}

function pathIntersectsOcc({ path, grid, occ, nodeSet, distToObs, waterAvoidDist }) {
  const avoid = Math.max(0, waterAvoidDist ?? 0);
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    if (!grid.inBounds(x, y)) return true;
    if (grid.isObstacle(x, y)) return true;
    const idx = y * grid.w + x;
    if (distToObs && avoid > 0) {
      const d = distToObs[idx];
      if (d !== -1 && d <= avoid) return true;
    }
    if (!occ[idx]) continue;
    const isEndpoint = i === 0 || i === path.length - 1;
    if (isEndpoint && nodeSet.has(key(x, y))) continue; // connect at a node
    return true; // overlap / intersection
  }
  return false;
}

function markOcc(path, grid, occ) {
  for (const [x, y] of path) occ[y * grid.w + x] = 1;
}

function buildMstEdgeSet(edges, nodeCount) {
  const parent = new Int32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) parent[i] = i;
  const find = (x) => {
    let p = x;
    while (parent[p] !== p) p = parent[p];
    while (parent[x] !== x) {
      const n = parent[x];
      parent[x] = p;
      x = n;
    }
    return p;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent[ra] = rb;
    return true;
  };

  const set = new Set();
  const sorted = edges.map((e, i) => ({ i, d2: e.d2 })).sort((a, b) => a.d2 - b.d2);
  for (const s of sorted) {
    const e = edges[s.i];
    if (unite(e.a, e.b)) set.add(s.i);
  }
  return set;
}

function pickShortestValidPath({ paths, grid, occ, nodeSet, distToObs, waterAvoidDist }) {
  let best = null;
  let bestLen = Infinity;
  for (const path of paths) {
    if (pathIntersectsOcc({ path, grid, occ, nodeSet, distToObs, waterAvoidDist })) continue;
    if (path.length < bestLen) {
      best = path;
      bestLen = path.length;
    }
  }
  return best;
}

function pickGatePoints({ points, deg, w, h, hub, count, pad, minSpacing, band }) {
  const pick = (requireDeg, maxEdgeDist) => {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (requireDeg && deg && deg[i] <= 0) continue;
      const dEdge = Math.min(p.x, p.y, w - 1 - p.x, h - 1 - p.y);
      if (dEdge > maxEdgeDist) continue;
      const dHub = Math.hypot(p.x - hub.x, p.y - hub.y);
      const score = dHub - dEdge * 0.25;
      out.push({ x: p.x, y: p.y, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  };

  const edgeBand = Math.max(pad, band ?? pad);
  let candidates = pick(true, edgeBand);
  if (!candidates.length) candidates = pick(false, edgeBand);
  if (!candidates.length) candidates = pick(false, Math.max(edgeBand, Math.min(w, h) / 2));

  const picked = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    let ok = true;
    for (const g of picked) {
      if (Math.hypot(c.x - g.x, c.y - g.y) < minSpacing) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    picked.push({ x: c.x, y: c.y });
  }
  return picked;
}

function findNearestRoadCell({ grid, x, y, mask, maxR = 8 }) {
  if (grid.inBounds(x, y) && grid.hasRoadType(x, y, mask)) return { x, y };
  for (let r = 1; r <= maxR; r++) {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
        const nx = x + ox;
        const ny = y + oy;
        if (!grid.inBounds(nx, ny)) continue;
        if (grid.hasRoadType(nx, ny, mask)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

function bfsOnRoadMask({ grid, start, mask }) {
  const w = grid.w;
  const h = grid.h;
  const n = w * h;
  const prev = new Int32Array(n);
  prev.fill(-1);
  const qx = new Int16Array(n);
  const qy = new Int16Array(n);
  let qs = 0;
  let qe = 0;
  const sIdx = start.y * w + start.x;
  prev[sIdx] = sIdx;
  qx[qe] = start.x;
  qy[qe] = start.y;
  qe++;
  while (qs < qe) {
    const x = qx[qs];
    const y = qy[qs];
    qs++;
    const i = y * w + x;
    for (const d of DIRS_8) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (!grid.inBounds(nx, ny)) continue;
      if (!grid.hasRoadType(nx, ny, mask)) continue;
      const ni = ny * w + nx;
      if (prev[ni] !== -1) continue;
      prev[ni] = i;
      qx[qe] = nx;
      qy[qe] = ny;
      qe++;
    }
  }
  return prev;
}

function reconstructPathFromPrev(prev, w, startIdx, goalIdx) {
  if (prev[goalIdx] === -1) return null;
  const path = [];
  let cur = goalIdx;
  while (true) {
    const x = cur % w;
    const y = (cur / w) | 0;
    path.push([x, y]);
    if (cur === startIdx) break;
    cur = prev[cur];
    if (cur === -1) return null;
  }
  path.reverse();
  return path;
}

function pickGateRoadCells({ grid, hub, mask, count, pad, minSpacing, band, prev }) {
  const w = grid.w;
  const h = grid.h;
  const edgeBand = Math.max(pad, band ?? pad);
  const candidates = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dEdge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (dEdge > edgeBand) continue;
      if (!grid.hasRoadType(x, y, mask)) continue;
      const i = y * w + x;
      if (prev && prev[i] === -1) continue;
      const dHub = Math.hypot(x - hub.x, y - hub.y);
      const score = dHub - dEdge * 0.25;
      candidates.push({ x, y, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    let ok = true;
    for (const g of picked) {
      if (Math.hypot(c.x - g.x, c.y - g.y) < minSpacing) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    picked.push({ x: c.x, y: c.y });
  }
  return picked;
}

function buildLocalGridForBlocks({ grid, blocks, cfg, rng, hub, distToObs }) {
  const w = grid.w;
  const h = grid.h;
  const out = [];

  const minCells = Math.max(20, cfg.growth.localFillMinBlockCells ?? 60);
  const spacingMin = Math.max(2, cfg.growth.localGridSpacingMin ?? 3);
  const spacingMax = Math.max(spacingMin, cfg.growth.localGridSpacingMax ?? 8);
  const avoid = Math.max(0, cfg.growth.localWaterAvoidDist ?? 0);
  const diagChance = Math.max(0, Math.min(1, cfg.growth.localDiagonalChance ?? 0.22));

  const maxDist = Math.hypot(w, h);

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function boundsOf(cells) {
    let minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;
    for (const [x, y] of cells) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }

  function buildMask(cells) {
    const mask = new Uint8Array(w * h);
    for (const [x, y] of cells) {
      const i = y * w + x;
      if (avoid > 0 && distToObs) {
        const d = distToObs[i];
        if (d !== -1 && d <= avoid) continue;
      }
      mask[i] = 1;
    }
    return mask;
  }

  function extendToRoad(x, y, dx, dy, maxSteps) {
    let cx = x;
    let cy = y;
    for (let i = 0; i < maxSteps; i++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!grid.inBounds(nx, ny)) break;
      if (grid.isObstacle(nx, ny)) break;
      if (grid.hasRoadType(nx, ny, ROAD_TYPE_MASK.MAIN)) break;
      cx = nx;
      cy = ny;
      if (grid.isRoad(cx, cy)) return { x: cx, y: cy };
    }
    return { x, y };
  }

  function addRowSegments(mask, y, bounds, spacing) {
    let segStart = -1;
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const ok = mask[y * w + x] === 1;
      if (ok) {
        if (segStart === -1) segStart = x;
      } else if (segStart !== -1) {
        const len = x - segStart;
        if (len >= Math.max(6, spacing * 2)) {
          const a0 = extendToRoad(segStart, y, -1, 0, 3);
          const b0 = extendToRoad(x - 1, y, 1, 0, 3);
          const seg = [];
          for (let xx = a0.x; xx <= b0.x; xx++) seg.push([xx, y]);
          out.push(seg);
        }
        segStart = -1;
      }
    }
    if (segStart !== -1) {
      const len = bounds.maxX + 1 - segStart;
      if (len >= Math.max(6, spacing * 2)) {
        const a0 = extendToRoad(segStart, y, -1, 0, 3);
        const b0 = extendToRoad(bounds.maxX, y, 1, 0, 3);
        const seg = [];
        for (let xx = a0.x; xx <= b0.x; xx++) seg.push([xx, y]);
        out.push(seg);
      }
    }
  }

  function addColSegments(mask, x, bounds, spacing) {
    let segStart = -1;
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      const ok = mask[y * w + x] === 1;
      if (ok) {
        if (segStart === -1) segStart = y;
      } else if (segStart !== -1) {
        const len = y - segStart;
        if (len >= Math.max(6, spacing * 2)) {
          const a0 = extendToRoad(x, segStart, 0, -1, 3);
          const b0 = extendToRoad(x, y - 1, 0, 1, 3);
          const seg = [];
          for (let yy = a0.y; yy <= b0.y; yy++) seg.push([x, yy]);
          out.push(seg);
        }
        segStart = -1;
      }
    }
    if (segStart !== -1) {
      const len = bounds.maxY + 1 - segStart;
      if (len >= Math.max(6, spacing * 2)) {
        const a0 = extendToRoad(x, segStart, 0, -1, 3);
        const b0 = extendToRoad(x, bounds.maxY, 0, 1, 3);
        const seg = [];
        for (let yy = a0.y; yy <= b0.y; yy++) seg.push([x, yy]);
        out.push(seg);
      }
    }
  }

  function addDiagSegments(mask, bounds, spacing, dx, dy) {
    const starts = [];
    // sample starting points along top and left edges of the bounds
    for (let x = bounds.minX; x <= bounds.maxX; x += spacing) starts.push([x, bounds.minY]);
    for (let y = bounds.minY + spacing; y <= bounds.maxY; y += spacing) starts.push([bounds.minX, y]);

    for (const s of starts) {
      let x = s[0];
      let y = s[1];
      let seg = [];
      while (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
        const ok = mask[y * w + x] === 1;
        if (ok) {
          seg.push([x, y]);
        } else if (seg.length) {
          if (seg.length >= Math.max(6, spacing * 2)) out.push(seg);
          seg = [];
        }
        x += dx;
        y += dy;
      }
      if (seg.length >= Math.max(6, spacing * 2)) out.push(seg);
    }
  }

  for (const b of blocks) {
    if (!b?.cells?.length) continue;
    if (b.cells.length < minCells) continue;
    const bounds = boundsOf(b.cells);
    const cx = (bounds.minX + bounds.maxX) * 0.5;
    const cy = (bounds.minY + bounds.maxY) * 0.5;
    const t = clamp01(Math.hypot(cx - hub.x, cy - hub.y) / maxDist);
    const spacing = Math.max(2, Math.round(lerp(spacingMin, spacingMax, t) + (rng.f32() - 0.5) * 1.5));

    const mask = buildMask(b.cells);
    const useDiag = rng.chance(diagChance);

    if (useDiag) {
      addDiagSegments(mask, bounds, spacing, 1, 1);
      addDiagSegments(mask, bounds, spacing, 1, -1);
    } else {
      const y0 = bounds.minY + rng.int(0, Math.max(1, spacing - 1));
      for (let y = y0; y <= bounds.maxY; y += spacing) addRowSegments(mask, y, bounds, spacing);
      const x0 = bounds.minX + rng.int(0, Math.max(1, spacing - 1));
      for (let x = x0; x <= bounds.maxX; x += spacing) addColSegments(mask, x, bounds, spacing);
    }
  }

  // De-duplicate and cull micro segments.
  const cleaned = [];
  const seen = new Set();
  for (const p of out) {
    if (p.length < 2) continue;
    const k = `${p[0][0]},${p[0][1]}-${p[p.length - 1][0]},${p[p.length - 1][1]}-${p.length}`;
    if (seen.has(k)) continue;
    seen.add(k);
    cleaned.push(p);
  }
  return cleaned;
}

function createCitySimulationV2({ rng, cfg, w, h }) {
  const grid = new Grid(w, h);
  const graph = new Graph(grid);
  generateObstacles(grid, rng, cfg.fields.obstacles);

  const boundaryMask = new Uint8Array(w * h);
  const distToObs = buildDistanceToObstacles(grid);

  const hub = findNearestFree(grid, (w / 2) | 0, (h / 2) | 0, 10);
  graph.ensureNode(hub.x, hub.y);
  const meta = { w, h, cellScale: cfg.meta.cellScaleBlocks, seed: rng.seed };

  const step = Math.max(1, cfg.growth.spiralStep ?? 1);
  const waterAvoidDist = Math.max(0, cfg.growth.spiralWaterAvoidDist ?? 0);

  // SECONDARY: spiral points + kNN, routed with no intersections.
  const points = generateSpiralPoints({
    rng,
    grid,
    count: Math.max(20, cfg.growth.spiralPointCount ?? 140),
    c: Math.max(2, cfg.growth.spiralC ?? 3.2),
    step,
    noiseR: Math.max(0, cfg.growth.spiralNoiseR ?? 0.9),
    noiseTheta: Math.max(0, cfg.growth.spiralNoiseTheta ?? 0.5),
    center: hub,
    minDist: Math.max(0, cfg.growth.spiralMinDist ?? 2),
    distToObs,
    waterAvoidDist,
  });
  if (!points.some((p) => p.x === hub.x && p.y === hub.y)) points.push({ x: hub.x, y: hub.y });

  const nodeSet = new Set(points.map((p) => key(p.x, p.y)));
  const cand = buildKnnCandidates(points, Math.max(2, cfg.growth.spiralKNN ?? 5));
  const deg = new Int16Array(points.length);
  const degMax = Math.max(2, cfg.growth.spiralDegMax ?? 4);
  const occ = new Uint8Array(w * h);
  const maxEdges = Math.max(0, cfg.growth.spiralMaxEdges ?? Math.round(points.length * 1.6));

  // Route MST edges first (keeps the graph connected), then add more edges.
  const mstCand = buildMstEdgeSet(cand, points.length);
  const ordered = [];
  for (let i = 0; i < cand.length; i++) if (mstCand.has(i)) ordered.push(cand[i]);
  for (let i = 0; i < cand.length; i++) if (!mstCand.has(i)) ordered.push(cand[i]);

  const routed = [];
  for (const e of ordered) {
    if (maxEdges > 0 && routed.length >= maxEdges) break;
    if (deg[e.a] >= degMax || deg[e.b] >= degMax) continue;
    const a = points[e.a];
    const b = points[e.b];
    const paths = candidatePaths45_90(a, b, step);
    const accepted = pickShortestValidPath({
      paths,
      grid,
      occ,
      nodeSet,
      distToObs,
      waterAvoidDist,
    });
    if (!accepted) continue;
    routed.push({ a: e.a, b: e.b, d2: e.d2, path: accepted });
    markOcc(accepted, grid, occ);
    deg[e.a]++;
    deg[e.b]++;
  }

  for (let i = 0; i < routed.length; i++) {
    const e = routed[i];
    const typeName = "SECONDARY";
    markPathAsTypedRoad({ grid, cfg, typeName, path: e.path, boundaryMask });
    graph.addRoad({ type: typeName, widthCells: cfg.roadTypes[typeName].widthCells, path: e.path });
  }

  // MAIN: choose gates from boundary secondary roads and upgrade shortest paths (subset of SECONDARY).
  const mainGatePad = Math.max(2, cfg.growth.mainGatePad ?? 4);
  const mainGateCount = Math.max(3, cfg.growth.mainGateCount ?? 4);
  const mainGateMinSpacing = Math.max(4, cfg.growth.mainGateMinSpacing ?? 18);
  const mainGateSearchBand = Math.max(mainGatePad, cfg.growth.mainGateSearchBand ?? mainGatePad);

  const hubRoad = findNearestRoadCell({
    grid,
    x: hub.x,
    y: hub.y,
    mask: ROAD_TYPE_MASK.SECONDARY,
    maxR: mainGateSearchBand,
  });
  let gateList = [];
  if (hubRoad) {
    const prev = bfsOnRoadMask({ grid, start: hubRoad, mask: ROAD_TYPE_MASK.SECONDARY });
    gateList = pickGateRoadCells({
      grid,
      hub,
      mask: ROAD_TYPE_MASK.SECONDARY,
      count: mainGateCount,
      pad: mainGatePad,
      minSpacing: mainGateMinSpacing,
      band: mainGateSearchBand,
      prev,
    });
    const startIdx = hubRoad.y * w + hubRoad.x;
    for (const gate of gateList) {
      const goalIdx = gate.y * w + gate.x;
      const path = reconstructPathFromPrev(prev, w, startIdx, goalIdx);
      if (!path || path.length < 2) continue;
      markPathAsTypedRoad({ grid, cfg, typeName: "MAIN", path, boundaryMask });
      graph.addRoad({ type: "MAIN", widthCells: cfg.roadTypes.MAIN.widthCells, path });
    }
  }

  // Blocks + mandatory access connectors.
  const blocks = buildBlocksAndConnectors({ grid, graph, cfg, rng, boundaryMask });

  if (cfg.growth.enableLocalV2) {
    // LOCAL fill inside blocks (simple "Minecraft-friendly" grid).
    const localPaths = buildLocalGridForBlocks({ grid, blocks, cfg, rng, hub, distToObs });
    for (const path of localPaths) {
      // Don't overpaint MAIN; LOCAL is allowed to connect to SECONDARY/LOCAL.
      const clipped = [];
      for (const pt of path) {
        const [x, y] = pt;
        if (!grid.inBounds(x, y)) break;
        if (grid.isObstacle(x, y)) break;
        if (grid.hasRoadType(x, y, ROAD_TYPE_MASK.MAIN)) break;
        clipped.push(pt);
        if (grid.isRoad(x, y)) break;
      }
      if (clipped.length < 2) continue;
      markPathAsTypedRoad({ grid, cfg, typeName: "LOCAL", path: clipped, boundaryMask: null });
      graph.addRoad({ type: "LOCAL", widthCells: cfg.roadTypes.LOCAL.widthCells, path: clipped });
    }
  }

  const sim = {
    grid,
    graph,
    blocks,
    meta,
    stats: {},
    attraction: null,
    stage: "DONE",
    done: true,
    _boundaryMask: boundaryMask,
    _gates: gateList,
    _distToObs: distToObs,
    step() {},
  };
  return sim;
}

function createCitySimulationLegacy({ rng, cfg, w, h }) {
  const grid = new Grid(w, h);
  const graph = new Graph(grid);
  generateObstacles(grid, rng, cfg.fields.obstacles);
  const distToObs = buildDistanceToObstacles(grid);

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
    _distToObs: distToObs,
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

export function createCitySimulation({ rng, cfg, w, h }) {
  const v = cfg?.growth?.roadGenVersion ?? 1;
  if (v === 2) return createCitySimulationV2({ rng, cfg, w, h });
  return createCitySimulationLegacy({ rng, cfg, w, h });
}

export function generateCity({ rng, cfg, w, h }) {
  const sim = createCitySimulation({ rng, cfg, w, h });
  // Дожимаем до конца за один вызов (старое API).
  let guard = 0;
  while (!sim.done && guard++ < 5000) sim.step(1);
  return { grid: sim.grid, graph: sim.graph, blocks: sim.blocks, meta: sim.meta, attraction: sim.attraction };
}
