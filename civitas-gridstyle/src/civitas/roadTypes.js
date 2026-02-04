export const ROAD_TYPES = {
  // Minecraft-inspired palette
  MAIN: { name: "MAIN", color: "#c9c9c9" }, // stone bricks
  SECONDARY: { name: "SECONDARY", color: "#b3b3b3" }, // light stone
  LOCAL: { name: "LOCAL", color: "#9a9a9a" }, // cobble
  CONNECTOR: { name: "CONNECTOR", color: "#f3d07a" }, // path marker
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
