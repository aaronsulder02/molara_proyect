import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";

export function AuthSide() {
  return (
    <aside className="auth-side">
      <Logo light size={34} />
      <div>
        <h2>Tu recepción nunca vuelve a cerrar.</h2>
        <p>Agenda, confirma y recuerda horas por WhatsApp y web, con un asistente que conoce tu consultorio.</p>
        <div className="stack-sm" style={{ marginTop: 28 }}>
          {["Botones y listas oficiales de WhatsApp", "Asistente con IA vía Vercel AI Gateway", "Agenda web con tu propio link", "Métricas de Instagram en el panel"].map((t) => (
            <div key={t} className="row" style={{ color: "#d7e4ea" }}>
              <span style={{ width: 24, height: 24, borderRadius: 8, background: "rgba(94,234,212,.15)", color: "#5eead4", display: "grid", placeItems: "center" }}>
                <Icon name="check" size={14} stroke={2.6} />
              </span>
              {t}
            </div>
          ))}
        </div>
      </div>
      <span className="tiny" style={{ color: "#7f95a3" }}>© Molara · Hecho en Chile</span>
    </aside>
  );
}
