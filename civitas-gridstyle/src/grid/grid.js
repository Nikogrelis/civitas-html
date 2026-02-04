import { dirToBit } from "./neighbors8.js";

export class Grid {
  constructor(w, h) {
    this.w = w | 0;
    this.h = h | 0;
    const n = (this.w * this.h) | 0;
    this.obstacle = new Uint8Array(n);
    this.road = new Uint8Array(n);
    this.roadCount = new Uint16Array(n);
    this.dirMask = new Uint16Array(n);
    // Bitmask типов дорог (MAIN/SECONDARY/LOCAL/CONNECTOR), позволяет фильтровать snap и метрики.
    this.roadTypeMask = new Uint16Array(n);

    // Жёсткие буферы (коридоры запрета) вокруг MAIN/SECONDARY.
    this.reservedMain = new Uint8Array(n);
    this.reservedSecondary = new Uint8Array(n);
  }

  idx(x, y) {
    return (y | 0) * this.w + (x | 0);
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  isObstacle(x, y) {
    return this.obstacle[this.idx(x, y)] !== 0;
  }

  setObstacle(x, y, v = 1) {
    this.obstacle[this.idx(x, y)] = v ? 1 : 0;
  }

  isRoad(x, y) {
    return this.road[this.idx(x, y)] !== 0;
  }

  markRoadCell(x, y, dirI = null, typeMask = 0) {
    const i = this.idx(x, y);
    this.road[i] = 1;
    this.roadCount[i] = (this.roadCount[i] + 1) & 0xffff;
    if (dirI !== null && dirI !== undefined) this.dirMask[i] |= dirToBit(dirI);
    if (typeMask) this.roadTypeMask[i] |= typeMask;
  }

  getRoadCount(x, y) {
    return this.roadCount[this.idx(x, y)];
  }

  getDirMask(x, y) {
    return this.dirMask[this.idx(x, y)];
  }

  getRoadTypeMask(x, y) {
    return this.roadTypeMask[this.idx(x, y)];
  }

  hasRoadType(x, y, typeMask) {
    return (this.getRoadTypeMask(x, y) & typeMask) !== 0;
  }

  clearRoadLayers() {
    this.road.fill(0);
    this.roadCount.fill(0);
    this.dirMask.fill(0);
    this.roadTypeMask.fill(0);
    this.reservedMain.fill(0);
    this.reservedSecondary.fill(0);
  }

  markReservedMainAround(x, y, r) {
    this.#markReservedAround(this.reservedMain, x, y, r);
  }

  markReservedSecondaryAround(x, y, r) {
    this.#markReservedAround(this.reservedSecondary, x, y, r);
  }

  // Резервирование боковых полос вдоль сегмента: запрещает близкие параллели,
  // но не блокирует продолжение дороги вперёд.
  markReservedMainSideBands(x, y, dirI, r) {
    this.#markReservedSideBands(this.reservedMain, x, y, dirI, r);
  }

  markReservedSecondarySideBands(x, y, dirI, r) {
    this.#markReservedSideBands(this.reservedSecondary, x, y, dirI, r);
  }

  isReservedByMain(x, y) {
    return this.reservedMain[this.idx(x, y)] !== 0;
  }

  isReservedBySecondary(x, y) {
    return this.reservedSecondary[this.idx(x, y)] !== 0;
  }

  #markReservedAround(layer, x, y, r) {
    const rr = Math.max(0, r | 0);
    for (let oy = -rr; oy <= rr; oy++) {
      for (let ox = -rr; ox <= rr; ox++) {
        const nx = x + ox;
        const ny = y + oy;
        if (!this.inBounds(nx, ny)) continue;
        layer[this.idx(nx, ny)] = 1;
      }
    }
  }

  #markReservedSideBands(layer, x, y, dirI, r) {
    const rr = Math.max(0, r | 0);
    if (dirI === null || dirI === undefined) return;
    const left = ((dirI + 2) % 8) | 0;
    const right = ((dirI + 6) % 8) | 0;
    const lx = left === 0 ? 0 : left === 2 ? 1 : left === 4 ? 0 : left === 6 ? -1 : DIRS_FALLBACK[left].dx;
    const ly = left === 0 ? -1 : left === 2 ? 0 : left === 4 ? 1 : left === 6 ? 0 : DIRS_FALLBACK[left].dy;
    const rx = right === 0 ? 0 : right === 2 ? 1 : right === 4 ? 0 : right === 6 ? -1 : DIRS_FALLBACK[right].dx;
    const ry = right === 0 ? -1 : right === 2 ? 0 : right === 4 ? 1 : right === 6 ? 0 : DIRS_FALLBACK[right].dy;

    for (let k = 1; k <= rr; k++) {
      const ax = x + lx * k;
      const ay = y + ly * k;
      if (this.inBounds(ax, ay)) layer[this.idx(ax, ay)] = 1;
      const bx = x + rx * k;
      const by = y + ry * k;
      if (this.inBounds(bx, by)) layer[this.idx(bx, by)] = 1;
    }
  }
}

// Мини-таблица направлений только для диагоналей (кардинальные закодированы вручную).
const DIRS_FALLBACK = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
];
