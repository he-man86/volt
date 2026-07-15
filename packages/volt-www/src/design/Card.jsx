import React from "react";

export function Card({ hover = false, padding = 24, children, style = {}, ...rest }) {
  const [h, setH] = React.useState(false);
  return (
    <div
      onMouseEnter={() => hover && setH(true)}
      onMouseLeave={() => hover && setH(false)}
      style={{
        background: h ? "var(--color-surface-hover)" : "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        padding,
        transition: "background 140ms ease, box-shadow 140ms ease",
        boxShadow: h ? "var(--shadow-md)" : "none",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
