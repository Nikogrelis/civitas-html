export function buildAttraction({ hub, gates }) {
  return { hub, gates };
}

export function goalBiasToPoint({ x, y }, target, strength = 1.0) {
  const dx = target.x - x;
  const dy = target.y - y;
  const d = Math.hypot(dx, dy) || 1;
  return { dx: dx / d, dy: dy / d, strength };
}
