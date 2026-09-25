import Link from "next/link";
import { requireContext } from "@/lib/session";
import { db } from "@/lib/supabase";
import { Icon } from "@/components/Icon";
import { ActionForm, OpenDialog, CloseDialog } from "@/components/ActionForm";
import { Submit } from "@/components/Submit";
import { addDaysYmd, hmInTz, weekdayOfYmd, ymdInTz, zonedToUtc, WEEKDAYS_ES, humanDateTime } from "@/lib/time.ts";
import { changeAppointmentStatus, runReminders, updateAppointmentNotes } from "../actions";
import { NewAppointment } from "./NewAppointment";

export const metadata = { title: "Agenda" };

const STATUS: Record<string, string> = { pending: "Por confirmar", confirmed: "Confirmada", completed: "Atendida", cancelled: "Cancelada", no_show: "No asistió" };
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", web: "Web", panel: "Panel" };

export default async function Citas({ searchParams }: { searchParams: Promise<{ w?: string; nueva?: string; vista?: string; d?: string }> }) {
  const { clinic } = await requireContext();
  const sp = await searchParams;
  const tz = clinic.timezone;
  const today = ymdInTz(new Date(), tz);
  const base = sp.w && /^\d{4}-\d{2}-\d{2}$/.test(sp.w) ? sp.w : today;
  const monday = addDaysYmd(base, -((weekdayOfYmd(base) + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDaysYmd(monday, i));
  const from = zonedToUtc(monday, "00:00", tz).toISOString();
  const to = zonedToUtc(addDaysYmd(monday, 7), "00:00", tz).toISOString();

  let q = db().from("appointment_details").select("*").eq("clinic_id", clinic.id).gte("starts_at", from).lt("starts_at", to).order("starts_at");
  if (sp.d) q = q.eq("dentist_id", sp.d);
  const [{ data: appts }, { data: services }, { data: dentists }, { data: patients }] = await Promise.all([
    q,
    db().from("services").select("id, name, duration_min").eq("clinic_id", clinic.id).eq("active", true).order("sort"),
    db().from("dentists").select("id, name, color").eq("clinic_id", clinic.id).eq("active", true).order("name"),
    db().from("patients").select("full_name, phone").eq("clinic_id", clinic.id).order("created_at", { ascending: false }).limit(300),
  ]);
  const list = appts ?? [];
  const [, m1, d1] = monday.split("-").map(Number);
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const lastDay = days[6].split("-").map(Number);
  const title = `${d1} ${m1 !== lastDay[1] ? months[m1 - 1] + " " : ""}– ${lastDay[2]} de ${months[lastDay[1] - 1]}`;
  const vista = sp.vista === "lista" ? "lista" : "semana";
  const qs = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const all = { w: monday, vista, d: sp.d, ...p };
    for (const [k, v] of Object.entries(all)) if (v) u.set(k, v);
    return `/panel/citas?${u}`;
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Agenda</h1>
          <p>Semana del {title} · {list.filter((a: any) => a.status !== "cancelled").length} citas</p>
        </div>
        <div className="row wrap">
          <OpenDialog target="reminders" className="btn"><Icon name="bell" size={16} /> Recordatorios</OpenDialog>
          <NewAppointment slug={clinic.slug} services={services ?? []} dentists={dentists ?? []} patients={patients ?? []} today={today} autoOpen={sp.nueva === "1"} />
        </div>
      </div>

      <div className="row-between wrap">
        <div className="row">
          <Link className="btn btn-sm" href={qs({ w: addDaysYmd(monday, -7) })} aria-label="Semana anterior"><Icon name="left" size={16} /></Link>
          <Link className="btn btn-sm" href={qs({ w: today })}>Hoy</Link>
          <Link className="btn btn-sm" href={qs({ w: addDaysYmd(monday, 7) })} aria-label="Semana siguiente"><Icon name="right" size={16} /></Link>
        </div>
        <div className="row wrap">
          <div className="toggle">
            <Link href={qs({ vista: "semana" })} className={vista === "semana" ? "on" : ""}>Semana</Link>
            <Link href={qs({ vista: "lista" })} className={vista === "lista" ? "on" : ""}>Lista</Link>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Link href={qs({ d: undefined })} className={`badge plain`} style={!sp.d ? { background: "var(--ink)", color: "#fff" } : {}}>Todos</Link>
            {(dentists ?? []).map((d: any) => (
              <Link key={d.id} href={qs({ d: d.id })} className="badge plain" style={sp.d === d.id ? { background: "var(--ink)", color: "#fff" } : {}}>{d.name}</Link>
            ))}
          </div>
        </div>
      </div>

      {vista === "semana" ? (
        <div className="week">
          {days.map((d) => {
            const items = list.filter((a: any) => ymdInTz(new Date(a.starts_at), tz) === d);
            return (
              <div key={d} className={`day-col${d === today ? " today" : ""}`}>
                <header>
                  <span>{WEEKDAYS_ES[weekdayOfYmd(d)]}</span>
                  <b>{Number(d.slice(8))}</b>
                </header>
                <div className="list">
                  {items.map((a: any) => (
                    <OpenDialog key={a.id} target={`a-${a.id}`} className={`appt ${a.status}`}>
                      <span style={{ display: "contents" }}>
                        <span className="row-between"><b>{hmInTz(new Date(a.starts_at), tz)}</b><span className={`badge b-${a.status}`} style={{ height: 18, fontSize: 10.5, padding: "0 6px" }}>{STATUS[a.status]}</span></span>
                        <span className="truncate" style={{ fontWeight: 600 }}>{a.patient_name || "+" + a.patient_phone}</span>
                        <span className="muted truncate">{a.service_name}</span>
                        <span className="faint truncate" style={{ fontSize: 11 }}>{a.dentist_name} · {CHANNEL[a.channel]}</span>
                      </span>
                    </OpenDialog>
                  ))}
                  {!items.length && <span className="tiny faint" style={{ padding: 6 }}>Sin citas</span>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          {list.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Fecha</th><th>Paciente</th><th>Servicio</th><th>Profesional</th><th>Canal</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {list.map((a: any) => (
                    <tr key={a.id}>
                      <td><b>{hmInTz(new Date(a.starts_at), tz)}</b> <span className="muted small">{WEEKDAYS_ES[weekdayOfYmd(ymdInTz(new Date(a.starts_at), tz))].slice(0, 3)} {ymdInTz(new Date(a.starts_at), tz).slice(8)}</span></td>
                      <td><div style={{ fontWeight: 600 }}>{a.patient_name || "—"}</div><div className="tiny muted">+{a.patient_phone}</div></td>
                      <td>{a.service_name}</td>
                      <td>{a.dentist_name}</td>
                      <td><span className={`badge b-${a.channel}`}>{CHANNEL[a.channel]}</span></td>
                      <td><span className={`badge b-${a.status}`}>{STATUS[a.status]}</span></td>
                      <td style={{ textAlign: "right" }}><OpenDialog target={`a-${a.id}`} className="btn btn-xs">Gestionar</OpenDialog></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty"><Icon name="calendar" size={32} /><p>No hay citas esta semana.</p></div>
          )}
        </div>
      )}

      {/* Diálogos de cada cita */}
      {list.map((a: any) => (
        <dialog key={a.id} id={`a-${a.id}`} className="modal">
          <div className="modal-head">
            <h3>{a.patient_name || "+" + a.patient_phone}</h3>
            <CloseDialog className="btn btn-ghost btn-sm">✕</CloseDialog>
          </div>
          <div className="modal-body stack">
            <div className="stack-sm small">
              <div className="row"><Icon name="calendar" size={16} /> {humanDateTime(a.starts_at, tz)}</div>
              <div className="row"><Icon name="tooth" size={16} /> {a.service_name} · {a.dentist_name}</div>
              <div className="row"><Icon name="whatsapp" size={16} /> <a href={`https://wa.me/${a.patient_phone}`} target="_blank" style={{ color: "var(--teal)" }}>+{a.patient_phone}</a></div>
              <div className="row"><span className={`badge b-${a.status}`}>{STATUS[a.status]}</span><span className={`badge b-${a.channel}`}>Reservada por {CHANNEL[a.channel]}</span>{a.reminder_sent_at && <span className="badge plain">Recordatorio enviado</span>}</div>
            </div>
            <form action={updateAppointmentNotes} className="stack-sm">
              <input type="hidden" name="id" value={a.id} />
              <textarea className="textarea" name="notes" defaultValue={a.notes ?? ""} placeholder="Notas internas" style={{ minHeight: 70 }} />
              <div><Submit className="btn btn-sm">Guardar nota</Submit></div>
            </form>
            <div className="divider" />
            <div className="row wrap">
              {[
                ["confirmed", "Confirmar", "btn btn-sm btn-primary"],
                ["completed", "Atendida", "btn btn-sm"],
                ["no_show", "No asistió", "btn btn-sm"],
                ["cancelled", "Cancelar cita", "btn btn-sm btn-danger"],
                ["pending", "Volver a pendiente", "btn btn-sm btn-ghost"],
              ]
                .filter(([s]) => s !== a.status)
                .map(([s, label, cls]) => (
                  <form key={s} action={changeAppointmentStatus}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="status" value={s} />
                    <Submit className={cls} pendingText="…">{label}</Submit>
                  </form>
                ))}
            </div>
          </div>
        </dialog>
      ))}

      <dialog id="reminders" className="modal">
        <div className="modal-head"><h3>Recordatorios por WhatsApp</h3><CloseDialog className="btn btn-ghost btn-sm">✕</CloseDialog></div>
        <div className="modal-body stack">
          <p className="small muted">
            Cada día a las 10:00 (hora de Chile) Molara envía automáticamente el recordatorio a los pacientes con hora para mañana, con botones
            para <b>Confirmar</b>, <b>Reagendar</b> o <b>Cancelar</b>. También puedes enviarlos ahora.
          </p>
          {!clinic.reminder_template && (
            <div className="alert alert-warn small">
              Sin plantilla configurada, el recordatorio solo llega a pacientes que escribieron en las últimas 24 h (regla de Meta).
              Configura una plantilla aprobada en <Link href="/panel/ajustes" style={{ textDecoration: "underline" }}>Ajustes → Asistente</Link>.
            </div>
          )}
          <ActionForm action={runReminders} className="stack-sm">
            <Submit className="btn btn-primary" pendingText="Enviando…">Enviar recordatorios de mañana ahora</Submit>
          </ActionForm>
        </div>
      </dialog>
    </div>
  );
}
