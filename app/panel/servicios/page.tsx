import { requireContext } from "@/lib/session";
import { db } from "@/lib/supabase";
import { Icon } from "@/components/Icon";
import { ActionForm, OpenDialog, CloseDialog, ConfirmSubmit } from "@/components/ActionForm";
import { Submit } from "@/components/Submit";
import { saveService, toggleService, saveDentist, toggleDentist, saveSchedule, addBlock, deleteBlock } from "../actions";
import { WEEKDAYS_ES, humanDateTime, ymdInTz } from "@/lib/time.ts";

export const metadata = { title: "Servicios y horarios" };
const money = (n?: number | null) => (n ? "$" + n.toLocaleString("es-CL") : "—");
const ORDER = [1, 2, 3, 4, 5, 6, 0];

function ServiceForm({ s }: { s?: any }) {
  return (
    <ActionForm action={saveService} className="" resetOnOk={!s} closeDialog>
      <div className="modal-head"><h3>{s ? "Editar servicio" : "Nuevo servicio"}</h3><CloseDialog className="btn btn-ghost btn-sm">✕</CloseDialog></div>
      <div className="modal-body form-grid">
        {s && <input type="hidden" name="id" value={s.id} />}
        <label className="field"><span>Nombre</span><input className="input" name="name" defaultValue={s?.name ?? ""} maxLength={24} required /><span className="hint">Máx. 24 caracteres (límite de las listas de WhatsApp).</span></label>
        <label className="field"><span>Descripción corta</span><input className="input" name="description" defaultValue={s?.description ?? ""} maxLength={60} /></label>
        <div className="form-row">
          <label className="field"><span>Duración (min)</span><input className="input" type="number" name="duration_min" min={5} max={480} step={5} defaultValue={s?.duration_min ?? 30} required /></label>
          <label className="field"><span>Precio (CLP)</span><input className="input" name="price" inputMode="numeric" defaultValue={s?.price ?? ""} placeholder="35000" /></label>
        </div>
      </div>
      <div className="modal-foot"><CloseDialog>Cancelar</CloseDialog><Submit>Guardar</Submit></div>
    </ActionForm>
  );
}

function DentistForm({ d }: { d?: any }) {
  return (
    <ActionForm action={saveDentist} className="" resetOnOk={!d} closeDialog>
      <div className="modal-head"><h3>{d ? "Editar profesional" : "Nuevo profesional"}</h3><CloseDialog className="btn btn-ghost btn-sm">✕</CloseDialog></div>
      <div className="modal-body form-grid">
        {d && <input type="hidden" name="id" value={d.id} />}
        <label className="field"><span>Nombre</span><input className="input" name="name" defaultValue={d?.name ?? ""} placeholder="Dra. Paz Morales" required /></label>
        <div className="form-row">
          <label className="field"><span>Especialidad</span><input className="input" name="specialty" defaultValue={d?.specialty ?? ""} placeholder="Ortodoncia" /></label>
          <label className="field"><span>Color en agenda</span><input className="input" type="color" name="color" defaultValue={d?.color ?? "#0E9F8E"} style={{ padding: 4 }} /></label>
        </div>
        {!d && <p className="hint">Se crea con horario base lunes a viernes 09:00–18:00, editable después.</p>}
      </div>
      <div className="modal-foot"><CloseDialog>Cancelar</CloseDialog><Submit>Guardar</Submit></div>
    </ActionForm>
  );
}

