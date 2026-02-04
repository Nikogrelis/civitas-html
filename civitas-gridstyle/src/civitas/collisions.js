export function isBlocked({ grid, x, y }) {
  if (!grid.inBounds(x, y)) return true;
  if (grid.isObstacle(x, y)) return true;
  return false;
}

export function wouldSelfCollide({ grid, x, y, allowOnRoad = false }) {
  if (!grid.inBounds(x, y)) return true;
  if (grid.isObstacle(x, y)) return true;
  if (grid.isRoad(x, y) && !allowOnRoad) return true;
  return false;
}
