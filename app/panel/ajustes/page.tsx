import { requireContext } from "@/lib/session";
import { ActionForm, CopyButton } from "@/components/ActionForm";
import { Submit } from "@/components/Submit";
import { aiAvailable } from "@/lib/ai";
import { changePassword, saveBot, saveClinic } from "../actions";

export const metadata = { title: "Ajustes" };

export default async function Ajustes() {
  const { clinic, role } = await requireContext();
  const admin = role !== "staff";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const link = `${appUrl}/reservar/${clinic.slug}`;
  const ai = aiAvailable();

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="page-head"><div><h1>Ajustes</h1><p>Datos del consultorio, reglas de reserva y personalidad del asistente.</p></div></div>

      <div className="card card-pad row-between wrap" style={{ background: "var(--mint-50)", borderColor: "#c7efe7" }}>
        <div><b>Tu link de reserva online</b><div className="mono small" style={{ marginTop: 4 }}>{link}</div></div>
        <div className="row"><CopyButton text={link} label="Copiar link" /><a className="btn btn-sm btn-primary" href={link} target="_blank">Abrir</a></div>
      </div>

      <div className="grid-2-eq">
        <div className="card">
          <div className="card-head"><h3>Consultorio</h3></div>
          <ActionForm action={saveClinic} className="card-pad form-grid">
            <fieldset disabled={!admin} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>
              <label className="field"><span>Nombre</span><input className="input" name="name" defaultValue={clinic.name} required /></label>
              <label className="field"><span>Link de reserva</span>
                <div className="row"><span className="small muted" style={{ whiteSpace: "nowrap" }}>/reservar/</span><input className="input" name="slug" defaultValue={clinic.slug} required /></div>
              </label>
              <div className="form-row">
                <label className="field"><span>Teléfono</span><input className="input" name="phone" defaultValue={clinic.phone ?? ""} /></label>
                <label className="field"><span>Correo</span><input className="input" name="email" defaultValue={clinic.email ?? ""} /></label>
              </div>
              <div className="form-row">
                <label className="field"><span>Dirección</span><input className="input" name="address" defaultValue={clinic.address ?? ""} placeholder="Av. Providencia 1234, of. 502" /></label>
                <label className="field"><span>Ciudad</span><input className="input" name="city" defaultValue={clinic.city ?? ""} /></label>
              </div>
              <label className="field"><span>Horario (texto para pacientes)</span><input className="input" name="hours_text" defaultValue={clinic.hours_text ?? ""} /></label>
              <label className="field"><span>Descripción</span><textarea className="textarea" name="about" defaultValue={clinic.about ?? ""} placeholder="Especialidades, convenios, estacionamiento…" /></label>
              <div className="form-row">
                <label className="field"><span>Intervalo de agenda</span>
                  <select className="select" name="slot_minutes" defaultValue={String(clinic.slot_minutes)}>
                    {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>Cada {m} min</option>)}
                  </select>
                </label>
                <label className="field"><span>Anticipación mínima</span>
                  <select className="select" name="min_notice_min" defaultValue={String(clinic.min_notice_min)}>
                    {[[0, "Sin mínimo"], [30, "30 min"], [60, "1 hora"], [120, "2 horas"], [240, "4 horas"], [720, "12 horas"], [1440, "24 horas"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="field"><span>Ventana de reserva</span>
                  <select className="select" name="booking_window_days" defaultValue={String(clinic.booking_window_days)}>
                    {[7, 14, 30, 45, 60].map((d) => <option key={d} value={d}>{d} días</option>)}
                  </select>
                </label>
              </div>
              {admin && <div><Submit>Guardar consultorio</Submit></div>}
            </fieldset>
          </ActionForm>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>Asistente de WhatsApp</h3>{ai ? <span className="badge b-confirmed">IA disponible</span> : <span className="badge b-pending">IA sin configurar</span>}</div>
            <ActionForm action={saveBot} className="card-pad form-grid">
              <fieldset disabled={!admin} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>
                <label className="field"><span>Nombre del asistente</span><input className="input" name="bot_name" defaultValue={clinic.bot_name} /></label>
                <label className="field"><span>Mensaje de bienvenida</span><textarea className="textarea" name="bot_welcome" defaultValue={clinic.bot_welcome ?? ""} style={{ minHeight: 70 }} /></label>
                <label className="check"><input type="checkbox" name="ai_enabled" defaultChecked={clinic.ai_enabled} /> <span>Responder texto libre con IA (Vercel AI Gateway).<span className="hint" style={{ display: "block" }}>{ai ? "Si se desactiva, el bot responde solo con menús y botones." : "Agrega AI_GATEWAY_API_KEY en el servidor para activarla. Mientras tanto el bot usa botones y palabras clave."}</span></span></label>
                <label className="field"><span>Instrucciones adicionales para la IA</span><textarea className="textarea" name="bot_instructions" defaultValue={clinic.bot_instructions ?? ""} placeholder="Ej: Atendemos Fonasa nivel 3 y convenio con Isapre X. Para blanqueamiento se requiere evaluación previa." /></label>
                <div className="form-row">
                  <label className="field"><span>Plantilla de recordatorio</span><input className="input mono" name="reminder_template" defaultValue={clinic.reminder_template ?? ""} placeholder="recordatorio_cita" /></label>
                  <label className="field"><span>Idioma</span><input className="input mono" name="reminder_template_lang" defaultValue={clinic.reminder_template_lang ?? "es"} /></label>
                </div>
                {admin && <div><Submit>Guardar asistente</Submit></div>}
              </fieldset>
            </ActionForm>
          </div>

          <div className="card">
            <div className="card-head"><h3>Mi contraseña</h3></div>
            <ActionForm action={changePassword} className="card-pad form-grid" resetOnOk>
              <label className="field"><span>Contraseña actual</span><input className="input" type="password" name="current" required autoComplete="current-password" /></label>
              <label className="field"><span>Nueva contraseña</span><input className="input" type="password" name="next" minLength={8} required autoComplete="new-password" /></label>
              <div><Submit className="btn">Cambiar contraseña</Submit></div>
            </ActionForm>
          </div>
        </div>
      </div>
    </div>
  );
}
