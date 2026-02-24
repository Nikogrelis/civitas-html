# RoadGen v2 Guide (CIVITAS GridStyle 45/90)

This document explains the current generation pipeline, the main methods, and
where to find them in the codebase. It is written for developers working on
`civitas-gridstyle`.

## Scale & Units

- 1 cell = 1 block = 1 meter (when `meta.cellScaleBlocks = 1`).
- Road widths are in **cells**, then multiplied by `render.cellPx` for canvas.
- Buildings and farms are **cell sets** (discrete grid fill).

## High-Level Pipeline

1. **Obstacles** (water/void) are generated.
2. **Secondary road graph** is generated from a spiral point cloud.
3. **Main roads** are derived as shortest paths over Secondary to selected gates.
4. **Blocks (districts)** are extracted from the road network.
5. **Local roads** fill blocks (optional).
6. **Buildings / plazas / farms** are placed inside blocks.
7. **Render** all layers with styles and debug overlays.

## Algorithm Details

### 1) Spiral Point Cloud (Secondary skeleton)

**Goal:** produce an even but center-dense set of points.

- Method: Vogel (Fermat) spiral with slight noise.
- Points are quantized to grid (`step`).
- `k`-NN creates candidate edges.
- Edges are routed with **45/90 shortest-bend paths**.
- New segments are rejected if they would intersect existing segments (occupancy).

**Files:**
- `src/civitas/grow.js`
  - `generateSpiralPoints`
  - `buildKnnCandidates`
  - `candidatePaths45_90`
  - `pickShortestValidPath`
  - `markOcc`

### 2) Secondary Roads

**Goal:** produce the base road network without crossings.

- Iterate candidate edges sorted by distance.
- Enforce `degMax` per node.
- Accept shortest valid path (no obstacles, no intersections).
- Paint the accepted path as `SECONDARY`.

**Files:**
- `src/civitas/grow.js` (in `createCitySimulationV2`)
- `src/civitas/roadTypes.js` (road types)

### 3) Main Roads via Gates

**Goal:** derive MAIN from SECONDARY (not drawn separately).

- Gate candidates are boundary secondary road cells.
- Pick gates with spacing constraints.
- Run BFS on secondary roads from hub.
- Upgrade the **shortest path** from hub to each gate to `MAIN`.

**Files:**
- `src/civitas/grow.js`
  - `gateCandidates`
  - `findNearestRoadCell`
  - `bfsOnRoadMask`
  - `pickGateRoadCells`
  - `reconstructPathFromPrev`

### 4) Blocks / Districts

**Goal:** split the map into buildable zones.

- Flood fill inside buildable space.
- Roads and obstacles are treated as barriers.
- Each block stores its cell list and access flags.

**Files:**
- `src/civitas/blocks.js`
  - `buildBlocksAndConnectors`

### 5) Local Roads (optional)

**Goal:** simple block-internal grid fill (Minecraft-ready).

- Generates lines based on spacing and diagonal chance.
- Clipped so it does not override MAIN.

**Files:**
- `src/civitas/grow.js`
  - `buildLocalGridForBlocks`

### 6) Buildings, Plazas, Farms

**Goal:** fill blocks as densely as possible, respecting road frontage.

Core ideas:
- Only place on buildable mask (no roads/obstacles).
- Frontage constraint: min length facing road.
- Multiple passes:
  - regular buildings
  - dense fill
  - micro fill (small rectangles)
- Belgian preset uses a **road-frontage band** (perimeter block idea).

Small blocks:
- if `< smallLotArea` -> plaza (purple).

Farms:
- edge blocks are subdivided into multiple rectangular plots.
- plots get a random "tone" for varied colors.

**Files:**
- `src/civitas/grow.js`
  - `buildBuildingPlans`
  - `buildDistanceToRoads`
- `src/render/canvas.js` (colors)

## Presets

There are 2 presets: **Standard** and **Belgian**.

- Belgian uses smaller house widths, deeper rows, and a road-frontage band.
- Standard uses a more neutral distribution.

**Files:**
- `src/config.js`
  - `defaultConfig.buildings`
  - `buildingPresets`
- `src/main.js`
  - `applyBuildingPreset`
  - UI dropdown in `index.html`

## UI Controls

Controls live in the top bar and debug panel.

**Files:**
- `index.html` (controls + layout)
- `src/main.js` (wire up events)
- `src/render/debug.js` (debug overlays)

## Rendering

Layer order:
1. Background (grass)
2. Obstacles (water)
3. Blocks (colored regions)
4. Farms (brownish fields)
5. Plazas (purple)
6. Buildings (brown)
7. Roads (with width and casing)
8. Gates (brown squares)
9. Debug heatmap (optional)

**Files:**
- `src/render/canvas.js`

## File Map (Where to Change What)

- `src/civitas/grow.js`
  - **Core generation** for V2 roads, gates, blocks, local, buildings.
  - Most algorithm changes happen here.
- `src/civitas/blocks.js`
  - Block/district building logic and connectors.
- `src/civitas/roadTypes.js`
  - Road widths, tags, render colors.
- `src/config.js`
  - All tunable parameters (buildings, farms, growth, render).
  - Presets (Standard/Belgian).
- `src/render/canvas.js`
  - Colors and drawing styles for roads, zones, buildings, farms.
- `src/render/debug.js`
  - Secondary heatmap, debug overlays.
- `src/main.js`
  - UI wiring, apply preset, re-generate.
- `src/graph/*`
  - Graph structure, metrics, path helpers.
- `src/export/blueprint.json.js`
  - Export format for external tools.

## Common Tuning Knobs

Roads:
- `growth.spiralPointCount`
- `growth.spiralC`
- `growth.spiralKNN`
- `growth.spiralDegMax`
- `growth.spiralMaxEdges`
- `growth.mainGateCount`
- `growth.mainGateMinSpacing`

Buildings:
- `buildings.coverageTarget`
- `buildings.maxAttemptsPerBlock`
- `buildings.minFrontage`
- `buildings.houseWidth/Depth*`
- `buildings.rowWidth/Depth*`
- `buildings.roadBufferExtra`

Farms:
- `buildings.farmEdgeBand`
- `buildings.farmMinArea`
- `buildings.farmPlotWidth/Height*`

## Known Limitations

- Building fill is greedy (not optimal); can leave holes.
- No global optimization for road straightness.
- Blocks are grid-based; tiny artifacts may appear on diagonals.
- Large map sizes may require higher `spiralPointCount` to keep gate coverage.

## Quick Debug Checklist

- If no MAIN on larger maps:
  - check `growth.mainGateSearchBand`, `mainGateCount`, `spiralPointCount`.
- If buildings appear sparse:
  - increase `buildings.coverageTarget`, `maxAttemptsPerBlock`.
- If roads overlap too much:
  - reduce `spiralMaxEdges`, increase `spiralMinDist`.


