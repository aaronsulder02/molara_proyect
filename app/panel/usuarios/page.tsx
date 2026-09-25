import { requireContext } from "@/lib/session";
import { db } from "@/lib/supabase";
import { Icon } from "@/components/Icon";
import { ActionForm, ConfirmSubmit } from "@/components/ActionForm";
import { Submit } from "@/components/Submit";
import { createMember, removeMember, updateMemberRole } from "../actions";

export const metadata = { title: "Equipo" };
const ROLE: Record<string, string> = { owner: "Dueño", admin: "Administrador", staff: "Recepción" };

export default async function Usuarios() {
  const { clinic, role, user } = await requireContext();
  const { data: members } = await db().from("clinic_members").select("*").eq("clinic_id", clinic.id).order("created_at");
  const admin = role !== "staff";

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="page-head"><div><h1>Equipo</h1><p>Usuarios con acceso al panel de {clinic.name}. Cada uno ingresa con su correo y contraseña.</p></div></div>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>Usuarios ({members?.length ?? 0})</h3></div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {(members ?? []).map((m: any) => (
                  <tr key={m.user_id}>
                    <td>
                      <div className="row">
                        <span className="avatar">{(m.full_name || m.email || "?")[0].toUpperCase()}</span>
                        <div><b>{m.full_name || "—"}{m.user_id === user.id && <span className="muted"> (tú)</span>}</b><div className="tiny muted">{m.email}</div></div>
                      </div>
                    </td>
                    <td>
                      {admin && m.role !== "owner" && m.user_id !== user.id ? (
                        <form action={updateMemberRole} className="row">
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <select className="select input-sm" name="role" defaultValue={m.role} style={{ width: 150 }}>
                            <option value="admin">Administrador</option>
                            <option value="staff">Recepción</option>
                          </select>
                          <Submit className="btn btn-xs" pendingText="…">Guardar</Submit>
                        </form>
                      ) : <span className="badge plain">{ROLE[m.role]}</span>}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {admin && m.role !== "owner" && m.user_id !== user.id && (
                        <form action={removeMember}><input type="hidden" name="user_id" value={m.user_id} /><ConfirmSubmit message="¿Quitar acceso a este usuario?" className="btn btn-xs btn-danger">Quitar</ConfirmSubmit></form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Agregar usuario</h3></div>
          {admin ? (
            <ActionForm action={createMember} className="card-pad form-grid" resetOnOk>
              <label className="field"><span>Nombre</span><input className="input" name="full_name" required placeholder="Javiera Soto" /></label>
              <label className="field"><span>Correo</span><input className="input" type="email" name="email" required placeholder="recepcion@consultorio.cl" /></label>
              <label className="field"><span>Contraseña inicial</span><input className="input" type="text" name="password" minLength={8} required placeholder="Mínimo 8 caracteres" autoComplete="off" /></label>
              <label className="field"><span>Rol</span>
                <select className="select" name="role" defaultValue="staff">
                  <option value="staff">Recepción — agenda, pacientes y conversaciones</option>
                  <option value="admin">Administrador — además configura servicios, equipo e integraciones</option>
                </select>
              </label>
              <Submit className="btn btn-primary" pendingText="Creando…"><Icon name="plus" size={16} /> Crear usuario</Submit>
            </ActionForm>
          ) : <div className="card-pad muted small">Solo administradores pueden agregar usuarios.</div>}
        </div>
      </div>
    </div>
  );
}
