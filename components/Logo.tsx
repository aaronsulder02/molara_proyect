/** Isotipo Molara: un diente que es, a la vez, una burbuja de chat (tres puntos = "escribiendo…"). */
export function LogoMark({ size = 36, mono = false }: { size?: number; mono?: boolean }) {
  const id = `mg${size}${mono ? "m" : ""}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="6" y1="4" x2="42" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor={mono ? "#ffffff" : "#15C2AD"} />
          <stop offset="1" stopColor={mono ? "#ffffff" : "#0B8577"} />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#${id})`} opacity={mono ? 0.14 : 1} />
      <path
        d="M17.2 9.5c-4.9 0-8.2 3.7-8.2 9 0 3.7 1.5 6.2 2.4 9.4.9 3.3 1.2 10.6 5.3 10.6 3.4 0 3.5-6.8 5-9.2.9-1.4 3.7-1.4 4.6 0 1.5 2.4 1.6 9.2 5 9.2 4.1 0 4.4-7.3 5.3-10.6.9-3.2 2.4-5.7 2.4-9.4 0-5.3-3.3-9-8.2-9-3.3 0-4.3 1.6-6.8 1.6s-3.5-1.6-6.8-1.6Z"
        fill="#fff"
      />
      <circle cx="18.6" cy="19.6" r="2" fill={mono ? "#0b1b2b" : "#0E9F8E"} />
      <circle cx="24" cy="19.6" r="2" fill={mono ? "#0b1b2b" : "#0E9F8E"} opacity=".75" />
      <circle cx="29.4" cy="19.6" r="2" fill={mono ? "#0b1b2b" : "#0E9F8E"} opacity=".5" />
      <path d="M36.5 6.5l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1 1-2.3Z" fill="#FFB547" />
    </svg>
  );
}

export function Logo({ size = 34, light = false, tagline = false }: { size?: number; light?: boolean; tagline?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <LogoMark size={size} />
      <span style={{ display: "grid", lineHeight: 1 }}>
        <span
          style={{
            fontFamily: "var(--display)",
            fontWeight: 800,
            fontSize: size * 0.72,
            letterSpacing: "-0.04em",
            color: light ? "#fff" : "var(--ink)",
          }}
        >
          molara<span style={{ color: "var(--teal)" }}>.</span>
        </span>
        {tagline && (
          <span style={{ fontSize: 11, color: light ? "#9fb3bf" : "var(--muted)", marginTop: 3, fontWeight: 500 }}>
            Recepción inteligente dental
          </span>
        )}
      </span>
    </span>
  );
}
