function key(x, y) {
  return `${x},${y}`;
}

export class Graph {
  constructor(grid) {
    this.grid = grid;
    this.nodes = new Map();
    this.nodeByCell = new Map();
    this.roads = [];
    this._nextNodeId = 1;
    this._nextRoadId = 1;
  }

  getNodeIdAt(x, y) {
    return this.nodeByCell.get(key(x, y)) ?? null;
  }

  ensureNode(x, y) {
    const k = key(x, y);
    const existing = this.nodeByCell.get(k);
    if (existing) return existing;

    const id = this._nextNodeId++;
    this.nodeByCell.set(k, id);
    this.nodes.set(id, { id, x, y, degree: 0 });
    return id;
  }

  incDegree(nodeId, delta = 1) {
    const n = this.nodes.get(nodeId);
    if (!n) return;
    n.degree += delta;
  }

  addRoad({ type, widthCells, path, tag = null }) {
    const id = this._nextRoadId++;
    const road = { id, type, widthCells, path, tag };
    this.roads.push(road);

    if (path.length) {
      const a = this.ensureNode(path[0][0], path[0][1]);
      const b = this.ensureNode(path[path.length - 1][0], path[path.length - 1][1]);
      this.incDegree(a, 1);
      if (b !== a) this.incDegree(b, 1);
    }
    return road;
  }
}
