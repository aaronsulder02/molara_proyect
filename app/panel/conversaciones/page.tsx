import Link from "next/link";
import { requireContext } from "@/lib/session";
import { db } from "@/lib/supabase";
import { Icon } from "@/components/Icon";
import { ActionForm } from "@/components/ActionForm";
import { Submit } from "@/components/Submit";
import { AutoRefresh, ScrollBottom } from "@/components/AutoRefresh";
import { sendManualReply, setConversationMode } from "../actions";
import { hmInTz, shortDayLabel, ymdInTz } from "@/lib/time.ts";

export const metadata = { title: "Conversaciones" };
const WHO: Record<string, string> = { bot: "🤖 Bot", ai: "✨ IA", staff: "👤 Equipo", system: "⏰ Sistema" };

export default async function Conversaciones({ searchParams }: { searchParams: Promise<{ c?: string; f?: string }> }) {
  const { clinic } = await requireContext();
  const sp = await searchParams;
  const tz = clinic.timezone;
  let q = db().from("conversations").select("*").eq("clinic_id", clinic.id).order("last_message_at", { ascending: false }).limit(100);
  if (sp.f === "humano") q = q.eq("mode", "human");
  const { data: convs } = await q;
  const current = (convs ?? []).find((c: any) => c.id === sp.c) ?? null;

  let messages: any[] = [];
  let patient: any = null;
  if (current) {
    const [{ data: m }, { data: p }] = await Promise.all([
      db().from("messages").select("*").eq("conversation_id", current.id).order("created_at", { ascending: true }).limit(200),
      current.patient_id ? db().from("patients").select("*").eq("id", current.patient_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    messages = m ?? [];
    patient = p;
    if (current.unread) await db().from("conversations").update({ unread: 0 }).eq("id", current.id);
  }
  const windowOpen = current?.last_inbound_at && Date.now() - new Date(current.last_inbound_at).getTime() < 24 * 3600 * 1000;
  const today = ymdInTz(new Date(), tz);

  return (
    <div className="stack">
      <AutoRefresh seconds={8} />
      <div className="page-head">
        <div><h1>Conversaciones</h1><p>WhatsApp en tiempo real. Toma el control cuando quieras: el bot se pausa en esa conversación.</p></div>
        <div className="toggle">
          <Link href="/panel/conversaciones" className={sp.f !== "humano" ? "on" : ""}>Todas</Link>
          <Link href="/panel/conversaciones?f=humano" className={sp.f === "humano" ? "on" : ""}>Requieren recepción</Link>
        </div>
      </div>
      <div className="card inbox">
        <div className="inbox-list">
          {convs?.length ? convs.map((c: any) => {
            const d = new Date(c.last_message_at);
            return (
              <Link key={c.id} href={`/panel/conversaciones?c=${c.id}${sp.f ? "&f=" + sp.f : ""}`} className={`conv${c.id === current?.id ? " on" : ""}`}>
                <span className="avatar">{(c.profile_name || "?")[0].toUpperCase()}</span>
                <div className="grow">
                  <div className="row-between">
                    <b className="small truncate">{c.profile_name || "+" + c.wa_id}</b>
                    <span className="tiny faint">{ymdInTz(d, tz) === today ? hmInTz(d, tz) : shortDayLabel(ymdInTz(d, tz)).slice(4)}</span>
                  </div>
                  <div className="row-between">
                    <span className="tiny muted truncate">{c.mode === "human" ? "👤 " : ""}{c.last_message}</span>
                    {c.unread > 0 && c.id !== current?.id && <span className="unread">{c.unread}</span>}
                  </div>
                </div>
              </Link>
            );
          }) : <div className="empty small">Aún no hay conversaciones. Escribe a tu número de WhatsApp para probar el bot.</div>}
        </div>

        {current ? (
          <div className="thread">
            <div className="card-head">
              <div className="row">
                <span className="avatar">{(current.profile_name || "?")[0].toUpperCase()}</span>
                <div>
                  <b>{patient?.full_name || current.profile_name || "Paciente"}</b>
                  <div className="tiny muted">+{current.wa_id}{current.state?.handoffReason ? ` · ${current.state.handoffReason}` : ""}</div>
                </div>
              </div>
              <form action={setConversationMode} className="row">
                <input type="hidden" name="id" value={current.id} />
                <input type="hidden" name="mode" value={current.mode === "human" ? "bot" : "human"} />
                {current.mode === "human" ? <span className="badge b-pending">Bot en pausa</span> : <span className="badge b-confirmed">Bot activo</span>}
                <Submit className="btn btn-sm" pendingText="…">{current.mode === "human" ? "Reactivar bot" : "Tomar control"}</Submit>
              </form>
            </div>
            <div className="thread-body" id="thread">
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.direction}`}>
                  {m.direction === "out" && <div className="who">{WHO[m.author] ?? m.author}</div>}
                  {waFormat(m.body)}
                  <div className="meta">
                    <span>{hmInTz(new Date(m.created_at), tz)}</span>
                    {m.direction === "out" && <span>{m.status === "read" ? "✓✓ leído" : m.status === "delivered" ? "✓✓" : m.status === "failed" ? "⚠ falló" : "✓"}</span>}
                  </div>
                  {m.error && <div className="tiny" style={{ color: "var(--coral)" }}>{m.error}</div>}
                </div>
              ))}
              <ScrollBottom id="thread" />
            </div>
            <ActionForm action={sendManualReply} className="thread-foot" resetOnOk>
              <input type="hidden" name="id" value={current.id} />
              <input className="input" name="text" placeholder={windowOpen ? "Escribe una respuesta… (pausa el bot)" : "Ventana de 24 h cerrada: Meta solo permite plantillas"} autoComplete="off" />
              <Submit className="btn btn-wa" pendingText="…"><Icon name="send" size={16} /></Submit>
            </ActionForm>
          </div>
        ) : (
          <div className="empty" style={{ alignSelf: "center" }}><Icon name="chat" size={40} /><p>Selecciona una conversación</p></div>
        )}
      </div>
    </div>
  );
}

/** Formato básico de WhatsApp: *negrita* y _cursiva_ */
function waFormat(text: string | null) {
  if (!text) return null;
  return text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((p, i) =>
    p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <b key={i}>{p.slice(1, -1)}</b> : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <i key={i}>{p.slice(1, -1)}</i> : p
  );
}
