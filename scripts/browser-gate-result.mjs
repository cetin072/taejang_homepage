// Inspect the rendered result node, never PASS literals embedded in fixture scripts.
export function browserGateResult(dom, marker) {
  const result = String(dom).match(/<pre\b[^>]*\bid=["']result["'][^>]*>([\s\S]*?)<\/pre>/i)?.[1]?.trim() || '';
  return { passed: result === marker || result.startsWith(marker + ':'), result };
}
