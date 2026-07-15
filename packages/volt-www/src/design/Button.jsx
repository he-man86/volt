import React from "react";

const sizes = {
  sm: { padding: "6px 12px", fontSize: 14, height: 32 },
  md: { padding: "9px 16px", fontSize: 14, height: 40 },
  lg: { padding: "12px 22px", fontSize: 16, height: 48 },
};

export function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  children,
  style = {},
  ...rest
}) {
  const s = sizes[size] || sizes.md;
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontFamily: "var(--font-sans)",
    fontWeight: 500,
    lineHeight: 1,
    border: "1px solid transparent",
    borderRadius: 999,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
    height: s.height,
    padding: s.padding,
    fontSize: s.fontSize,
    whiteSpace: "nowrap",
  };

  const variants = {
    primary: {
      background: "var(--color-accent)",
      color: "var(--color-text-on-accent)",
    },
    secondary: {
      background: "var(--color-text-primary)",
      color: "var(--color-text-on-dark)",
    },
    outline: {
      background: "transparent",
      color: "var(--color-text-primary)",
      borderColor: "var(--color-border)",
    },
    ghost: {
      background: "transparent",
      color: "var(--color-text-primary)",
    },
  };

  return (
    <button
      disabled={disabled}
      style={{ ...base, ...(variants[variant] || variants.primary), ...style }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (variant === "primary") e.currentTarget.style.background = "var(--color-accent-hover)";
        else if (variant === "secondary") e.currentTarget.style.background = "#262626";
        else e.currentTarget.style.background = "var(--color-surface-hover)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = (variants[variant] || variants.primary).background;
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
