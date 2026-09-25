import { requireContext } from "@/lib/session";
import { db } from "@/lib/supabase";
import { igAccountTotals, igPosts, igProfile, igReachSeries, type IgPost } from "@/lib/instagram";
import { Icon } from "@/components/Icon";
import { ActionForm, ConfirmSubmit } from "@/components/ActionForm";
import { Submit } from "@/components/Submit";
import { connectInstagram, disconnectInstagram } from "../actions";

export const metadata = { title: "Instagram" };
const n = (v?: number) => (v ?? 0).toLocaleString("es-CL");
const TYPE: Record<string, string> = { REELS: "Reel", FEED: "Post", STORY: "Historia", CAROUSEL_ALBUM: "Carrusel", IMAGE: "Imagen", VIDEO: "Video" };

export default async function InstagramPage() {
  const { clinic, role } = await requireContext();
  const { data: acc } = await db().from("instagram_accounts").select("*").eq("clinic_id", clinic.id).maybeSingle();

  if (!acc) {
    return (
      <div className="stack" style={{ gap: 22 }}>
        <div className="page-head"><div><h1>Instagram</h1><p>Mide cómo rinden tus publicaciones: visualizaciones, alcance, guardados y compartidos.</p></div></div>
        <div className="grid-2">
          <div className="card">
            <div className="card-head"><h3>Conectar cuenta profesional</h3></div>
            {role === "staff" ? <div className="card-pad muted small">Pide a un administrador conectar Instagram.</div> : (
              <ActionForm action={connectInstagram} className="card-pad form-grid">
                <label className="field"><span>ID de la cuenta de Instagram</span><input className="input mono" name="ig_user_id" placeholder="17841400000000000" required /><span className="hint">Instagram Business/Creator Account ID</span></label>
                <label className="field"><span>Token de acceso</span><input className="input mono" name="access_token" type="password" placeholder="EAAG… o IGAA…" required /></label>
                <label className="field"><span>Tipo de conexión</span>
                  <select className="select" name="api_host">
                    <option value="graph.facebook.com">Instagram vinculado a página de Facebook (token EAAG…)</option>
                    <option value="graph.instagram.com">Inicio de sesión con Instagram (token IGAA…)</option>
                  </select>
                </label>
                <Submit className="btn btn-primary" pendingText="Verificando…"><Icon name="instagram" size={16} /> Conectar</Submit>
              </ActionForm>
            )}
          </div>
          <div className="card card-pad stack-sm small">
            <b>¿Dónde obtengo estos datos?</b>
            <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }} className="muted">
              <li>Tu Instagram debe ser cuenta <b>profesional</b> (Empresa o Creador).</li>
              <li>En tu app de Meta agrega el producto <b>Instagram</b> y concede los permisos <span className="mono">instagram_basic</span> e <span className="mono">instagram_manage_insights</span> (o <span className="mono">instagram_business_basic</span> e <span className="mono">instagram_business_manage_insights</span>).</li>
              <li>Con el Explorador de la API Graph consulta <span className="mono">me/accounts?fields=instagram_business_account</span> para obtener el ID.</li>
              <li>Genera un token de larga duración y pégalo aquí. Molara solo lee métricas: nunca publica.</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  let error = "";
  let profile: any = null;
  let posts: IgPost[] = [];
  let totals: Record<string, number> = {};
  let series: { date: string; value: number }[] = [];
  try {
    [profile, posts, totals, series] = await Promise.all([igProfile(acc), igPosts(acc, 12), igAccountTotals(acc, 28), igReachSeries(acc, 28)]);
  } catch (e: any) {
    error = e.message;
  }

  const sum = (k: string) => posts.reduce((a, p) => a + (p.insights[k] ?? 0), 0);
  const likes = posts.reduce((a, p) => a + (p.like_count ?? 0), 0);
  const comments = posts.reduce((a, p) => a + (p.comments_count ?? 0), 0);
  const views = sum("views");
  const reach = sum("reach");
  const engagement = reach ? (((likes + comments + sum("saved") + sum("shares")) / reach) * 100).toFixed(1) : "0";
  const top = [...posts].sort((a, b) => (b.insights.views ?? 0) - (a.insights.views ?? 0))[0];
  const max = Math.max(1, ...series.map((s) => s.value));

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="page-head">
        <div className="row">
          {profile?.profile_picture_url ? <img src={profile.profile_picture_url} alt="" width={56} height={56} style={{ borderRadius: "50%" }} /> : <span className="avatar" style={{ width: 56, height: 56 }}><Icon name="instagram" /></span>}
          <div>
            <h1>@{profile?.username ?? acc.username}</h1>
            <p>{profile ? `${n(profile.followers_count)} seguidores · ${n(profile.media_count)} publicaciones` : "Instagram"}</p>
          </div>
        </div>
        {role !== "staff" && <form action={disconnectInstagram}><ConfirmSubmit message="¿Desconectar Instagram?" className="btn btn-sm btn-danger">Desconectar</ConfirmSubmit></form>}
      </div>

      {error && <div className="alert alert-err">No se pudieron leer las métricas: {error}. Revisa que el token siga vigente y tenga permisos de insights.</div>}

      <div className="kpis">
        <div className="card kpi"><div className="lbl"><span className="ic" style={{ background: "#fdebf5", color: "#c13584" }}><Icon name="eye" size={16} /></span>Visualizaciones</div><div className="val">{n(totals.views ?? views)}</div><div className="sub">{totals.views != null ? "cuenta · últimos 28 días" : "últimas 12 publicaciones"}</div></div>
        <div className="card kpi"><div className="lbl"><span className="ic" style={{ background: "var(--blue-50)", color: "#2350b8" }}><Icon name="users" size={16} /></span>Alcance</div><div className="val">{n(totals.reach ?? reach)}</div><div className="sub">cuentas únicas alcanzadas</div></div>
        <div className="card kpi"><div className="lbl"><span className="ic" style={{ background: "var(--sun-50)", color: "#9a5b00" }}><Icon name="heart" size={16} /></span>Interacciones</div><div className="val">{n(totals.total_interactions ?? likes + comments)}</div><div className="sub">{n(likes)} me gusta · {n(comments)} comentarios</div></div>
        <div className="card kpi"><div className="lbl"><span className="ic" style={{ background: "var(--mint)", color: "var(--teal-700)" }}><Icon name="chart" size={16} /></span>Engagement</div><div className="val">{engagement}%</div><div className="sub">interacciones / alcance por post</div></div>
      </div>

      {series.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Alcance diario · 28 días</h3></div>
          <div className="card-pad">
            <div className="bars" role="img" aria-label="Alcance diario">
              {series.map((s) => (
                <div className="bar" key={s.date}><span className="tip">{s.date.slice(8)}/{s.date.slice(5, 7)}: {n(s.value)}</span><i style={{ height: `${(s.value / max) * 100}%`, background: "#c13584" }} /></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {top && (
        <div className="card card-pad row wrap" style={{ gap: 20 }}>
          <div style={{ width: 120, aspectRatio: 1, borderRadius: 12, background: `var(--bg) url(${top.thumbnail_url || top.media_url}) center/cover` }} />
          <div className="grow stack-sm">
            <span className="badge b-web">🏆 Publicación con más visualizaciones</span>
            <p className="small" style={{ maxWidth: 640 }}>{(top.caption || "Sin descripción").slice(0, 180)}</p>
            <div className="row small muted wrap"><span>{n(top.insights.views)} visualizaciones</span>·<span>{n(top.insights.reach)} alcance</span>·<span>{n(top.insights.saved)} guardados</span>·<span>{n(top.insights.shares)} compartidos</span></div>
          </div>
          <a href={top.permalink} target="_blank" className="btn btn-sm">Ver en Instagram</a>
        </div>
      )}

      <div className="row-between"><h2 style={{ fontSize: 20 }}>Últimas publicaciones</h2><span className="tiny muted">Datos de Instagram Graph API · se actualizan cada 10 min</span></div>
      <div className="ig-grid">
        {posts.map((p) => (
          <a key={p.id} href={p.permalink} target="_blank" className="card ig-post">
            <div className="thumb" style={{ backgroundImage: `url(${p.thumbnail_url || p.media_url})` }}>
              <span className="badge plain" style={{ background: "rgba(255,255,255,.92)" }}>{TYPE[p.media_product_type ?? ""] ?? TYPE[p.media_type] ?? p.media_type}</span>
            </div>
            <div className="ig-metrics">
              <div><b>{n(p.insights.views)}</b><span>Vistas</span></div>
              <div><b>{n(p.insights.reach)}</b><span>Alcance</span></div>
              <div><b>{n(p.like_count)}</b><span>Me gusta</span></div>
              <div><b>{n(p.comments_count)}</b><span>Coment.</span></div>
              <div><b>{n(p.insights.saved)}</b><span>Guardados</span></div>
              <div><b>{n(p.insights.shares)}</b><span>Compart.</span></div>
            </div>
            <div style={{ padding: "8px 10px" }} className="tiny muted truncate">{new Date(p.timestamp).toLocaleDateString("es-CL")} · {p.caption?.slice(0, 60) || "—"}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
