export interface ChartSpec {
  type: "bar" | "line" | "pie";
  title: string;
  data: { label: string; value: number }[];
}

/** A fixed data schema is rendered as SVG; model-generated code is never executed. */
export function parseChartSpec(source: string): ChartSpec | null {
  if (source.length > 64_000) return null;
  try {
    const chart = JSON.parse(source);
    if (!chart || !["bar", "line", "pie"].includes(chart.type)
      || typeof chart.title !== "string" || chart.title.length > 160
      || !Array.isArray(chart.data) || chart.data.length < 1 || chart.data.length > 40) return null;
    const valid = chart.data.every((point: unknown) => {
      if (!point || typeof point !== "object") return false;
      const row = point as Record<string, unknown>;
      return typeof row.label === "string" && row.label.length <= 80
        && typeof row.value === "number" && Number.isFinite(row.value)
        && Math.abs(row.value) <= 1e15 && (chart.type !== "pie" || row.value >= 0);
    });
    if (!valid || (chart.type === "pie" && !chart.data.some((point: { value: number }) => point.value > 0))) return null;
    return { type: chart.type, title: chart.title, data: chart.data.map((point: { label: string; value: number }) => ({ label: point.label, value: point.value })) };
  } catch { return null; }
}
