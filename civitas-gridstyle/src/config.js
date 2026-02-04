export const defaultConfig = {
  meta: {
    seed: 42,
    w: 128,
    h: 128,
    cellScaleBlocks: 1,
  },

  render: {
    cellPx: 6,
    showGrid: false,
  },

  fields: {
    obstacles: {
      lakeCount: 4,
      lakeRadiusMin: 6,
      lakeRadiusMax: 14,
      borderPadding: 3,
    },
    height: {
      enabled: false,
      slopeWeight: 0.0,
    },
    attraction: {
      hubWeight: 0.8,
      gateWeight: 0.45,
    },
  },

  gridStyle: {
    hard8Dirs: true,
    forbidBacktrack: true,
    allow135: false,
  },

  weights: {
    alphaCost: 1.0,
    betaTurn: 1.0,
    gammaRepel: 1.0,
    deltaGoal: 1.0,
  },

  roadTypes: {
    MAIN: {
      widthCells: 15,
      stepLenCells: 1,
      maxLenCells: 900,
      branchProb: 0.0,
      minSpacingParallelCells: 4,
      hardBufferCells: 6,
      snapRadiusCells: 2,
      maxNodeDegree: 4,
      // Финальная спецификация
      turnPenalty45: 0.6,
      turnPenalty90: 1.2,
      turnPenalty135: Infinity,
      diagonalBias: 0.05,
    },
    SECONDARY: {
      widthCells: 10,
      stepLenCells: 1,
      maxLenCells: 70,
      branchProb: 0.0,
      minSpacingParallelCells: 5,
      hardBufferCells: 5,
      snapRadiusCells: 3,
      maxNodeDegree: 4,
      // Финальная спецификация
      turnPenalty45: 1.0,
      turnPenalty90: 0.2,
      turnPenalty135: Infinity,
      diagonalBias: 0.18,
    },
    LOCAL: {
      widthCells: 5,
      stepLenCells: 1,
      maxLenCells: 18,
      branchProb: 0.0,
      minSpacingParallelCells: 7,
      snapRadiusCells: 2,
      maxNodeDegree: 3,
      // Финальная спецификация
      turnPenalty45: 0.3,
      turnPenalty90: 0.3,
      turnPenalty135: Infinity,
      diagonalBias: 0.0,
    },
  },

  growth: {
    roadGenVersion: 2,
    plazaRadiusMin: 3,
    plazaRadiusMax: 5,

    // RoadGen v2: spiral point cloud + 45/90 routing
    // Less dense default: fewer points + more spacing (1 cell = 1 meter)
    spiralPointCount: 48,
    spiralC: 8.0,
    spiralStep: 1,
    spiralNoiseR: 0.9,
    spiralNoiseTheta: 0.5,
    spiralMinDist: 12,
    spiralKNN: 3,
    spiralDegMax: 3,
    spiralMainLongEdges: 4,
    spiralWaterAvoidDist: 8,
    spiralMaxEdges: 70,
    mainGateCount: 4,
    mainAllowDiagonals: false,
    mainGatePad: 4,
    mainNoiseScale: 10,
    mainNoiseWeight: 0.08,
    mainWaterPenaltyDist: 6,
    mainWaterPenaltyWeight: 0.6,
    mainGateMinSpacing: 18,
    mainRoadAttractWeight: 0.12,
    mainGateSearchBand: 16,
    enableLocalV2: false,

    // RoadGen v2: LOCAL fill
    localFillMinBlockCells: 1400,
    localGridSpacingMin: 18,
    localGridSpacingMax: 26,
    localDiagonalChance: 0.1,

    spawnSecondaryEveryMin: 8,
    spawnSecondaryEveryMax: 16,

    // SECONDARY: жёсткий minRun + cooldown
    secondaryMinRunCells: 6,
    secondaryTurnCooldownCells: 6,
    secondaryGraceSteps: 8,

    // SECONDARY (block boundaries): фильтры границ
    secondaryBoundaryMinDistEdge: 3,
    secondaryBoundaryMinDistObstacle: 2,
    secondaryBoundaryMinDistMain: 2,

    // SECONDARY: тепловая карта + целевая логика
    secondaryHubMinDist: 3,
    secondarySeedOffsetCells: 3,
    secondarySeedHeatPower: 1.6,
    secondaryHeatMin: 0.2,
    secondaryHeatStepWeight: 1.0,
    secondaryDistRecalcEvery: 80,

    secondarySecTargetDist: 14,
    secondaryCloseDist: 32,
    secondaryMainBandDist: 12,

    secondaryWeightCoverage: 1.0,
    secondaryWeightClose: 1.0,
    secondaryProgressWeight: 0.4,
    secondaryWeightObs: 1.0,
    secondaryWeightEdge: 0.7,
    secondaryWeightParallel: 1.2,
    secondaryWeightCrowd: 1.0,
    secondaryWeightNoise: 0.2,

    secondaryNoiseScale: 14,

    cityMaskRadiusX: 1.0,
    cityMaskRadiusY: 1.0,

    // SECONDARY: штраф параллельности MAIN с затуханием
    secondaryParallelPenaltySteps: 18,
    secondaryParallelPenaltyStrength: 8.0,
    secondaryParallelPenaltyRadius: 3,
    secondaryMainAttractStrength: 0.25,

    // SECONDARY: сидинг по площади (seeds на 1000 клеток карты)
    secondarySeedDensityPer1000: 6,
    secondarySeedMax: 220,

    // SECONDARY: умеренная длина веток (target < max)
    secondaryLenTargetMean: 34,
    secondaryLenTargetMin: 22,

    // SECONDARY: диагонали по умолчанию выключены (аварийный бюджет)
    secondaryAllowDiagonals: false,
    secondaryDiagEscapeBudget: 4,
    secondaryDiagMainInfluenceDist: 3,
    secondaryMaxDiagClosureSteps: 6,

    localLenMin: 6,
    localLenMax: 14,
    localCountTarget: 160,
    localZoneSize: 10,
    localZoneThreshold: 0.2,
    localHeatMin: 0.25,
    localSeedHeatPower: 1.2,
    localHeatStepWeight: 1.0,
    localNoiseScale: 10,
    localNoiseWeight: 0.55,
    localMainForbiddenRadius: 4,
    localRoadSpaceDist: 8,
    localWeightZone: 0.6,
    localWeightSpace: 0.7,

    diagMainCountMin: 1,
    diagMainCountMax: 2,
    diagMainMaxRadius: 52,
    maxMainRoads: 6,

    // MAIN skeleton
    mainRingNodesMin: 4,
    mainRingNodesMax: 6,
    mainRingRadiusMin: 14,
    mainRingRadiusMax: 26,
    mainEdgeNodesMin: 3,
    mainEdgeNodesMax: 5,

    // SECONDARY by districts
    secondaryDistrictMinCells: 30,
    secondaryGateMin: 1,
    secondaryGateMax: 3,
    secondaryGateMinSpacing: 8,
    secondaryGateWeightCorner: 1.0,
    secondaryGateWeightSep: 0.8,
    secondaryGateWeightObs: 0.6,
    secondaryGateObsAvoidDist: 2,
    secondaryLoopDist: 10,
    secondaryLoopBand: 1,
    secondaryLoopDistScale: 0.18,
    secondaryLoopDownsample: 2,
    secondaryRewardMinScore: 0.22,
    secondaryRewardStraightWeight: 0.6,
    secondaryRewardRightWeight: 0.5,
    secondaryRewardDiagPenalty: 0.6,
    secondaryRewardBandWeight: 0.9,
    secondaryRewardLengthWeight: 0.45,
    secondaryRewardBandSigma: 8,
    secondaryMaxPathsTotal: 240,
    secondaryMaxPathsPerDistrict: 24,
    secondaryCorridorMaxPerDistrict: 2,
    secondaryJunctionRadius: 2,
    secondaryMinPathLen: 6,
    secondarySubcenterCountMin: 1,
    secondarySubcenterCountMax: 6,
    secondarySubcenterMinDist: 5,
    secondaryCorridorSpacingCells: 8,
    secondaryCorridorMaxLines: 16,

    // LOCAL block fill
    localGridSpacingCells: 3,
    localGridSpacingCenter: 2,
    localGridSpacingOuter: 6,
    localGridMinBlockCells: 8,
    localOffsetEvery: 2,
    localOffsetAmount: 1,
    localWarpStrength: 0.15,
    localWarpNoiseScale: 10,
    localWaterEdgeDist: 2,
    localWaterAvoidDist: 3,
    localWaterEdgeBand: 4,
    localWaterStubLen: 6,
    localWaterRingEvery: 3,
    localLineSkipCenter: 0.06,
    localLineSkipOuter: 0.25,
    localBlockSpacingJitter: 2,
    localBlockSkipJitter: 0.12,
    localOldTownRadius: 18,
    localSuburbRadius: 36,

    // Grid patches (mosaic)
    gridPatchMin: 2,
    gridPatchMax: 5,
    gridPatchSpacingMin: 2,
    gridPatchSpacingMax: 6,
    gridPatchDiagonalChance: 0.28,
    gridPatchDiagInfluenceDist: 14,
    gridPatchWarpMin: 0.1,
    gridPatchWarpMax: 0.5,

    // Сколько микро-шагов делать за один sim.step(1)
    microBudgetPerStep: 36,

    maxGrowIterations: 3200,
    maxBranches: 2000,
  },
};

export function parseSize(text, fallbackW, fallbackH) {
  const m = /^\s*(\d+)\s*[xх]\s*(\d+)\s*$/i.exec(text);
  if (!m) return { w: fallbackW, h: fallbackH };
  return { w: Math.max(16, Number(m[1]) | 0), h: Math.max(16, Number(m[2]) | 0) };
}
