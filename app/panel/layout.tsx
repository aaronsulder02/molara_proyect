import Link from "next/link";
import { requireContext } from "@/lib/session";
import { db } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { PanelNav } from "@/components/PanelNav";
import { logout } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const { clinic } = ctx;
  const [{ count: unread }, { data: waAcc }] = await Promise.all([
    db().from("conversations").select("*", { count: "exact", head: true }).eq("clinic_id", clinic.id).eq("mode", "human").gt("unread", 0),
    db().from("whatsapp_accounts").select("display_phone, status").eq("clinic_id", clinic.id).maybeSingle(),
  ]);
  const trialDays = clinic.trial_ends_at ? Math.max(0, Math.ceil((new Date(clinic.trial_ends_at).getTime() - Date.now()) / 86400000)) : 0;
  const initials = ctx.memberName.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="app">
      <aside className="side">
        <Link href="/panel" className="brand"><Logo size={30} /></Link>
        <PanelNav unread={unread ?? 0} />
        <div className="side-foot stack-sm">
          {clinic.plan === "trial" && (
            <div className="card" style={{ padding: 14, background: "var(--mint-50)", borderColor: "#c7efe7" }}>
              <div className="small" style={{ fontWeight: 700 }}>Prueba gratis</div>
              <div className="tiny muted">Te quedan {trialDays} días</div>
              <div style={{ height: 6, background: "#c7efe7", borderRadius: 9, marginTop: 8, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, ((14 - trialDays) / 14) * 100)}%`, height: "100%", background: "var(--teal)" }} />
              </div>
            </div>
          )}
          <div className="row" style={{ padding: "6px 4px" }}>
            <span className="avatar">{initials || "U"}</span>
            <div className="grow">
              <div className="small truncate" style={{ fontWeight: 600 }}>{ctx.memberName}</div>
              <div className="tiny muted truncate">{ctx.role === "owner" ? "Dueño" : ctx.role === "admin" ? "Administrador" : "Recepción"}</div>
            </div>
            <form action={logout}>
              <button className="btn btn-ghost btn-sm" title="Cerrar sesión" aria-label="Cerrar sesión"><Icon name="logout" size={16} /></button>
            </form>
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div className="row" style={{ minWidth: 0 }}>
            <b className="truncate" style={{ fontSize: 15 }}>{clinic.name}</b>
            {waAcc ? (
              <span className="badge b-whatsapp">WhatsApp {waAcc.display_phone}</span>
            ) : (
              <Link href="/panel/whatsapp" className="badge b-pending">WhatsApp sin conectar</Link>
            )}
          </div>
          <div className="row">
            <a href={`/reservar/${clinic.slug}`} target="_blank" className="btn btn-sm"><Icon name="globe" size={15} /> Ver agenda web</a>
            <Link href="/panel/citas?nueva=1" className="btn btn-primary btn-sm"><Icon name="plus" size={15} /> Nueva cita</Link>
          </div>
        </div>
        <div className="page">{children}</div>
      </div>
    </div>
  );
}
