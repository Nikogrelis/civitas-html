export const defaultConfig = {
  meta: {
    seed: 42,
    w: 128,
    h: 128,
    cellScaleBlocks: 5,
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
      widthCells: 3,
      stepLenCells: 1,
      maxLenCells: 900,
      branchProb: 0.0,
      minSpacingParallelCells: 4,
      hardBufferCells: 6,
      snapRadiusCells: 2,
      maxNodeDegree: 4,
      // Финальная спецификация
      turnPenalty45: 0.2,
      turnPenalty90: 0.4,
      turnPenalty135: Infinity,
      diagonalBias: -0.12,
    },
    SECONDARY: {
      widthCells: 2,
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
      widthCells: 1,
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
    plazaRadiusMin: 3,
    plazaRadiusMax: 5,

    spawnSecondaryEveryMin: 8,
    spawnSecondaryEveryMax: 16,

    // SECONDARY: жёсткий minRun + cooldown
    secondaryMinRunCells: 8,
    secondaryTurnCooldownCells: 6,

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

    diagMainCountMin: 1,
    diagMainCountMax: 2,

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
