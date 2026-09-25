// Servidor local compatible con la API de Supabase (PostgREST + GoTrue mínimos) sobre Postgres real.
// Permite ejecutar la app Next.js completa de punta a punta sin acceso a internet.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { fakeDb } from "./fakeDb";

const PORT = Number(process.env.FAKE_PORT || 54321);
const { from, pool } = fakeDb(process.env.FAKE_PG || "postgresql://postgres@127.0.0.1/molara_e2e");

const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub: string, email: string) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, email, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const sub = (token?: string) => { try { return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString()); } catch { return null; } };
const userObj = (u: any) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, user_metadata: u.meta ?? {}, app_metadata: {}, created_at: new Date().toISOString() });

async function body(req: http.IncomingMessage) {
  let s = ""; for await (const c of req) s += c; return s ? JSON.parse(s) : {};
}

function applyFilters(q: any, params: URLSearchParams) {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "on_conflict", "columns", "offset"].includes(k)) continue;
    if (k === "or") {
      const parts = v.replace(/^\(|\)$/g, "").split(",").map((p) => { const [c, op, ...r] = p.split("."); return { c, op, val: r.join(".") }; });
      q.filters.push([`(${parts.map((p) => `"${p.c}"::text ilike $?`).join(" or ")})`, parts.map((p) => p.val.replace(/\*/g, "%"))]);
      continue;
    }
    const [op, ...rest] = v.split("."); const val = decodeURIComponent(rest.join("."));
    if (op === "eq") q.eq(k, val);
    else if (op === "neq") q.neq(k, val);
    else if (op === "gt") q.gt(k, val);
    else if (op === "gte") q.gte(k, val);
    else if (op === "lt") q.lt(k, val);
    else if (op === "lte") q.filters.push([`"${k}" <= $?`, [val]]);
    else if (op === "is") q.is(k, val === "null" ? null : val);
    else if (op === "not") { const [op2, ...r2] = rest; const v2 = r2.join("."); if (op2 === "is") q.filters.push([`"${k}" is not ${v2 === "null" ? "null" : v2}`, []]); else if (op2 === "eq") q.neq(k, v2); }
    else if (op === "in") q.in(k, val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")));
    else if (op === "ilike") q.filters.push([`"${k}" ilike $?`, [val.replace(/\*/g, "%")]]);
  }
  const order = params.get("order");
  if (order) for (const o of order.split(",")) { const [c, dir] = o.split("."); q.order(c, { ascending: dir !== "desc" }); }
  if (params.get("limit")) q.limit(Number(params.get("limit")));
  return q;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  const send = (status: number, data: any, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(data === undefined ? "" : JSON.stringify(data));
  };
  try {
    /* ── GoTrue ── */
    if (url.pathname === "/auth/v1/admin/users" && req.method === "POST") {
      const b = await body(req);
      const ex = await pool.query("select * from auth.users where email=$1", [b.email]);
      if (ex.rows.length) return send(422, { code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" });
      const id = randomUUID();
      await pool.query("insert into auth.users(id,email,password,meta) values ($1,$2,$3,$4)", [id, b.email, b.password, JSON.stringify(b.user_metadata ?? {})]);
      return send(200, userObj({ id, email: b.email, meta: b.user_metadata }));
    }
    const adm = url.pathname.match(/^\/auth\/v1\/admin\/users\/([\w-]+)$/);
    if (adm) {
      if (req.method === "DELETE") { await pool.query("delete from auth.users where id=$1", [adm[1]]); return send(200, {}); }
      if (req.method === "PUT") { const b = await body(req); if (b.password) await pool.query("update auth.users set password=$2 where id=$1", [adm[1], b.password]); const u = (await pool.query("select * from auth.users where id=$1", [adm[1]])).rows[0]; return send(200, userObj(u)); }
    }
    if (url.pathname === "/auth/v1/token") {
      const b = await body(req);
      let u: any;
      if (url.searchParams.get("grant_type") === "password") u = (await pool.query("select * from auth.users where email=$1 and password=$2", [b.email, b.password])).rows[0];
      else u = (await pool.query("select * from auth.users where id=$1", [String(b.refresh_token).split(":")[1]])).rows[0];
      if (!u) return send(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials", code: 400, error_code: "invalid_credentials" });
      const at = jwt(u.id, u.email);
      return send(200, { access_token: at, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "rt:" + u.id, user: userObj(u) });
    }
    if (url.pathname === "/auth/v1/user") {
      const p = sub(req.headers.authorization?.replace("Bearer ", ""));
      const u = p && (await pool.query("select * from auth.users where id=$1", [p.sub])).rows[0];
      return u ? send(200, userObj(u)) : send(401, { msg: "invalid JWT", code: 401 });
    }

    /* ── PostgREST ── */
    const m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (m) {
      const q: any = from(m[1]);
      const prefer = String(req.headers.prefer || "");
      const accept = String(req.headers.accept || "");
      const single = accept.includes("vnd.pgrst.object");
      const sel = url.searchParams.get("select") || "*";
      if (req.method === "GET" || req.method === "HEAD") {
        q.select(sel, { head: req.method === "HEAD" && prefer.includes("count") });
        applyFilters(q, url.searchParams);
        const r = await q.exec();
        if (r.error) return send(400, r.error);
        if (req.method === "HEAD") { res.writeHead(200, { "content-range": `*/${r.count}` }); return res.end(); }
        if (prefer.includes("count")) {
          const c = await from(m[1]).select("*", { head: true }); applyFilters(c, url.searchParams); c.orders = []; c.lim = null;
          const rc = await c.exec(); res.setHeader("content-range", `0-${r.data.length}/${rc.count}`);
        }
        if (single) return r.data.length === 1 ? send(200, r.data[0]) : send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `${r.data.length} rows` });
        return send(200, r.data);
      }
      const b = await body(req);
      if (req.method === "POST") {
        if (prefer.includes("resolution=merge-duplicates")) q.upsert(b, { onConflict: url.searchParams.get("on_conflict") || "id" }); else q.insert(b);
      } else if (req.method === "PATCH") { q.update(b); applyFilters(q, url.searchParams); }
      else if (req.method === "DELETE") { q.delete(); applyFilters(q, url.searchParams); }
      q.select(sel);
      const r = await q.exec();
      if (r.error) return send(r.error.code === "23505" ? 409 : 400, r.error);
      if (!prefer.includes("return=representation")) return send(201, undefined);
      if (single) return r.data.length === 1 ? send(201, r.data[0]) : send(406, { code: "PGRST116", message: "no rows" });
      return send(201, r.data);
    }
    send(404, { message: "not found " + url.pathname });
  } catch (e: any) {
    console.error(e);
    send(500, { message: e.message });
  }
});

server.listen(PORT, () => console.log(`fake supabase en http://127.0.0.1:${PORT}`));
