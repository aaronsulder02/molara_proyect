import { requireContext } from "@/lib/session";
import { getAccountByClinic, listTemplates } from "@/lib/whatsapp";
import { Icon } from "@/components/Icon";
import { ActionForm, CopyButton, ConfirmSubmit } from "@/components/ActionForm";
import { Submit } from "@/components/Submit";
import { disconnectWhatsapp, sendTestMessage } from "../actions";
import { ConnectForm } from "./ConnectForm";

export const metadata = { title: "WhatsApp" };

export default async function WhatsappPage() {
  const { clinic, role } = await requireContext();
  const acc = await getAccountByClinic(clinic.id);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const webhook = `${appUrl}/api/whatsapp/webhook`;
  const demo = process.env.BUSINESS_PHONE && process.env.WABA_ID && process.env.WHATSAPP_ACCESS_TOKEN ? { phone: process.env.BUSINESS_PHONE, waba: process.env.WABA_ID } : null;

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
              <div className="row"><b style={{ fontSize: 18 }}>{acc.verified_name}</b><span className="badge b-confirmed">Conectado</span>{acc.quality_rating && <span className="badge plain">Calidad: {acc.quality_rating}</span>}</div>
              <div className="muted small">{acc.display_phone} · Phone ID <span className="mono">{acc.phone_number_id}</span></div>
              {acc.last_error && <div className="tiny" style={{ color: "#9a5b00" }}>⚠ {acc.last_error}</div>}
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
            {role === "staff" ? <p className="muted small">Solo administradores pueden cambiar la conexión.</p> : <ConnectForm current={acc ? { phone_number_id: acc.phone_number_id, waba_id: acc.waba_id } : null} demo={demo} />}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Pasos en Meta</h3></div>
          <div className="card-pad stack-sm small">
            <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 10 }}>
              <li>Entra a <a href="https://business.facebook.com/wa/manage/home/" target="_blank" style={{ color: "var(--teal)" }}>WhatsApp Manager</a> y agrega tu número (recibirás un código SMS o llamada).</li>
              <li>En <b>Meta for Developers → tu app → WhatsApp → Configuración de la API</b> copia el <b>Phone Number ID</b> y el <b>WhatsApp Business Account ID</b>.</li>
              <li>En <b>Configuración del negocio → Usuarios del sistema</b> genera un token permanente con permisos <span className="mono">whatsapp_business_messaging</span> y <span className="mono">whatsapp_business_management</span>.</li>
              <li>Pega los datos en el formulario. Molara verifica el número y suscribe la app a tu cuenta automáticamente.</li>
            </ol>
            <div className="divider" style={{ margin: "10px 0" }} />
            <b>Webhook de la plataforma</b>
            <p className="muted tiny">Lo configura una sola vez el administrador de la plataforma en la app de Meta (WhatsApp → Configuración → Webhook), campo <span className="mono">messages</span>.</p>
            <div className="row"><input className="input input-sm mono grow" readOnly value={webhook} /><CopyButton text={webhook} /></div>
            <p className="tiny">{process.env.WEBHOOK_VERIFY_TOKEN ? "✔ Token de verificación configurado en el servidor (WEBHOOK_VERIFY_TOKEN)." : "⚠ Falta WEBHOOK_VERIFY_TOKEN en las variables de entorno."}</p>
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
