function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function generateObstacles(grid, rng, cfg) {
  const pad = cfg.borderPadding ?? 2;
  for (let x = 0; x < grid.w; x++) {
    for (let y = 0; y < grid.h; y++) {
      const nearBorder = x < pad || y < pad || x >= grid.w - pad || y >= grid.h - pad;
      if (nearBorder && rng.chance(0.10)) grid.setObstacle(x, y, 1);
    }
  }

  const lakeCount = cfg.lakeCount ?? 3;
  for (let i = 0; i < lakeCount; i++) {
    const cx = rng.int(pad + 6, grid.w - pad - 7);
    const cy = rng.int(pad + 6, grid.h - pad - 7);
    const r = rng.int(cfg.lakeRadiusMin ?? 5, cfg.lakeRadiusMax ?? 12);
    const r2 = r * r;
    const wobble = 0.25 + rng.f32() * 0.25;
    for (let y = cy - r - 2; y <= cy + r + 2; y++) {
      for (let x = cx - r - 2; x <= cx + r + 2; x++) {
        if (!grid.inBounds(x, y)) continue;
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        const jitter = 1 + wobble * (rng.f32() - 0.5);
        if (d2 <= r2 * jitter) grid.setObstacle(x, y, 1);
      }
    }
  }

  // Разрежаем случайные одиночные клетки, чтобы не создавать шум.
  for (let i = 0; i < 2; i++) {
    for (let y = 1; y < grid.h - 1; y++) {
      for (let x = 1; x < grid.w - 1; x++) {
        if (!grid.isObstacle(x, y)) continue;
        let n = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            if (grid.isObstacle(x + ox, y + oy)) n++;
          }
        }
        if (n <= 1 && rng.chance(0.70)) grid.setObstacle(x, y, 0);
      }
    }
  }

  // Гарантируем, что центр не заблокирован.
  const hx = clamp((grid.w / 2) | 0, 1, grid.w - 2);
  const hy = clamp((grid.h / 2) | 0, 1, grid.h - 2);
  for (let oy = -2; oy <= 2; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      if (grid.inBounds(hx + ox, hy + oy)) grid.setObstacle(hx + ox, hy + oy, 0);
    }
  }
}
