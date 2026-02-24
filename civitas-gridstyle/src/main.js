import { defaultConfig, parseSize, buildingPresets } from "./config.js";
import { RNG } from "./rng.js";
import { createCitySimulation } from "./civitas/grow.js";
import { CanvasRenderer } from "./render/canvas.js";
import { DebugState } from "./render/debug.js";
import { computeMetrics } from "./graph/metrics.js";
import { buildBlueprint, downloadJson } from "./export/blueprint.json.js";
import { ROAD_TYPE_MASK } from "./civitas/roadTypes.js";

function el(id) {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e;
}

function opt(id) {
  return document.getElementById(id);
}

function fmt(n, d = 3) {
  return Number.isFinite(n) ? n.toFixed(d) : "-";
}

class App {
  constructor() {
    this.canvas = el("view");
    this.renderer = new CanvasRenderer(this.canvas);
    this.debug = new DebugState();
    this.tooltip = opt("blockTooltip");

    this.cfg = structuredClone(defaultConfig);
    this.applyBuildingPreset(this.cfg.buildings?.style ?? "standard");
    this.sim = null;
    this.running = false;
    this.raf = 0;

    this.wireUI();
    this.setStageSize();
    this.generate();
  }

  setStageSize() {
    const stage = document.querySelector(".stage");
    if (!stage) return;
    const px = Math.max(320, Math.round(this.cfg.render.viewPx ?? 900));
    stage.style.setProperty("--stage-w", `${px}px`);
    stage.style.setProperty("--stage-h", `${px}px`);
  }

  applyBuildingPreset(name) {
    const preset = buildingPresets[name] ?? buildingPresets.standard;
    this.cfg.buildings = { ...this.cfg.buildings, ...preset, style: name };
  }

  wireUI() {
    el("btnGenerate").addEventListener("click", () => this.generate());
    el("btnStep").addEventListener("click", () => this.step());
    el("btnRun").addEventListener("click", () => this.run());
    el("btnStop").addEventListener("click", () => this.stop());
    el("btnExport").addEventListener("click", () => this.export());
    el("chkDebug").addEventListener("change", (e) => {
      this.debug.enabled = Boolean(e.target.checked);
      this.redraw();
    });
    opt("chkSecondaryMap")?.addEventListener("change", (e) => {
      this.debug.showSecondaryMap = Boolean(e.target.checked);
      this.redraw();
    });
    opt("zoom")?.addEventListener("input", (e) => {
      const value = Number(e.target.value);
      if (!Number.isFinite(value)) return;
      this.cfg.render.cellPx = Math.max(2, Math.round(value));
      const zoomValue = opt("zoomValue");
      if (zoomValue) zoomValue.textContent = String(this.cfg.render.cellPx);
      if (this.sim) this.renderer.resizeToFit(this.sim.grid, this.cfg);
      this.redraw();
    });
    const buildingPreset = opt("buildingPreset");
    if (buildingPreset) {
      buildingPreset.value = this.cfg.buildings?.style ?? "standard";
      buildingPreset.addEventListener("change", (e) => {
        this.applyBuildingPreset(e.target.value);
        this.generate();
      });
    }
    this.canvas.addEventListener("mousemove", (e) => this.onCanvasMove(e));
    this.canvas.addEventListener("mouseleave", () => this.hideTooltip());
  }

  buildBlockIndex() {
    if (!this.sim?.blocks?.length) return;
    const { grid, blocks } = this.sim;
    const version = blocks.length;
    if (this.sim._blockIndex?.version === version) return;

    const w = grid.w;
    const h = grid.h;
    const idByCell = new Int32Array(w * h);
    idByCell.fill(-1);
    const info = blocks.map((b) => ({
      area: b.cells.length,
      border: { MAIN: 0, SECONDARY: 0, LOCAL: 0 },
    }));

    for (let i = 0; i < blocks.length; i++) {
      for (const [x, y] of blocks[i].cells) {
        idByCell[y * w + x] = i;
      }
    }

    const dirs4 = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let i = 0; i < blocks.length; i++) {
      const meta = info[i];
      for (const [x, y] of blocks[i].cells) {
        for (const d of dirs4) {
          const nx = x + d[0];
          const ny = y + d[1];
          if (!grid.inBounds(nx, ny)) continue;
          if (!grid.isRoad(nx, ny)) continue;
          const mask = grid.getRoadTypeMask(nx, ny);
          if (mask & ROAD_TYPE_MASK.MAIN) meta.border.MAIN += 1;
          else if (mask & ROAD_TYPE_MASK.SECONDARY) meta.border.SECONDARY += 1;
          else if (mask & ROAD_TYPE_MASK.LOCAL) meta.border.LOCAL += 1;
        }
      }
    }

