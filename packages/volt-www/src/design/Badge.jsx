import React from "react";

export function Badge({ variant = "neutral", children, style = {}, ...rest }) {
  const variants = {
    neutral: { background: "var(--color-surface)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" },
    accent: { background: "rgba(217,119,6,0.10)", color: "var(--color-accent-hover)", border: "1px solid rgba(217,119,6,0.25)" },
    success: { background: "rgba(22,163,68,0.10)", color: "var(--color-success)", border: "1px solid rgba(22,163,68,0.25)" },
    solid: { background: "var(--color-text-primary)", color: "var(--color-text-on-dark)", border: "1px solid var(--color-text-primary)" },
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1,
        padding: "5px 10px",
        borderRadius: "var(--radius-pill)",
        ...(variants[variant] || variants.neutral),
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
