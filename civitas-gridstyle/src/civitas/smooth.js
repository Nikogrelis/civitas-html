import { dirIndexDelta, DIRS_8 } from "../grid/neighbors8.js";

function dirIndexFromStep(dx, dy) {
  for (const d of DIRS_8) {
    if (d.dx === dx && d.dy === dy) return d.i;
  }
  return null;
}

export function antiZigZagReorder(path, grid) {
  if (path.length < 4) return path;
  const out = [path[0]];

  for (let i = 1; i < path.length - 2; i++) {
    const p0 = out[out.length - 1];
    const p1 = path[i];
    const p2 = path[i + 1];
    const p3 = path[i + 2];
    const dA = dirIndexFromStep(p1[0] - p0[0], p1[1] - p0[1]);
    const dB = dirIndexFromStep(p2[0] - p1[0], p2[1] - p1[1]);
    const dC = dirIndexFromStep(p3[0] - p2[0], p3[1] - p2[1]);
    if (dA === null || dB === null || dC === null) {
      out.push(p1);
      continue;
    }

    // Паттерн A, B, A (микро-зигзаг). Переставляем в A, A, B если это не ломает препятствия.
    if (dA === dC && dA !== dB && dirIndexDelta(dA, dB) === 1) {
      const d = DIRS_8[dA];
      const dd = DIRS_8[dB];
      const s1 = [p0[0] + d.dx, p0[1] + d.dy];
      const s2 = [p0[0] + 2 * d.dx, p0[1] + 2 * d.dy];
      const s3 = [s2[0] + dd.dx, s2[1] + dd.dy];
      const endpointSame = s3[0] === p3[0] && s3[1] === p3[1];
      if (
        endpointSame &&
        grid.inBounds(s1[0], s1[1]) &&
        grid.inBounds(s2[0], s2[1]) &&
        !grid.isObstacle(s1[0], s1[1]) &&
        !grid.isObstacle(s2[0], s2[1])
      ) {
        out.push(s1, s2);
        i += 1; // пропускаем p1/p2, дальше обработаем p3 на следующем шаге
        continue;
      }
    }

    out.push(p1);
  }

  out.push(path[path.length - 2], path[path.length - 1]);
  // Убираем дубликаты подряд
  const compact = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const a = compact[compact.length - 1];
    const b = out[i];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    compact.push(b);
  }
  return compact;
}

export function simplifyForRender(path) {
  if (path.length <= 2) return path;
  const out = [path[0]];
  let prevDx = path[1][0] - path[0][0];
  let prevDy = path[1][1] - path[0][1];
  for (let i = 2; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    if (dx !== prevDx || dy !== prevDy) out.push(path[i - 1]);
    prevDx = dx;
    prevDy = dy;
  }
  out.push(path[path.length - 1]);
  return out;
}