export default async function Servicios() {
  const { clinic, role } = await requireContext();
  const admin = role !== "staff";
  const [{ data: services }, { data: dentists }, { data: schedules }, { data: blocks }] = await Promise.all([
    db().from("services").select("*").eq("clinic_id", clinic.id).order("sort").order("name"),
    db().from("dentists").select("*").eq("clinic_id", clinic.id).order("created_at"),
    db().from("schedules").select("*").eq("clinic_id", clinic.id).order("start_time"),
    db().from("blocked_times").select("*, dentist:dentists(name)").eq("clinic_id", clinic.id).gte("ends_at", new Date().toISOString()).order("starts_at"),
  ]);
  const today = ymdInTz(new Date(), clinic.timezone);

  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="page-head"><div><h1>Servicios y horarios</h1><p>Lo que ofreces y cuándo atiendes. El asistente y la agenda web usan esta información.</p></div></div>

      {/* SERVICIOS */}
      <div className="card">
        <div className="card-head">
          <h3>Servicios</h3>
          {admin && <OpenDialog target="new-service" className="btn btn-sm btn-primary"><Icon name="plus" size={14} /> Servicio</OpenDialog>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Servicio</th><th>Duración</th><th>Precio</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {(services ?? []).map((s: any) => (
                <tr key={s.id} style={{ opacity: s.active ? 1 : 0.55 }}>
                  <td><b>{s.name}</b><div className="tiny muted">{s.description}</div></td>
                  <td>{s.duration_min} min</td>
                  <td>{money(s.price)}</td>
                  <td>{s.active ? <span className="badge b-confirmed">Visible</span> : <span className="badge b-cancelled">Oculto</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    {admin && (
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <OpenDialog target={`s-${s.id}`} className="btn btn-xs">Editar</OpenDialog>
                        <form action={toggleService}>
                          <input type="hidden" name="id" value={s.id} /><input type="hidden" name="active" value={String(!s.active)} />
                          <Submit className="btn btn-xs btn-ghost" pendingText="…">{s.active ? "Ocultar" : "Mostrar"}</Submit>
                        </form>
                      </div>
                    )}
                    <dialog id={`s-${s.id}`} className="modal" style={{ textAlign: "left" }}><ServiceForm s={s} /></dialog>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* PROFESIONALES + HORARIOS */}
      <div className="row-between"><h2 style={{ fontSize: 20 }}>Profesionales y horarios de atención</h2>{admin && <OpenDialog target="new-dentist" className="btn btn-sm btn-primary"><Icon name="plus" size={14} /> Profesional</OpenDialog>}</div>
      <div className="grid-2-eq">
        {(dentists ?? []).map((d: any) => {
          const mine = (schedules ?? []).filter((s: any) => s.dentist_id === d.id);
          return (
            <div className="card" key={d.id} style={{ opacity: d.active ? 1 : 0.6 }}>
              <div className="card-head">
                <div className="row">
                  <span className="avatar" style={{ background: d.color + "22", color: d.color }}>{d.name.replace(/^(dr|dra)\(?a?\)?\.?\s*/i, "")[0]}</span>
                  <div><b>{d.name}</b><div className="tiny muted">{d.specialty}</div></div>
                </div>
                {admin && (
                  <div className="row">
                    <OpenDialog target={`d-${d.id}`} className="btn btn-xs">Editar</OpenDialog>
                    <form action={toggleDentist}>
                      <input type="hidden" name="id" value={d.id} /><input type="hidden" name="active" value={String(!d.active)} />
                      <Submit className="btn btn-xs btn-ghost" pendingText="…">{d.active ? "Desactivar" : "Activar"}</Submit>
                    </form>
                  </div>
                )}
              </div>
              <ActionForm action={saveSchedule} className="card-pad" >
                <input type="hidden" name="dentist_id" value={d.id} />
                <div>
                  {ORDER.map((wd) => (
                    <div className="sched-row" key={wd}>
                      <span className="small" style={{ fontWeight: 600, textTransform: "capitalize" }}>{WEEKDAYS_ES[wd]}</span>
                      <input
                        className="input input-sm"
                        name={`d${wd}`}
                        disabled={!admin}
                        defaultValue={mine.filter((s: any) => s.weekday === wd).map((s: any) => `${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}`).join(", ")}
                        placeholder="Cerrado"
                      />
                    </div>
                  ))}
                </div>
                {admin && <div className="row-between" style={{ marginTop: 12 }}><span className="hint">Ej: 09:00-13:00, 14:30-19:00</span><Submit className="btn btn-sm btn-primary">Guardar horario</Submit></div>}
              </ActionForm>
              <dialog id={`d-${d.id}`} className="modal"><DentistForm d={d} /></dialog>
            </div>
          );
        })}
      </div>

      {/* BLOQUEOS */}
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>Bloqueos próximos (vacaciones, congresos, feriados)</h3></div>
          {blocks?.length ? (
            <table className="table">
              <tbody>
                {blocks.map((b: any) => (
                  <tr key={b.id}>
                    <td><b>{b.reason || "Bloqueo"}</b><div className="tiny muted">{b.dentist?.name ?? "Todo el consultorio"}</div></td>
                    <td className="small">{humanDateTime(b.starts_at, clinic.timezone)}<br /><span className="muted">hasta {humanDateTime(b.ends_at, clinic.timezone)}</span></td>
                    <td style={{ textAlign: "right" }}>
                      <form action={deleteBlock}><input type="hidden" name="id" value={b.id} /><ConfirmSubmit message="¿Eliminar bloqueo?" className="btn btn-xs btn-danger">Quitar</ConfirmSubmit></form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty small">Sin bloqueos programados.</div>}
        </div>
        <div className="card">
          <div className="card-head"><h3>Agregar bloqueo</h3></div>
          <ActionForm action={addBlock} className="card-pad form-grid" resetOnOk>
            <label className="field"><span>Motivo</span><input className="input" name="reason" placeholder="Vacaciones, feriado…" /></label>
            <label className="field"><span>Profesional</span>
              <select className="select" name="dentist_id"><option value="">Todo el consultorio</option>{(dentists ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            </label>
            <div className="form-row">
              <label className="field"><span>Desde</span><input className="input" type="date" name="from_date" defaultValue={today} required /></label>
              <label className="field"><span>Hora</span><input className="input" type="time" name="from_time" defaultValue="00:00" /></label>
            </div>
            <div className="form-row">
              <label className="field"><span>Hasta</span><input className="input" type="date" name="to_date" defaultValue={today} /></label>
              <label className="field"><span>Hora</span><input className="input" type="time" name="to_time" defaultValue="23:59" /></label>
            </div>
            <Submit className="btn btn-primary">Bloquear horario</Submit>
          </ActionForm>
        </div>
      </div>

      <dialog id="new-service" className="modal"><ServiceForm /></dialog>
      <dialog id="new-dentist" className="modal"><DentistForm /></dialog>
    </div>
  );
}
