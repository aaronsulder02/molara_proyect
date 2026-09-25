import { requireContext } from "@/lib/session";
import { db } from "@/lib/supabase";
import { Icon } from "@/components/Icon";
import { ActionForm, OpenDialog, CloseDialog, ConfirmSubmit } from "@/components/ActionForm";
import { Submit } from "@/components/Submit";
import { savePatient, deletePatient } from "../actions";
import { humanDateTime } from "@/lib/time.ts";

export const metadata = { title: "Pacientes" };

function PatientForm({ p }: { p?: any }) {
  return (
    <ActionForm action={savePatient} className="" resetOnOk={!p} closeDialog>
      <div className="modal-head"><h3>{p ? "Editar paciente" : "Nuevo paciente"}</h3><CloseDialog className="btn btn-ghost btn-sm">✕</CloseDialog></div>
      <div className="modal-body form-grid">
        {p && <input type="hidden" name="id" value={p.id} />}
        <label className="field"><span>Nombre completo</span><input className="input" name="full_name" defaultValue={p?.full_name ?? ""} required /></label>
        <div className="form-row">
          <label className="field"><span>Celular (WhatsApp)</span><input className="input" name="phone" defaultValue={p ? "+" + p.phone : ""} placeholder="+56 9 1234 5678" required /></label>
          <label className="field"><span>RUT</span><input className="input" name="rut" defaultValue={p?.rut ?? ""} placeholder="12.345.678-9" /></label>
        </div>
        <label className="field"><span>Correo</span><input className="input" type="email" name="email" defaultValue={p?.email ?? ""} /></label>
        <label className="field"><span>Notas</span><textarea className="textarea" name="notes" defaultValue={p?.notes ?? ""} placeholder="Alergias informadas, preferencias…" /></label>
      </div>
      <div className="modal-foot"><CloseDialog>Cancelar</CloseDialog><Submit>Guardar</Submit></div>
    </ActionForm>
  );
}

export default async function Pacientes({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { clinic, role } = await requireContext();
  const { q } = await searchParams;
  let query = db().from("patients").select("*, appointments(id, starts_at, status)").eq("clinic_id", clinic.id).order("created_at", { ascending: false }).limit(200);
  if (q) {
    const s = q.replace(/[%,()]/g, "");
    query = query.or(`full_name.ilike.%${s}%,phone.ilike.%${s.replace(/\D/g, "") || s}%,rut.ilike.%${s}%,email.ilike.%${s}%`);
  }
  const { data: patients } = await query;
  const { count } = await db().from("patients").select("*", { count: "exact", head: true }).eq("clinic_id", clinic.id);
  const now = new Date().toISOString();

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Pacientes</h1><p>{count ?? 0} pacientes · se crean solos al agendar por WhatsApp o web</p></div>
        <OpenDialog target="new-patient"><Icon name="plus" size={16} /> Nuevo paciente</OpenDialog>
      </div>
      <form className="row" style={{ maxWidth: 480 }}>
        <input className="input" name="q" defaultValue={q ?? ""} placeholder="Buscar por nombre, teléfono, RUT o correo" />
        <button className="btn"><Icon name="search" size={16} /></button>
      </form>
      <div className="card">
        {patients?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Paciente</th><th>Contacto</th><th>Citas</th><th>Próxima</th><th></th></tr></thead>
              <tbody>
                {patients.map((p: any) => {
                  const next = (p.appointments ?? []).filter((a: any) => a.starts_at > now && ["pending", "confirmed"].includes(a.status)).sort((a: any, b: any) => a.starts_at.localeCompare(b.starts_at))[0];
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="row">
                          <span className="avatar">{(p.full_name || "?")[0].toUpperCase()}</span>
                          <div><div style={{ fontWeight: 600 }}>{p.full_name || "Sin nombre"}</div><div className="tiny muted">{p.rut || "—"}</div></div>
                        </div>
                      </td>
                      <td>
                        <a href={`https://wa.me/${p.phone}`} target="_blank" className="small" style={{ color: "var(--teal)" }}>+{p.phone}</a>
                        <div className="tiny muted">{p.email || ""}</div>
                      </td>
                      <td>{p.appointments?.length ?? 0}</td>
                      <td className="small">{next ? humanDateTime(next.starts_at, clinic.timezone) : <span className="faint">—</span>}</td>
                      <td style={{ textAlign: "right" }}>
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                          <OpenDialog target={`p-${p.id}`} className="btn btn-xs">Editar</OpenDialog>
                          {role !== "staff" && (
                            <form action={deletePatient}>
                              <input type="hidden" name="id" value={p.id} />
                              <ConfirmSubmit message="¿Eliminar paciente y todas sus citas?" className="btn btn-xs btn-danger">Eliminar</ConfirmSubmit>
                            </form>
                          )}
                        </div>
                        <dialog id={`p-${p.id}`} className="modal" style={{ textAlign: "left" }}><PatientForm p={p} /></dialog>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty"><Icon name="users" size={32} /><p>{q ? "Sin resultados." : "Aún no tienes pacientes."}</p></div>
        )}
      </div>
      <dialog id="new-patient" className="modal"><PatientForm /></dialog>
    </div>
  );
}
