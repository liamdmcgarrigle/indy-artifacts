/**
 * A small drawing of each chart kind for the builder's picker, in the current
 * text color so it follows the theme and the selected state.
 */
const W = 36;
const H = 26;

function Bars({ values, horizontal }: { values: number[]; horizontal?: boolean }) {
  const n = values.length;
  const slot = (horizontal ? H - 4 : W - 4) / n;
  return (
    <>
      {values.map((v, i) =>
        horizontal ? (
          <rect key={i} x={2} y={2 + i * slot + slot * 0.18} width={v * (W - 4)} height={slot * 0.64} rx={1.2} />
        ) : (
          <rect key={i} x={2 + i * slot + slot * 0.18} y={H - 2 - v * (H - 4)} width={slot * 0.64} height={v * (H - 4)} rx={1.2} />
        ),
      )}
    </>
  );
}

const line = (points: [number, number][]) => points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");

const DRAWINGS: Record<string, React.ReactNode> = {
  bar: <Bars values={[0.45, 0.8, 0.6, 0.95]} />,
  barh: <Bars values={[0.95, 0.7, 0.5, 0.3]} horizontal />,
  stacked: (
    <>
      <Bars values={[0.5, 0.75, 0.6, 0.9]} />
      <g opacity={0.45}>
        <Bars values={[0.25, 0.35, 0.3, 0.45]} />
      </g>
    </>
  ),
  percent: (
    <>
      <g opacity={0.4}>
        <Bars values={[1, 1, 1, 1]} />
      </g>
      <Bars values={[0.55, 0.35, 0.7, 0.45]} />
    </>
  ),
  range: (
    <>
      <rect x={4} y={4} width={14} height={4} rx={1.5} />
      <rect x={10} y={11} width={20} height={4} rx={1.5} />
      <rect x={24} y={18} width={9} height={4} rx={1.5} />
    </>
  ),
  line: <path d={line([[2, 20], [10, 14], [18, 16], [26, 7], [34, 9]])} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  area: (
    <>
      <path d={`${line([[2, 20], [10, 13], [18, 15], [26, 7], [34, 9]])} L34 24 L2 24 Z`} opacity={0.35} />
      <path d={line([[2, 20], [10, 13], [18, 15], [26, 7], [34, 9]])} fill="none" stroke="currentColor" strokeWidth={1.8} />
    </>
  ),
  stackedArea: (
    <>
      <path d={`${line([[2, 14], [12, 10], [22, 11], [34, 5]])} L34 24 L2 24 Z`} opacity={0.3} />
      <path d={`${line([[2, 19], [12, 17], [22, 18], [34, 14]])} L34 24 L2 24 Z`} opacity={0.65} />
    </>
  ),
  combo: (
    <>
      <g opacity={0.5}>
        <Bars values={[0.5, 0.7, 0.45, 0.85]} />
      </g>
      <path d={line([[5, 12], [14, 6], [22, 10], [31, 4]])} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </>
  ),
  pie: (
    <>
      <circle cx={18} cy={13} r={11} opacity={0.35} />
      <path d="M18 13 L18 2 A11 11 0 0 1 28.5 16.4 Z" />
    </>
  ),
  doughnut: (
    <>
      <circle cx={18} cy={13} r={9} fill="none" stroke="currentColor" strokeWidth={4.5} opacity={0.35} />
      <path d="M18 4 A9 9 0 0 1 26.6 15.8" fill="none" stroke="currentColor" strokeWidth={4.5} />
    </>
  ),
  waterfall: (
    <>
      <rect x={3} y={10} width={6} height={14} rx={1} />
      <rect x={11} y={5} width={6} height={5} rx={1} opacity={0.6} />
      <rect x={19} y={5} width={6} height={8} rx={1} opacity={0.6} />
      <rect x={27} y={13} width={6} height={11} rx={1} />
    </>
  ),
  funnel: (
    <>
      <rect x={2} y={2} width={32} height={5} rx={1.2} />
      <rect x={7} y={9} width={22} height={5} rx={1.2} opacity={0.8} />
      <rect x={11} y={16} width={14} height={4} rx={1.2} opacity={0.65} />
      <rect x={15} y={22} width={6} height={3} rx={1} opacity={0.5} />
    </>
  ),
  sankey: (
    <>
      <rect x={2} y={3} width={3} height={9} />
      <rect x={2} y={15} width={3} height={8} />
      <rect x={31} y={5} width={3} height={16} />
      <path d="M5 3 C18 3 18 5 31 5 L31 12 C18 12 18 12 5 12 Z" opacity={0.4} />
      <path d="M5 15 C18 15 18 12 31 12 L31 21 C18 21 18 23 5 23 Z" opacity={0.6} />
    </>
  ),
  histogram: <Bars values={[0.2, 0.5, 0.9, 0.75, 0.4, 0.15]} />,
  box: (
    <g fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M11 3 V8 M11 18 V23 M8 3 H14 M8 23 H14" />
      <rect x={6} y={8} width={10} height={10} rx={1} />
      <path d="M6 12 H16" />
      <path d="M26 6 V10 M26 17 V21 M23 6 H29 M23 21 H29" />
      <rect x={21} y={10} width={10} height={7} rx={1} />
      <path d="M21 14 H31" />
    </g>
  ),
  scatter: (
    <>
      {[[6, 19], [10, 15], [14, 17], [17, 11], [22, 12], [25, 7], [30, 6], [12, 21], [28, 9]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.9} />
      ))}
    </>
  ),
  bubble: (
    <>
      <circle cx={9} cy={17} r={4.5} opacity={0.55} />
      <circle cx={19} cy={10} r={6} opacity={0.55} />
      <circle cx={29} cy={17} r={3} opacity={0.55} />
      <circle cx={27} cy={6} r={2} opacity={0.55} />
    </>
  ),
  heatmap: (
    <>
      {[0, 1, 2].flatMap((r) =>
        [0, 1, 2, 3].map((c) => <rect key={`${r}-${c}`} x={2 + c * 8.2} y={2 + r * 7.6} width={7.2} height={6.6} rx={1} opacity={[0.25, 0.55, 0.9, 0.4, 0.7, 0.3, 0.6, 1, 0.45, 0.8, 0.35, 0.6][r * 4 + c]} />),
      )}
    </>
  ),
  radar: (
    <>
      <path d="M18 2 L29 10 L25 23 L11 23 L7 10 Z" fill="none" stroke="currentColor" strokeWidth={1} opacity={0.45} />
      <path d="M18 6 L26 11 L22 20 L13 19 L10 11 Z" opacity={0.55} />
    </>
  ),
};

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={className} fill="currentColor" aria-hidden>
      {DRAWINGS[kind] ?? DRAWINGS.bar}
    </svg>
  );
}