    this.sim._blockIndex = { idByCell, info, version };
  }

  hideTooltip() {
    if (!this.tooltip) return;
    this.tooltip.classList.add("hidden");
  }

  onCanvasMove(e) {
    if (!this.sim?.blocks?.length || !this.tooltip) return;
    this.buildBlockIndex();
    const idx = this.sim._blockIndex;
    if (!idx) return;

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const cellPx = this.cfg.render.cellPx | 0;
    const x = Math.floor(px / cellPx);
    const y = Math.floor(py / cellPx);
    if (!this.sim.grid.inBounds(x, y)) {
      this.hideTooltip();
      return;
    }
    const blockId = idx.idByCell[y * this.sim.grid.w + x];
    if (blockId < 0) {
      this.hideTooltip();
      return;
    }
    const meta = idx.info[blockId];
    const total =
      meta.border.MAIN + meta.border.SECONDARY + meta.border.LOCAL;
    this.tooltip.textContent =
      `Zone #${blockId}\n` +
      `Area: ${meta.area} m²\n` +
      `Border: MAIN ${meta.border.MAIN} m, SECONDARY ${meta.border.SECONDARY} m, LOCAL ${meta.border.LOCAL} m\n` +
      `Total road edge: ${total} m`;
    this.tooltip.style.left = `${e.clientX + 12}px`;
    this.tooltip.style.top = `${e.clientY + 12}px`;
    this.tooltip.classList.remove("hidden");
  }

  readInputs() {
    const seedText = el("seed").value.trim();
    const { w, h } = parseSize(el("size").value, this.cfg.meta.w, this.cfg.meta.h);
    this.cfg.meta.seed = seedText || this.cfg.meta.seed;
    this.cfg.meta.w = w;
    this.cfg.meta.h = h;

    const maxMainRoads = Number(opt("dbgMaxMainRoads")?.value ?? this.cfg.growth.maxMainRoads);
    const minEdge = Number(opt("dbgMinEdge")?.value ?? this.cfg.growth.secondaryBoundaryMinDistEdge);
    const minWater = Number(opt("dbgMinWater")?.value ?? this.cfg.growth.secondaryBoundaryMinDistObstacle);
    const minMain = Number(opt("dbgMinMain")?.value ?? this.cfg.growth.secondaryBoundaryMinDistMain);
    const secondaryHeatMin = Number(opt("dbgSecondaryHeatMin")?.value ?? this.cfg.growth.secondaryHeatMin);
    const secondaryNoise = Number(opt("dbgSecondaryNoise")?.value ?? this.cfg.growth.secondaryNoiseScale);
    const localHeatMin = Number(opt("dbgLocalHeatMin")?.value ?? this.cfg.growth.localHeatMin);
    const localNoise = Number(opt("dbgLocalNoise")?.value ?? this.cfg.growth.localNoiseScale);
    const cityRadiusX = Number(opt("dbgCityRadiusX")?.value ?? this.cfg.growth.cityMaskRadiusX);
    const cityRadiusY = Number(opt("dbgCityRadiusY")?.value ?? this.cfg.growth.cityMaskRadiusY);
    const viewPx = Number(this.cfg.render.viewPx ?? 900);
    const zoom = Number(opt("zoom")?.value ?? this.cfg.render.cellPx);
    if (Number.isFinite(maxMainRoads)) this.cfg.growth.maxMainRoads = Math.max(4, Math.round(maxMainRoads));
    if (Number.isFinite(minEdge)) this.cfg.growth.secondaryBoundaryMinDistEdge = Math.max(0, Math.round(minEdge));
    if (Number.isFinite(minWater)) this.cfg.growth.secondaryBoundaryMinDistObstacle = Math.max(0, Math.round(minWater));
    if (Number.isFinite(minMain)) this.cfg.growth.secondaryBoundaryMinDistMain = Math.max(0, Math.round(minMain));
    if (Number.isFinite(secondaryHeatMin)) this.cfg.growth.secondaryHeatMin = Math.max(0, Math.min(1, secondaryHeatMin));
    if (Number.isFinite(secondaryNoise)) this.cfg.growth.secondaryNoiseScale = Math.max(4, Math.round(secondaryNoise));
    if (Number.isFinite(localHeatMin)) this.cfg.growth.localHeatMin = Math.max(0, Math.min(1, localHeatMin));
    if (Number.isFinite(localNoise)) this.cfg.growth.localNoiseScale = Math.max(4, Math.round(localNoise));
    if (Number.isFinite(cityRadiusX)) this.cfg.growth.cityMaskRadiusX = Math.max(0.5, Math.min(1, cityRadiusX));
    if (Number.isFinite(cityRadiusY)) this.cfg.growth.cityMaskRadiusY = Math.max(0.5, Math.min(1, cityRadiusY));
    if (Number.isFinite(zoom)) this.cfg.render.cellPx = Math.max(2, Math.round(zoom));
    const zoomValue = opt("zoomValue");
    if (zoomValue) zoomValue.textContent = String(this.cfg.render.cellPx);
    if (Number.isFinite(viewPx)) this.cfg.render.viewPx = Math.max(320, Math.round(viewPx));
    this.setStageSize();
  }

  generate() {
    this.stop();
    this.readInputs();
    const rng = new RNG(this.cfg.meta.seed);
    this.sim = createCitySimulation({ rng, cfg: this.cfg, w: this.cfg.meta.w, h: this.cfg.meta.h });
    // Один шаг, чтобы показать старт, но не «дожимать» всё сразу.
    this.sim.step(1);
    this.renderer.resizeToFit(this.sim.grid, this.cfg);
    this.redraw();
  }

  step() {
    if (!this.sim) return;
    this.sim.step(1);
    this.redraw();
  }

  run() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      if (this.sim && !this.sim.done) this.sim.step(1);
      else this.stop();
      this.raf = requestAnimationFrame(loop);
      this.redraw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  export() {
    if (!this.sim) return;
    const blueprint = buildBlueprint({ meta: this.sim.meta, graph: this.sim.graph, blocks: this.sim.blocks });
    downloadJson(`civitas-gridstyle_${this.sim.meta.w}x${this.sim.meta.h}_seed-${this.sim.meta.seed}.json`, blueprint);
  }

  redraw() {
    if (!this.sim) return;
    this.renderer.resizeToFit(this.sim.grid, this.cfg);
    const m = computeMetrics({ grid: this.sim.grid, graph: this.sim.graph, cfg: this.cfg });
    const counts = { MAIN: 0, SECONDARY: 0, LOCAL: 0 };
    for (const r of this.sim.graph.roads) {
      if (counts[r.type] !== undefined) counts[r.type]++;
    }
    const gateCount = this.sim._gates?.length ?? 0;
    const stage = document.querySelector(".stage");
    const stageW = stage ? stage.clientWidth : 0;
    const stageH = stage ? stage.clientHeight : 0;
    el("metrics").textContent = [
      `seed: ${this.sim.meta.seed}`,
      `w,h: ${this.sim.meta.w}×${this.sim.meta.h} cells (scale=${this.sim.meta.cellScale} blocks/cell)`,
      `gates: ${gateCount}   roadsByType: M=${counts.MAIN} S=${counts.SECONDARY} L=${counts.LOCAL}`,
      `cellPx: ${this.cfg.render.cellPx}   canvas: ${this.canvas.width}x${this.canvas.height} px   stage: ${stageW}x${stageH} px`,
      `roads: ${m.roadsCount}   nodes: ${m.nodesCount}`,
      `non45Segments: ${m.non45Segments} (must be 0)`,
      `intersectionsCount: ${m.intersectionsCount}`,
      `avgDetour (MAIN): ${fmt(m.avgDetour, 2)}`,
      `turnsPer100Cells (SECONDARY): ${fmt(m.turnsPer100CellsSecondary, 1)}`,
      `avgRunLen (SECONDARY): ${fmt(m.avgRunLenSecondary, 2)}`,
      `%diagonalSteps (SECONDARY): ${fmt(m.diagonalStepsSecondaryPct, 1)}%`,
      `parallelViolations: ${m.parallelViolations}`,
      `secondarySeedsPlanned: ${this.sim.stats?.secondarySeedsPlanned ?? "-"}`,
      `secondarySeedsRejectedSpacing: ${this.sim.stats?.secondarySeedsRejectedSpacing ?? "-"}`,
      `secondarySeedsSpawned: ${this.sim.stats?.secondarySeedsSpawned ?? "-"}`,
      `secondaryBranchesTerminatedAtStep0: ${this.sim.stats?.secondaryBranchesTerminatedAtStep0 ?? "-"}`,
      `connectorStaircaseRate: ${fmt(m.connectorStaircaseRate, 3)} (avgTurns=${fmt(m.avgConnectorTurns, 2)})`,
      `stage: ${this.sim.stage}${this.sim.done ? " (done)" : ""}`,
    ].join("\n");

    this.renderer.draw({
      grid: this.sim.grid,
      graph: this.sim.graph,
      blocks: this.sim.blocks,
      buildings: this.sim.buildings ?? null,
      plazas: this.sim.plazas ?? null,
      farms: this.sim.farms ?? null,
      cfg: this.cfg,
      stage: this.sim.stage,
      done: this.sim.done,
      debug: this.debug,
      secondaryMap: this.sim._secondaryHeatMap,
      gates: this.sim._gates ?? null,
    });
  }
}

window.app = new App();
