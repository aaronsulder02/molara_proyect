"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

type Service = { id: string; name: string; duration_min: number; price: number | null; description: string | null };
type Dentist = { id: string; name: string; specialty: string | null; color: string | null };
type Slot = { dentistId: string; dentistName: string; start: string; end: string; hm: string };

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const money = (n: number | null) => (n ? "$" + n.toLocaleString("es-CL") : "");
const dayParts = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return { wd: DAYS[wd], d, m: MONTHS[m - 1] }; };

export function BookingWizard({ slug, services, dentists, clinicName, address, waNumber, tz }: { slug: string; services: Service[]; dentists: Dentist[]; clinicName: string; address: string | null; waNumber: string | null; tz: string }) {
  const [step, setStep] = useState(1);
  const [service, setService] = useState<Service | null>(null);
  const [dentist, setDentist] = useState<string>("");
  const [days, setDays] = useState<{ ymd: string; count: number }[] | null>(null);
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "", website: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<any>(null);

  useEffect(() => {
    if (!service) return;
    setDays(null); setDay(""); setSlots(null); setSlot(null);
    const q = new URLSearchParams({ service: service.id, ...(dentist ? { dentist } : {}) });
    fetch(`/api/public/${slug}/days?${q}`).then((r) => r.json()).then((j) => {
      setDays(j.days ?? []);
      if (j.days?.[0]) setDay(j.days[0].ymd);
    }).catch(() => setDays([]));
  }, [service, dentist, slug]);

  useEffect(() => {
    if (!service || !day) return;
    setSlots(null); setSlot(null);
    const q = new URLSearchParams({ service: service.id, date: day, ...(dentist ? { dentist } : {}) });
    fetch(`/api/public/${slug}/slots?${q}`).then((r) => r.json()).then((j) => setSlots(j.slots ?? [])).catch(() => setSlots([]));
  }, [day, service, dentist, slug]);

  const fmtTime = (iso: string) => {
    const s = new Intl.DateTimeFormat("es-CL", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
    return s.charAt(0).toUpperCase() + s.slice(1) + " hrs";
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!service || !slot) return;
    setSending(true); setError("");
    try {
      const r = await fetch(`/api/public/${slug}/book`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, serviceId: service.id, dentistId: slot.dentistId, start: slot.start }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || "No se pudo reservar.");
        if (r.status === 409) { setStep(2); setDay((d) => d); setSlots(null); const q = new URLSearchParams({ service: service.id, date: day, ...(dentist ? { dentist } : {}) }); fetch(`/api/public/${slug}/slots?${q}`).then((x) => x.json()).then((x) => setSlots(x.slots ?? [])); }
      } else { setDone(j); setStep(4); }
    } catch { setError("Error de conexión. Intenta nuevamente."); }
    setSending(false);
  }

  if (!services.length) return <div className="card card-pad empty">Este consultorio aún no publica servicios para reserva online.</div>;

  if (step === 4 && done && slot && service) {
    const start = new Date(slot.start); const end = new Date(slot.end);
    const g = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${service.name} · ${clinicName}`)}&dates=${g(start)}/${g(end)}&location=${encodeURIComponent(address ?? "")}&details=${encodeURIComponent(`Con ${slot.dentistName}`)}`;
    const waText = encodeURIComponent(`Hola, acabo de reservar ${service.name} para el ${fmtTime(slot.start)}. Mi nombre es ${form.name}.`);
    return (
      <div className="card card-pad stack" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--mint)", color: "var(--teal-700)", display: "grid", placeItems: "center", margin: "0 auto" }}><Icon name="check" size={32} stroke={2.6} /></div>
        <h2 style={{ fontSize: 28 }}>¡Hora reservada!</h2>
        <p className="muted">{service.name} con {slot.dentistName}<br /><b style={{ color: "var(--ink)" }}>{fmtTime(slot.start)}</b>{address ? <><br />{address}</> : null}</p>
        <div className="row wrap" style={{ justifyContent: "center" }}>
          {waNumber && <a className="btn btn-wa" target="_blank" href={`https://wa.me/${waNumber}?text=${waText}`}><Icon name="whatsapp" size={16} /> Recibir confirmación por WhatsApp</a>}
          <a className="btn" target="_blank" href={gcal}><Icon name="calendar" size={16} /> Agregar a Google Calendar</a>
        </div>
        <p className="tiny muted">Te enviaremos un recordatorio el día anterior. Puedes reagendar o cancelar respondiendo por WhatsApp.</p>
      </div>
    );
  }

  return (
    <div className="card card-pad">
      <div className="bk-steps">{[1, 2, 3].map((i) => <span key={i} className={i <= step ? "on" : ""} />)}</div>
      {error && <div className="alert alert-err" style={{ marginBottom: 14 }}>{error}</div>}

      {step === 1 && (
        <div className="stack">
          <div><h2 style={{ fontSize: 22 }}>¿Qué necesitas?</h2><p className="muted small">Elige el tipo de atención</p></div>
          <div className="stack-sm">
            {services.map((s) => (
              <button key={s.id} className={`opt${service?.id === s.id ? " on" : ""}`} onClick={() => { setService(s); setStep(2); }}>
                <span><b>{s.name}</b><span className="tiny muted" style={{ display: "block" }}>{s.duration_min} min{s.description ? ` · ${s.description}` : ""}</span></span>
                <span className="row"><b className="small">{money(s.price)}</b><Icon name="right" size={16} /></span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && service && (
        <div className="stack">
          <div className="row-between wrap">
            <div><h2 style={{ fontSize: 22 }}>Elige día y hora</h2><p className="muted small">{service.name} · {service.duration_min} min</p></div>
            <button className="btn btn-sm btn-ghost" onClick={() => setStep(1)}><Icon name="left" size={14} /> Cambiar servicio</button>
          </div>
          {dentists.length > 1 && (
            <label className="field"><span>Profesional</span>
              <select className="select" value={dentist} onChange={(e) => setDentist(e.target.value)}>
                <option value="">Cualquiera disponible</option>
                {dentists.map((d) => <option key={d.id} value={d.id}>{d.name}{d.specialty ? ` · ${d.specialty}` : ""}</option>)}
              </select>
            </label>
          )}
          {days === null ? <div className="days">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 76 }} />)}</div> : days.length ? (
            <div className="days">
              {days.map((d) => { const p = dayParts(d.ymd); return (
                <button key={d.ymd} className={`day-btn${day === d.ymd ? " on" : ""}`} onClick={() => setDay(d.ymd)}>
                  <span>{p.wd}</span><b>{p.d}</b><span>{p.m}</span>
                </button>
              ); })}
            </div>
          ) : <div className="empty small">No hay horarios disponibles en las próximas semanas.</div>}
          {day && (
            <div className="stack-sm">
              <span className="label">Horarios disponibles</span>
              {slots === null ? <div className="slots">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 42 }} />)}</div> : slots.length ? (
                <div className="slots">
                  {slots.map((s) => <button key={s.start + s.dentistId} className={`slot-btn${slot?.start === s.start && slot?.dentistId === s.dentistId ? " on" : ""}`} onClick={() => setSlot(s)}>{s.hm}</button>)}
                </div>
              ) : <span className="small muted">Ese día se llenó. Prueba otro.</span>}
            </div>
          )}
          {slot && (
            <div className="row-between wrap" style={{ background: "var(--mint-50)", padding: 14, borderRadius: 12 }}>
              <span className="small"><b>{fmtTime(slot.start)}</b> con {slot.dentistName}</span>
              <button className="btn btn-primary" onClick={() => setStep(3)}>Continuar <Icon name="arrow" size={16} /></button>
            </div>
          )}
        </div>
      )}

      {step === 3 && service && slot && (
        <form className="stack" onSubmit={submit}>
          <div className="row-between wrap">
            <div><h2 style={{ fontSize: 22 }}>Tus datos</h2><p className="muted small">{service.name} · {fmtTime(slot.start)}</p></div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setStep(2)}><Icon name="left" size={14} /> Cambiar hora</button>
          </div>
          <div className="form-grid">
            <label className="field"><span>Nombre y apellido</span><input className="input" required minLength={3} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></label>
            <div className="form-row">
              <label className="field"><span>Celular (WhatsApp)</span><input className="input" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+56 9 1234 5678" autoComplete="tel" inputMode="tel" /></label>
              <label className="field"><span>Correo (opcional)</span><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" /></label>
            </div>
            <label className="field"><span>Motivo o comentario (opcional)</span><textarea className="textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ minHeight: 70 }} /></label>
            <input tabIndex={-1} autoComplete="off" className="sr-only" aria-hidden="true" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} name="website" />
          </div>
          <button className="btn btn-primary btn-lg btn-block" disabled={sending}>{sending ? "Reservando…" : "Confirmar reserva"}</button>
          <p className="tiny muted" style={{ textAlign: "center" }}>Al reservar aceptas que {clinicName} te contacte por WhatsApp para confirmar tu hora.</p>
        </form>
      )}
    </div>
  );
}
