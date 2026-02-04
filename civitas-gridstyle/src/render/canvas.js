import { ROAD_TYPES, ROAD_TYPE_MASK } from "../civitas/roadTypes.js";
import { simplifyForRender } from "../civitas/smooth.js";

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  resizeToFit(grid, cfg) {
    const cellPx = cfg.render.cellPx | 0;
    this.canvas.width = grid.w * cellPx;
    this.canvas.height = grid.h * cellPx;
  }

  cellToPx(x, y, cellPx) {
    return { px: (x + 0.5) * cellPx, py: (y + 0.5) * cellPx };
  }

  draw({ grid, graph, blocks, cfg, stage = "DONE", done = true, debug = null, secondaryMap = null }) {
    const ctx = this.ctx;
    const cellPx = cfg.render.cellPx | 0;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // PHASE 0: Background (minecraft grass)
    ctx.fillStyle = "#5a8f3b";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // PHASE 1: Obstacles / Water
    ctx.fillStyle = "rgba(52, 101, 164, 0.85)";
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (!grid.isObstacle(x, y)) continue;
        ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
      }
    }

    // PHASE 4: Blocks (subtle dirt tint under roads)
    if (blocks?.length) {
      ctx.save();
      ctx.globalAlpha = 0.10;
      for (const b of blocks) {
        const base = b.hasAccess ? "#6b4f2a" : "#7a5a33";
        ctx.fillStyle = base;
        for (const [x, y] of b.cells) {
          ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
        }
      }
      ctx.restore();
    }

    // Debug: Secondary suitability map (green = best, red = worst)
    if (debug?.showSecondaryMap && secondaryMap) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      for (let y = 0; y < grid.h; y++) {
        for (let x = 0; x < grid.w; x++) {
          const v = secondaryMap[y * grid.w + x] ?? 0;
          const r = Math.round(220 - 140 * v);
          const g = Math.round(60 + 150 * v);
          ctx.fillStyle = `rgb(${r},${g},70)`;
          ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
        }
      }
      ctx.restore();
    }

    const stageAllowsSecondary = true;
    const stageAllowsLocal = stage === "CONNECTORS" || stage === "DONE" || stage === "LOCAL" || done;

    const drawRoadsBody = (filterFn, alpha = 1.0) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      for (const road of graph.roads) {
        if (!filterFn(road)) continue;
        const style = ROAD_TYPES[road.tag === "CONNECTOR" ? "CONNECTOR" : road.type] ?? ROAD_TYPES.LOCAL;
        const pts = simplifyForRender(road.path);
        if (pts.length < 2) continue;
        ctx.strokeStyle = style.color;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const pxW = clamp(road.widthCells * cellPx * 0.70, 1.2, 18);
        ctx.lineWidth = pxW;
        ctx.beginPath();
        const p0 = this.cellToPx(pts[0][0], pts[0][1], cellPx);
        ctx.moveTo(p0.px, p0.py);
        for (let i = 1; i < pts.length; i++) {
          const p = this.cellToPx(pts[i][0], pts[i][1], cellPx);
          ctx.lineTo(p.px, p.py);
        }
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawIntersections = ({ mask, radiusPx, fillStyle, alpha = 1.0, minRoadCount = 2 }) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fillStyle;
      for (let y = 0; y < grid.h; y++) {
        for (let x = 0; x < grid.w; x++) {
          if (grid.getRoadCount(x, y) < minRoadCount) continue;
          if (!grid.hasRoadType(x, y, mask)) continue;
          const { px, py } = this.cellToPx(x, y, cellPx);
          ctx.beginPath();
          ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    };

    const drawPlazaHub = () => {
      const plaza = graph.roads.find((r) => r.tag === "PLAZA");
      if (!plaza?.path?.length) return;
      let sx = 0;
      let sy = 0;
      for (const [x, y] of plaza.path) {
        sx += x;
        sy += y;
      }
      const cx = sx / plaza.path.length;
      const cy = sy / plaza.path.length;
      const { px, py } = this.cellToPx(cx, cy, cellPx);
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = "rgba(230,230,230,0.9)";
      ctx.beginPath();
      ctx.arc(px, py, clamp(cellPx * 1.15, 4, 14), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    // ФАЗА 2: MAIN body
    drawRoadsBody((r) => r.type === "MAIN", 1.0);

    // ФАЗА 2.2: MAIN hubs
    drawPlazaHub();
    drawIntersections({
      mask: ROAD_TYPE_MASK.MAIN,
      radiusPx: clamp(cellPx * 0.75, 3.2, 10),
      fillStyle: "rgba(235,235,235,0.8)",
      alpha: 0.92,
      minRoadCount: 2,
    });

    // PHASE 3: SECONDARY body (during/after secondary growth)
    if (stageAllowsSecondary) {
      drawRoadsBody((r) => r.type === "SECONDARY", 0.95);
      // ФАЗА 3.2: SECONDARY intersections
      drawIntersections({
        mask: ROAD_TYPE_MASK.SECONDARY | ROAD_TYPE_MASK.MAIN,
        radiusPx: clamp(cellPx * 0.42, 2.0, 6),
        fillStyle: "rgba(225,225,225,0.6)",
        alpha: 0.85,
        minRoadCount: 2,
      });
    }

    // PHASE 5: LOCAL roads (during/after local growth)
    if (stageAllowsLocal) {
      drawRoadsBody((r) => r.type === "LOCAL" && r.tag !== "CONNECTOR", 0.70);
      // LOCAL intersections
      drawIntersections({
        mask: ROAD_TYPE_MASK.LOCAL,
        radiusPx: clamp(cellPx * 0.28, 1.4, 4),
        fillStyle: "rgba(210,210,210,0.45)",
        alpha: 0.65,
        minRoadCount: 2,
      });
      // Коннекторы и маркеры доступа поверх LOCAL
      drawRoadsBody((r) => r.tag === "CONNECTOR" || r.tag === "SNAP_CONNECTOR", 0.9);
    }

    // Debug overlays
    if (debug?.enabled && debug.points?.length) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = "rgba(253,224,71,0.8)";
      ctx.lineWidth = 1;
      for (const p of debug.points) {
        ctx.strokeRect(p.x * cellPx + 0.5, p.y * cellPx + 0.5, cellPx - 1, cellPx - 1);
      }
      ctx.restore();
    }
  }
}
