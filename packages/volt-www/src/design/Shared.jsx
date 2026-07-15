// Shared bits: logo, section wrapper, icons (inline stroke icons, Lucide-style 1.5px)
const VoltMark = ({ size = 22, color = "var(--color-text-primary)" }) =>
  React.createElement("svg", { width: size, height: size * 1.16, viewBox: "0 0 24 28", fill: color },
    React.createElement("path", { d: "M14 1 L4 15 L11 15 L9 27 L20 11 L13 11 L14 1 Z" }));

const Logo = ({ color, markColor }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <VoltMark color={markColor || color} />
    <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.03em", color: color || "var(--color-text-primary)" }}>Volt</span>
  </div>
);

// Minimal stroke icons
const Icon = ({ d, size = 18, stroke = "currentColor" }) =>
  React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" },
    Array.isArray(d) ? d.map((p, i) => React.createElement("path", { key: i, d: p })) : React.createElement("path", { d }));

const ICONS = {
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  file: ["M14 3v4a1 1 0 0 0 1 1h4", "M5 21V5a2 2 0 0 1 2-2h8l5 5v13a0 0 0 0 1 0 0H7a2 2 0 0 1-2-2z"],
  block: ["M3 3h18v18H3z", "M3 9h18", "M9 21V9"],
  check: "M20 6 9 17l-5-5",
  arrowDown: ["M12 5v14", "M19 12l-7 7-7-7"],
  git: ["M6 3v12", "M18 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M15 6a9 9 0 0 1-9 9"],
  doc: ["M14 3v4a1 1 0 0 0 1 1h4", "M5 21V5a2 2 0 0 1 2-2h8l5 5v13H7a2 2 0 0 1-2-2z", "M9 13h6", "M9 17h4"],
  flask: ["M9 3h6", "M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3", "M7 16h10"],
  terminal: ["M4 17l6-5-6-5", "M12 19h8"],
  cpu: ["M9 3v2", "M15 3v2", "M9 19v2", "M15 19v2", "M3 9h2", "M3 15h2", "M19 9h2", "M19 15h2", "M5 5h14v14H5z", "M9 9h6v6H9z"],
  sync: ["M21 2v6h-6", "M3 12a9 9 0 0 1 15-6.7L21 8", "M3 22v-6h6", "M21 12a9 9 0 0 1-15 6.7L3 16"],
};

Object.assign(window, { VoltMark, Logo, Icon, ICONS });
