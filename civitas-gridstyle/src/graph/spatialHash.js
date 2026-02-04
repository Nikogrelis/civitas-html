function cellKey(cx, cy) {
  return `${cx},${cy}`;
}

export class SpatialHash {
  constructor(cellSize = 8) {
    this.cellSize = Math.max(1, cellSize | 0);
    this.buckets = new Map();
  }

  _bucketFor(x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return cellKey(cx, cy);
  }

  clear() {
    this.buckets.clear();
  }

  add(x, y, value) {
    const k = this._bucketFor(x, y);
    let b = this.buckets.get(k);
    if (!b) {
      b = [];
      this.buckets.set(k, b);
    }
    b.push({ x, y, value });
  }

  queryRadius(x, y, r) {
    const cs = this.cellSize;
    const minCX = Math.floor((x - r) / cs);
    const maxCX = Math.floor((x + r) / cs);
    const minCY = Math.floor((y - r) / cs);
    const maxCY = Math.floor((y + r) / cs);
    const out = [];
    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const b = this.buckets.get(cellKey(cx, cy));
        if (!b) continue;
        for (const it of b) {
          const dx = it.x - x;
          const dy = it.y - y;
          if (dx * dx + dy * dy <= r * r) out.push(it);
        }
      }
    }
    return out;
  }
}
