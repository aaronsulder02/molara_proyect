import Link from "next/link";
import { requireContext } from "@/lib/session";
import { db } from "@/lib/supabase";
import { Icon } from "@/components/Icon";
import { addDaysYmd, hmInTz, shortDayLabel, ymdInTz, zonedToUtc } from "@/lib/time.ts";

export const metadata = { title: "Resumen" };

const STATUS: Record<string, string> = { pending: "Por confirmar", confirmed: "Confirmada", completed: "Atendida", cancelled: "Cancelada", no_show: "No asistió" };
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", web: "Web", panel: "Panel" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ bienvenida?: string }> }) {
  const { clinic, memberName } = await requireContext();
  const sp = await searchParams;
  const tz = clinic.timezone;
  const today = ymdInTz(new Date(), tz);
  const from = zonedToUtc(today, "00:00", tz).toISOString();
  const to14 = zonedToUtc(addDaysYmd(today, 14), "00:00", tz).toISOString();
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();

  const [{ data: upcoming }, { data: recent }, { data: convs }, svc, sch, wa, ig] = await Promise.all([
    db().from("appointment_details").select("*").eq("clinic_id", clinic.id).gte("starts_at", from).lt("starts_at", to14).order("starts_at"),
    db().from("appointments").select("channel, status, created_at").eq("clinic_id", clinic.id).gte("created_at", since30),
    db().from("conversations").select("id, wa_id, profile_name, last_message, last_message_at, mode, unread").eq("clinic_id", clinic.id).order("last_message_at", { ascending: false }).limit(5),
    db().from("services").select("*", { count: "exact", head: true }).eq("clinic_id", clinic.id).eq("active", true),
    db().from("schedules").select("*", { count: "exact", head: true }).eq("clinic_id", clinic.id),
    db().from("whatsapp_accounts").select("id").eq("clinic_id", clinic.id).maybeSingle(),
    db().from("instagram_accounts").select("clinic_id").eq("clinic_id", clinic.id).maybeSingle(),
  ]);

  const active = (upcoming ?? []).filter((a: any) => ["pending", "confirmed", "completed"].includes(a.status));
  const todays = active.filter((a: any) => ymdInTz(new Date(a.starts_at), tz) === today);
  const week = active.filter((a: any) => a.starts_at < zonedToUtc(addDaysYmd(today, 7), "00:00", tz).toISOString());
  const confirmed = week.filter((a: any) => a.status === "confirmed").length;
  const confirmRate = week.length ? Math.round((confirmed / week.length) * 100) : 0;
  const rec = recent ?? [];
  const auto = rec.filter((a: any) => a.channel !== "panel").length;
  const autoRate = rec.length ? Math.round((auto / rec.length) * 100) : 0;

  // Serie diaria (14 días) — un solo color, tooltip por barra
  const days = Array.from({ length: 14 }, (_, i) => addDaysYmd(today, i));
  const perDay = days.map((d) => ({ d, n: active.filter((a: any) => ymdInTz(new Date(a.starts_at), tz) === d).length }));
  const max = Math.max(1, ...perDay.map((x) => x.n));

  const byChannel = ["whatsapp", "web", "panel"].map((c) => ({ c, n: rec.filter((a: any) => a.channel === c).length }));
  const chMax = Math.max(1, ...byChannel.map((x) => x.n));

  const steps = [
    { ok: (svc.count ?? 0) > 0, t: "Revisa tus servicios y precios", href: "/panel/servicios" },
    { ok: (sch.count ?? 0) > 0, t: "Define los horarios de atención", href: "/panel/servicios" },
    { ok: !!wa.data, t: "Conecta tu número de WhatsApp", href: "/panel/whatsapp" },
    { ok: !!clinic.address, t: "Agrega dirección y datos del consultorio", href: "/panel/ajustes" },
    { ok: !!ig.data, t: "Conecta Instagram (opcional)", href: "/panel/instagram" },
  ];
  const pending = steps.filter((s) => !s.ok).length;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="page-head">
        <div>
          <h1>Hola, {memberName.replace(/^(dr|dra|dr\(a\))\.?\s+/i, "").split(" ")[0]} 👋</h1>
          <p>{sp.bienvenida ? "¡Tu consultorio está listo! Completa estos pasos para empezar a recibir horas." : `Esto es lo que pasa hoy en ${clinic.name}.`}</p>
        </div>
      </div>

      <div className="kpis">
        <Kpi icon="calendar" bg="var(--mint)" c="var(--teal-700)" label="Citas hoy" value={todays.length} sub={todays.length ? `Primera: ${hmInTz(new Date(todays[0].starts_at), tz)} hrs` : "Agenda libre"} />
        <Kpi icon="clock" bg="var(--blue-50)" c="#2350b8" label="Próximos 7 días" value={week.length} sub={`${confirmed} confirmadas`} />
        <Kpi icon="check" bg="var(--sun-50)" c="#9a5b00" label="Tasa de confirmación" value={`${confirmRate}%`} sub="citas de la semana" />
        <Kpi icon="sparkles" bg="var(--violet-50)" c="#5a3fd0" label="Reservas automáticas" value={`${autoRate}%`} sub={`${auto} de ${rec.length} en 30 días`} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3>Citas agendadas · próximos 14 días</h3>
            <Link href="/panel/citas" className="btn btn-sm">Ver agenda</Link>
          </div>
          <div className="card-pad">
            <div className="bars" role="img" aria-label="Citas por día en los próximos 14 días">
              {perDay.map((x) => (
                <div className="bar" key={x.d}>
                  <span className="tip">{shortDayLabel(x.d)}: {x.n} cita{x.n === 1 ? "" : "s"}</span>
                  <i style={{ height: `${(x.n / max) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="bar-labels">
              {perDay.map((x) => <span key={x.d}>{shortDayLabel(x.d).split(" ")[0].slice(0, 2)} {Number(x.d.slice(8))}</span>)}
            </div>
            <table className="sr-only"><tbody>{perDay.map((x) => <tr key={x.d}><td>{x.d}</td><td>{x.n}</td></tr>)}</tbody></table>
          </div>
        </div>

        {pending > 0 ? (
          <div className="card">
            <div className="card-head"><h3>Configura tu consultorio</h3><span className="badge plain">{steps.length - pending}/{steps.length}</span></div>
            <div style={{ padding: "4px 20px 10px" }}>
              {steps.map((s) => (
                <Link href={s.href} key={s.t} className="check-item">
                  <span className={`dot-ok ${s.ok ? "y" : "n"}`}>{s.ok && <Icon name="check" size={13} stroke={3} />}</span>
                  <span className="grow small" style={{ textDecoration: s.ok ? "line-through" : "none", color: s.ok ? "var(--faint)" : "var(--ink)" }}>{s.t}</span>
                  {!s.ok && <Icon name="right" size={16} />}
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-head"><h3>Origen de reservas · 30 días</h3></div>
            <div className="card-pad stack-sm">
              {byChannel.map((x) => (
                <div key={x.c} className="stack-sm" style={{ gap: 4 }}>
                  <div className="row-between small"><span>{CHANNEL[x.c]}</span><b>{x.n}</b></div>
                  <div style={{ height: 8, background: "var(--bg)", borderRadius: 4 }}>
                    <div style={{ width: `${(x.n / chMax) * 100}%`, height: "100%", background: "var(--teal)", borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>Próximas citas</h3><Link href="/panel/citas?nueva=1" className="btn btn-sm btn-primary"><Icon name="plus" size={14} /> Nueva</Link></div>
          {active.length ? (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {active.slice(0, 8).map((a: any) => (
                    <tr key={a.id}>
                      <td style={{ width: 120 }}>
                        <b>{hmInTz(new Date(a.starts_at), tz)}</b>
                        <div className="tiny muted">{shortDayLabel(ymdInTz(new Date(a.starts_at), tz))}</div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{a.patient_name || "+" + a.patient_phone}</div>
                        <div className="tiny muted">{a.service_name} · {a.dentist_name}</div>
                      </td>
                      <td><span className={`badge b-${a.channel}`}>{CHANNEL[a.channel]}</span></td>
                      <td style={{ textAlign: "right" }}><span className={`badge b-${a.status}`}>{STATUS[a.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty"><Icon name="calendar" size={32} /><p>Aún no hay citas próximas.</p></div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h3>Últimas conversaciones</h3><Link href="/panel/conversaciones" className="btn btn-sm">Bandeja</Link></div>
          {convs?.length ? (
            <div>
              {convs.map((c: any) => (
                <Link key={c.id} href={`/panel/conversaciones?c=${c.id}`} className="conv">
                  <span className="avatar">{(c.profile_name || "?")[0]?.toUpperCase()}</span>
                  <div className="grow">
                    <div className="row-between">
                      <b className="small truncate">{c.profile_name || "+" + c.wa_id}</b>
                      {c.mode === "human" ? <span className="badge b-pending">Recepción</span> : <span className="badge b-confirmed">Bot</span>}
                    </div>
                    <div className="tiny muted truncate">{c.last_message}</div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty"><Icon name="chat" size={32} /><p>Las conversaciones de WhatsApp aparecerán aquí.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, bg, c, label, value, sub }: { icon: string; bg: string; c: string; label: string; value: any; sub: string }) {
  return (
    <div className="card kpi">
      <div className="lbl"><span className="ic" style={{ background: bg, color: c }}><Icon name={icon} size={16} /></span>{label}</div>
      <div className="val">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
