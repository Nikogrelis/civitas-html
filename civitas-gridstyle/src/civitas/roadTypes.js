export const ROAD_TYPES = {
  MAIN: { name: "MAIN", color: "#60a5fa" },
  SECONDARY: { name: "SECONDARY", color: "#a78bfa" },
  LOCAL: { name: "LOCAL", color: "#34d399" },
  CONNECTOR: { name: "CONNECTOR", color: "#fbbf24" },
};

export const ROAD_TYPE_ORDER = ["MAIN", "SECONDARY", "LOCAL", "CONNECTOR"];

export const ROAD_TYPE_MASK = {
  MAIN: 1 << 0,
  SECONDARY: 1 << 1,
  LOCAL: 1 << 2,
  CONNECTOR: 1 << 3,
};

export function roadTypeToMask(typeName) {
  return ROAD_TYPE_MASK[typeName] ?? 0;
}
