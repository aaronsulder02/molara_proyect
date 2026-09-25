import { requireContext } from "@/lib/session";
import { getAccountByClinic, listTemplates } from "@/lib/whatsapp";
import { Icon } from "@/components/Icon";
import { ActionForm, ConfirmSubmit } from "@/components/ActionForm";
import { Submit } from "@/components/Submit";
import { disconnectWhatsapp, sendTestMessage, reconfigureWebhook } from "../actions";
import { isPublicHttps, publicAppUrl, type Step } from "@/lib/metaConnect";
import { ConnectForm } from "./ConnectForm";

export const metadata = { title: "WhatsApp" };

export default async function WhatsappPage() {
  const { clinic, role } = await requireContext();
  const acc = await getAccountByClinic(clinic.id);
  const appUrl = publicAppUrl();
  const isPublic = isPublicHttps(appUrl);
  const env = process.env;
  const demo = env.BUSINESS_PHONE && env.WABA_ID && env.WHATSAPP_ACCESS_TOKEN && env.META_APP_ID && env.META_APP_SECRET ? { phone: env.BUSINESS_PHONE, waba: env.WABA_ID } : null;
  const steps: Step[] = acc?.setup_report?.steps ?? [];
  const wh = acc?.webhook_status ?? "pending";
  const whBadge = wh === "active" ? ["b-confirmed", "Webhook activo"] : wh === "error" ? ["b-cancelled", "Webhook con error"] : ["b-pending", "Webhook pendiente"];
  const fmt = (d?: string | null) => (d ? new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: clinic.timezone }).format(new Date(d)) : "—");

  let templates: any[] = [];
  let tplError = "";
  if (acc) {
    try { templates = await listTemplates(acc.waba_id, acc.access_token); } catch (e: any) { tplError = e.message; }
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="page-head">
        <div><h1>WhatsApp</h1><p>Conecta el número oficial de tu consultorio (WhatsApp Cloud API de Meta).</p></div>
      </div>

      {acc ? (
        <div className="card card-pad row-between wrap" style={{ background: "linear-gradient(135deg,#e9fbf1,#fff)" }}>
          <div className="row">
            <span className="kpi" style={{ padding: 0 }}><span className="ic" style={{ width: 48, height: 48, borderRadius: 14, background: "var(--wa)", color: "#fff", display: "grid", placeItems: "center" }}><Icon name="whatsapp" size={26} /></span></span>
            <div>
              <div className="row"><b style={{ fontSize: 18 }}>{acc.verified_name}</b><span className="badge b-confirmed">Conectado</span><span className={`badge ${whBadge[0]}`}>{whBadge[1]}</span>{acc.quality_rating && <span className="badge plain">Calidad: {acc.quality_rating}</span>}</div>
              <div className="muted small">{acc.display_phone} · Phone ID <span className="mono">{acc.phone_number_id}</span></div>
            </div>
          </div>
          <div className="row">
            <a className="btn btn-wa" href={`https://wa.me/${acc.display_phone.replace(/\D/g, "")}?text=Hola`} target="_blank"><Icon name="chat" size={16} /> Probar el bot</a>
            {role !== "staff" && (
              <form action={disconnectWhatsapp}><ConfirmSubmit message="¿Desconectar este número? El bot dejará de responder." className="btn btn-danger">Desconectar</ConfirmSubmit></form>
            )}
          </div>
        </div>
      ) : (
        <div className="alert alert-info">Aún no hay un número conectado. Sigue los pasos y completa el formulario.</div>
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>{acc ? "Credenciales del número" : "Registrar mi número"}</h3></div>
          <div className="card-pad">
            {role === "staff" ? <p className="muted small">Solo administradores pueden cambiar la conexión.</p> : <ConnectForm current={acc ? { phone_number_id: acc.phone_number_id, waba_id: acc.waba_id, app_id: acc.app_id ?? null, has_secret: !!acc.app_secret } : null} demo={demo} />}
          </div>
        </div>

        <div className="stack" style={{ gap: 22 }}>
          {acc && (
            <div className="card">
              <div className="card-head">
                <h3>Conexión con Meta</h3>
                <span className={`badge ${whBadge[0]}`}>{whBadge[1]}</span>
              </div>
              <div className="card-pad" style={{ paddingTop: 4 }}>
                {steps.length ? (
                  <ul className="setup-list">
                    {steps.map((st) => (
                      <li key={st.key} className={`setup-step s-${st.state}`}>
                        <span className="setup-ic" aria-hidden>{st.state === "ok" ? "✓" : st.state === "warn" ? "!" : st.state === "error" ? "✕" : "…"}</span>
                        <span><b>{st.label}</b><span className="tiny muted" style={{ display: "block" }}>{st.detail}</span></span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">Este número se conectó antes de la configuración automática. Presiona “Reconfigurar webhook” para que Molara lo configure en Meta.</p>
                )}
                <div className="divider" style={{ margin: "12px 0" }} />
                <div className="tiny muted stack-sm">
                  <span>Última verificación de Meta: <b>{fmt(acc.webhook_verified_at)}</b></span>
                  <span>Último mensaje recibido: <b>{fmt(acc.webhook_last_event_at)}</b></span>
                  {acc.token_expires_at && <span style={{ color: "#9a5b00" }}>⚠ El token vence el {fmt(acc.token_expires_at)}. Reemplázalo por uno permanente.</span>}
                </div>
                {role !== "staff" && (
                  <div style={{ marginTop: 14 }}>
                    <ActionForm action={reconfigureWebhook} className="form-grid">
                      <div><Submit className="btn btn-sm" pendingText="Configurando en Meta…">↻ Reconfigurar webhook</Submit></div>
                    </ActionForm>
                  </div>
                )}
                {!isPublic && (
                  <div className="alert alert-info tiny" style={{ marginTop: 12 }}>
                    Estás en un entorno local ({appUrl || "sin URL"}). Meta solo puede enviar mensajes a una URL pública https: el webhook se configurará automáticamente al publicar la plataforma.
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head"><h3>¿Dónde encuentro estos datos?</h3></div>
            <div className="card-pad stack-sm small">
              <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 10 }}>
                <li>En <a href="https://business.facebook.com/wa/manage/home/" target="_blank" style={{ color: "var(--teal)" }}>WhatsApp Manager</a> agrega el número del consultorio (recibirás un código por SMS o llamada).</li>
                <li>En <a href="https://developers.facebook.com/apps/" target="_blank" style={{ color: "var(--teal)" }}>Meta for Developers</a> abre tu app → <b>WhatsApp → Configuración de la API</b>: copia el <b>Phone Number ID</b> y el <b>WhatsApp Business Account ID</b>.</li>
                <li>En la misma app → <b>Configuración de la app → Básica</b>: copia el <b>App ID</b> y la <b>Clave secreta</b> (App Secret).</li>
                <li>En <b>Configuración del negocio → Usuarios del sistema</b> genera un token permanente con <span className="mono">whatsapp_business_messaging</span> y <span className="mono">whatsapp_business_management</span>, asignando tu cuenta de WhatsApp.</li>
              </ol>
              <div className="alert alert-ok tiny" style={{ marginTop: 6 }}>
                <b>No necesitas configurar el webhook en Meta.</b> Al presionar “Conectar automáticamente”, Molara valida tus datos, suscribe tu app y registra en Meta una ruta exclusiva para tu número.
              </div>
            </div>
          </div>
        </div>
      </div>

      {acc && (
        <div className="grid-2">
          <div className="card">
            <div className="card-head"><h3>Enviar mensaje de prueba</h3></div>
            <ActionForm action={sendTestMessage} className="card-pad form-grid">
              <label className="field"><span>Número de destino</span><input className="input" name="to" placeholder="+56 9 1234 5678" required /></label>
              <label className="field"><span>Tipo</span>
                <select className="select" name="mode">
                  <option value="buttons">Mensaje con botones interactivos (requiere que el número te haya escrito en 24 h)</option>
                  <option value="template">Plantilla hello_world (abre la conversación)</option>
                </select>
              </label>
              <Submit className="btn btn-wa" pendingText="Enviando…"><Icon name="send" size={16} /> Enviar prueba</Submit>
            </ActionForm>
          </div>
          <div className="card">
            <div className="card-head"><h3>Plantillas de mensajes</h3><a className="btn btn-sm" target="_blank" href={`https://business.facebook.com/wa/manage/message-templates/?waba_id=${acc.waba_id}`}>Gestionar en Meta</a></div>
            {tplError ? <div className="card-pad"><div className="alert alert-warn small">{tplError}</div></div> : templates.length ? (
              <table className="table">
                <tbody>
                  {templates.slice(0, 8).map((t) => (
                    <tr key={t.name + t.language}>
                      <td className="mono">{t.name}</td>
                      <td className="small muted">{t.language} · {t.category}</td>
                      <td style={{ textAlign: "right" }}><span className={`badge ${t.status === "APPROVED" ? "b-confirmed" : "b-pending"}`}>{t.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty small">Sin plantillas.</div>}
            <div className="card-pad" style={{ paddingTop: 0 }}>
              <p className="tiny muted">
                Para recordatorios fuera de la ventana de 24 h crea una plantilla <b>UTILITY</b> con 3 variables ({"{{1}}"} nombre, {"{{2}}"} fecha y hora, {"{{3}}"} consultorio)
                y 2 botones de respuesta rápida (Confirmo / Cancelar). Luego escribe su nombre en Ajustes → Asistente.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
