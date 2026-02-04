export function findSnapTarget({
  grid,
  graph,
  x,
  y,
  radiusCells,
  forbidNodeId = null,
  roadTypeMask = 0,
}) {
  const r = Math.max(1, radiusCells | 0);
  let best = null;
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const nx = x + ox;
      const ny = y + oy;
      if (!grid.inBounds(nx, ny)) continue;
      const d2 = ox * ox + oy * oy;
      if (d2 > r * r) continue;

      const nodeId = graph.getNodeIdAt(nx, ny);
      if (nodeId && nodeId !== forbidNodeId) {
        if (!best || d2 < best.d2) best = { kind: "node", nodeId, x: nx, y: ny, d2 };
      } else if (grid.isRoad(nx, ny)) {
        if (roadTypeMask) {
          const t = grid.getRoadTypeMask(nx, ny);
          if ((t & roadTypeMask) === 0) continue;
        }
        // Снап к ребру через клетку: создаём узел в точке касания.
        if (!best || d2 < best.d2) best = { kind: "roadCell", nodeId: null, x: nx, y: ny, d2 };
      }
    }
  }
  return best;
}
