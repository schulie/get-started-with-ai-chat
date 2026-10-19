import { useRef } from "react";
import { parseChartSpec } from "./chartSpec";
import styles from "./Markdown.module.css";

const colors = ["#16685f", "#4774ad", "#b37b27", "#8c5c9c", "#bd5b4e", "#5b7f38"];

export function Chart({ source }: { source: string }) {
  const spec = parseChartSpec(source);
  const svg = useRef<SVGSVGElement>(null);
  if (!spec) return <pre className={styles.chartError}>Chart data could not be displayed. Ask JMCGPT to revise it.</pre>;
  const values = spec.data.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const y = (value: number) => 260 - ((value - min) / range) * 220;
  const step = 520 / spec.data.length;
  const total = values.reduce((sum, value) => sum + value, 0);
  let angle = -Math.PI / 2;
  const download = () => {
    if (!svg.current) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg.current)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "jmcgpt-chart.svg"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <figure className={styles.chart}>
    <figcaption>{spec.title}</figcaption>
    <svg ref={svg} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 330" role="img" aria-label={spec.title}>
      <rect width="620" height="330" fill="white" />
      <title>{spec.title}</title>
      {spec.type === "pie" ? spec.data.map((point, index) => {
        const start = angle;
        const fraction = point.value / total;
        angle += fraction * 2 * Math.PI;
        if (fraction === 0) return null;
        if (fraction >= 1) return <circle key={index} cx="230" cy="165" r="125" fill={colors[index % colors.length]} />;
        const path = `M230,165 L${230 + 125 * Math.cos(start)},${165 + 125 * Math.sin(start)} A125,125 0 ${fraction > .5 ? 1 : 0} 1 ${230 + 125 * Math.cos(angle)},${165 + 125 * Math.sin(angle)} Z`;
        return <path key={index} d={path} fill={colors[index % colors.length]}><title>{`${point.label}: ${point.value}`}</title></path>;
      }) : <>
        {[0, 1, 2, 3, 4].map((index) => {
          const value = min + range * index / 4;
          return <g key={index}><line x1="68" x2="588" y1={y(value)} y2={y(value)} stroke="#e4e9e7" />
            <text x="60" y={y(value) + 4} textAnchor="end" fontSize="11" fill="#4b5e57">{Number(value.toPrecision(4))}</text></g>;
        })}
        <line x1="68" x2="588" y1={y(0)} y2={y(0)} stroke="#64766e" />
        {spec.type === "line" && <polyline fill="none" stroke={colors[0]} strokeWidth="3" points={spec.data.map((point, index) => `${68 + step * (index + .5)},${y(point.value)}`).join(" ")} />}
        {spec.data.map((point, index) => {
          const x = 68 + step * (index + .5);
          return <g key={index}>
            {spec.type === "bar" ? <rect x={x - step * .32} y={Math.min(y(0), y(point.value))} width={step * .64} height={Math.max(1, Math.abs(y(point.value) - y(0)))} fill={colors[0]} />
              : <circle cx={x} cy={y(point.value)} r="4" fill={colors[0]} />}
            <title>{`${point.label}: ${point.value}`}</title>
            {spec.data.length <= 12 && <text x={x} y="285" textAnchor="middle" fontSize="11" fill="#273e35">{point.label.slice(0, 14)}</text>}
          </g>;
        })}
      </>}
    </svg>
    <div className={styles.chartActions}><button type="button" onClick={download}>Download SVG</button>
      <details><summary>View data</summary><table><thead><tr><th>Label</th><th>Value</th></tr></thead><tbody>
        {spec.data.map((point, index) => <tr key={index}><td>{point.label}</td><td>{point.value}</td></tr>)}
      </tbody></table></details></div>
  </figure>;
}
