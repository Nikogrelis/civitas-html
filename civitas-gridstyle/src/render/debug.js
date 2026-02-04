export class DebugState {
  constructor() {
    this.enabled = false;
    this.points = [];
  }

  clear() {
    this.points.length = 0;
  }

  addPoint(x, y) {
    this.points.push({ x, y, t: performance.now() });
    if (this.points.length > 1200) this.points.shift();
  }
}
