// Instagram Graph API — métricas de cuenta y publicaciones (solo lectura).
const V = process.env.API_VERSION || "v22.0";

export type IgAccount = { ig_user_id: string; access_token: string; api_host: string };

async function get(acc: IgAccount, path: string, params: Record<string, string> = {}) {
  const host = acc.api_host === "graph.instagram.com" ? "graph.instagram.com" : "graph.facebook.com";
  const qs = new URLSearchParams({ ...params, access_token: acc.access_token });
  const r = await fetch(`https://${host}/${V}/${path}?${qs}`, { next: { revalidate: 600 } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Instagram respondió ${r.status}`);
  return j;
}

export async function igProfile(acc: IgAccount) {
  return get(acc, acc.ig_user_id, {
    fields: "id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website",
  });
}

export type IgPost = {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
  insights: Record<string, number>;
};

const POST_METRICS = ["views", "reach", "saved", "shares", "total_interactions"];

export async function igPosts(acc: IgAccount, limit = 12): Promise<IgPost[]> {
  const j = await get(acc, `${acc.ig_user_id}/media`, {
    fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
    limit: String(limit),
  });
  const posts: IgPost[] = (j.data ?? []).map((p: any) => ({ ...p, insights: {} }));
  await Promise.all(
    posts.map(async (p) => {
      try {
        const ins = await get(acc, `${p.id}/insights`, { metric: POST_METRICS.join(",") });
        for (const m of ins.data ?? []) p.insights[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
      } catch {
        // Algunas métricas no aplican a ciertos formatos: probamos de a una
        for (const metric of POST_METRICS) {
          try {
            const ins = await get(acc, `${p.id}/insights`, { metric });
            const m = ins.data?.[0];
            if (m) p.insights[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
          } catch {}
        }
      }
    })
  );
  return posts;
}

/** Métricas agregadas de la cuenta en los últimos N días (máx. 30). */
export async function igAccountTotals(acc: IgAccount, days = 28) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;
  const out: Record<string, number> = {};
  for (const metric of ["reach", "views", "accounts_engaged", "total_interactions", "profile_views", "website_clicks"]) {
    try {
      const j = await get(acc, `${acc.ig_user_id}/insights`, {
        metric,
        period: "day",
        metric_type: "total_value",
        since: String(since),
        until: String(until),
      });
      out[metric] = j.data?.[0]?.total_value?.value ?? 0;
    } catch {}
  }
  return out;
}

/** Serie diaria de alcance para el gráfico. */
export async function igReachSeries(acc: IgAccount, days = 28) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;
  try {
    const j = await get(acc, `${acc.ig_user_id}/insights`, { metric: "reach", period: "day", since: String(since), until: String(until) });
    return (j.data?.[0]?.values ?? []).map((v: any) => ({ date: String(v.end_time).slice(0, 10), value: Number(v.value) || 0 }));
  } catch {
    return [];
  }
}
