import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
      <div className="stack" style={{ justifyItems: "center" }}>
        <Logo size={36} />
        <h1 style={{ fontSize: 48 }}>404</h1>
        <p className="muted">No encontramos esta página.</p>
        <Link href="/" className="btn btn-primary">Volver al inicio</Link>
      </div>
    </div>
  );
}
