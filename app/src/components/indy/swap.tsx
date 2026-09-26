/** The idol and the sack of sand trading places on the pedestal. */
export function Swap({ className }: { className?: string }) {
  return (
    <svg
      className={`swap ${className ?? ""}`}
      viewBox="0 0 200 240"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="A sack of sand swapped onto a pedestal in place of a golden idol"
    >
      <g className="swap-plinth" stroke="var(--faint)" strokeWidth="2.2">
        <path d="M36 176 H164 V188 H36 Z" />
        <path d="M58 188 V240 M142 188 V240" />
        <path d="M58 204 H142 M58 222 H142" stroke="var(--border)" />
      </g>
      <g className="swap-idol" stroke="#E8B84E" strokeWidth="2.6">
        <circle cx="100" cy="112" r="13" />
        <path d="M91 108 h5 M104 108 h5 M95 118 q5 3 10 0" />
        <path d="M86 176 C83 150 88 132 100 129 C112 132 117 150 114 176 Z" />
        <path d="M88 148 Q100 158 112 148" />
        <path d="M92 176 v-8 M108 176 v-8" />
      </g>
      <g className="swap-sack">
        <g transform="translate(68 106)" stroke="var(--sand)" strokeWidth="2.6">
          <path d="M24 30 L19 17 L27 21 L32 14 L37 21 L45 17 L40 30" />
          <path d="M24 30 C12 36 8 52 12 62 C16 72 48 72 52 62 C56 52 52 36 40 30" />
          <path d="M22 29.5 H42" />
        </g>
      </g>
      <circle className="swap-grain-1" cx="120" cy="170" r="1.6" fill="var(--sand)" />
      <circle className="swap-grain-2" cx="123" cy="172" r="1.3" fill="var(--sand)" />
    </svg>
  );
}
