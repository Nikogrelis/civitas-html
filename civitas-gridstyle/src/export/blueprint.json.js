export function buildBlueprint({ meta, graph, blocks }) {
  const roads = graph.roads.map((r) => ({
    type: r.tag === "CONNECTOR" ? "LOCAL" : r.type,
    widthCells: r.widthCells,
    path: r.path,
    tag: r.tag ?? undefined,
  }));

  const nodes = Array.from(graph.nodes.values()).map((n) => [n.x, n.y]);
  const blocksOut = (blocks ?? []).map((b) => ({ id: b.id, cells: b.cells, hasAccess: b.hasAccess }));
  return {
    meta,
    roads,
    blocks: blocksOut,
    nodes,
  };
}

export function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
