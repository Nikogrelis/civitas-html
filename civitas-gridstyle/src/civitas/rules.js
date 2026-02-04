export function canAttachNode(graph, nodeId, maxDegree) {
  const n = graph.nodes.get(nodeId);
  if (!n) return true;
  return n.degree < maxDegree;
}
