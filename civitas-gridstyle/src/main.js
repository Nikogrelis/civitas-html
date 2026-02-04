import { defaultConfig, parseSize } from "./config.js";
import { RNG } from "./rng.js";
import { createCitySimulation } from "./civitas/grow.js";
import { CanvasRenderer } from "./render/canvas.js";
import { DebugState } from "./render/debug.js";
import { computeMetrics } from "./graph/metrics.js";
import { buildBlueprint, downloadJson } from "./export/blueprint.json.js";

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

    this.cfg = structuredClone(defaultConfig);
    this.sim = null;
    this.running = false;
    this.raf = 0;

    this.wireUI();
    this.generate();
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
    const m = computeMetrics({ grid: this.sim.grid, graph: this.sim.graph, cfg: this.cfg });
    el("metrics").textContent = [
      `seed: ${this.sim.meta.seed}`,
      `w,h: ${this.sim.meta.w}×${this.sim.meta.h} cells (scale=${this.sim.meta.cellScale} blocks/cell)`,
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
      cfg: this.cfg,
      stage: this.sim.stage,
      done: this.sim.done,
      debug: this.debug,
      secondaryMap: this.sim._secondaryHeatMap,
    });
  }
}

window.app = new App();
