import React from "react";

export function Input({ label, hint, style = {}, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--font-sans)" }}>
      {label && (
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>{label}</span>
      )}
      <input
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          height: 40,
          padding: "0 12px",
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          color: "var(--color-text-primary)",
          background: "#fff",
          border: `1px solid ${focus ? "var(--color-link)" : "var(--color-border)"}`,
          borderRadius: "var(--radius-md)",
          outline: "none",
          boxShadow: focus ? "0 0 0 3px rgba(194,65,12,0.12)" : "none",
          transition: "border-color 120ms ease, box-shadow 120ms ease",
          ...style,
        }}
        {...rest}
      />
      {hint && <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{hint}</span>}
    </label>
  );
}
