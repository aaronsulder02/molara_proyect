// Cliente "tipo supabase-js" respaldado por Postgres real (solo pruebas).
import pg from "pg";

const TO_ONE: Record<string, string> = { dentists: "dentist_id", services: "service_id", patients: "patient_id", clinics: "clinic_id" };

type Embed = { alias: string; table: string; cols: string };

function parseSelect(sel: string): { cols: string; embeds: Embed[] } {
  const embeds: Embed[] = [];
  let rest = sel;
  const re = /(?:(\w+):)?(\w+)\(([^()]*)\)/g;
  let m;
  while ((m = re.exec(sel))) embeds.push({ alias: m[1] || m[2], table: m[2], cols: m[3] });
  rest = sel.replace(re, "").split(",").map((s) => s.trim()).filter(Boolean).join(", ");
  return { cols: rest || "*", embeds };
}

class Q {
  op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  sel = "*";
  returning = false;
  filters: [string, any[]][] = [];
  orders: string[] = [];
  lim: number | null = null;
  mode: "many" | "single" | "maybe" = "many";
  rows: any[] = [];
  patch: any = null;
  conflict = "";
  countHead = false;
  constructor(private pool: pg.Pool, private table: string) {}
  select(s = "*", opts?: any) { if (this.op === "select") this.sel = s; else { this.returning = true; this.sel = s; } if (opts?.head) this.countHead = true; return this; }
  insert(r: any) { this.op = "insert"; this.rows = Array.isArray(r) ? r : [r]; return this; }
  upsert(r: any, o?: any) { this.op = "upsert"; this.rows = Array.isArray(r) ? r : [r]; this.conflict = o?.onConflict || "id"; return this; }
  update(p: any) { this.op = "update"; this.patch = p; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: any) { this.filters.push([`"${c}" = $?`, [v]]); return this; }
  neq(c: string, v: any) { this.filters.push([`"${c}" <> $?`, [v]]); return this; }
  gt(c: string, v: any) { this.filters.push([`"${c}" > $?`, [v]]); return this; }
  gte(c: string, v: any) { this.filters.push([`"${c}" >= $?`, [v]]); return this; }
  lt(c: string, v: any) { this.filters.push([`"${c}" < $?`, [v]]); return this; }
  is(c: string, v: any) { this.filters.push([`"${c}" is ${v === null ? "null" : v}`, []]); return this; }
  in(c: string, v: any[]) { this.filters.push([`"${c}"::text = any($?)`, [v.map(String)]]); return this; }
  or() { return this; }
  order(c: string, o?: any) { this.orders.push(`"${c}" ${o?.ascending === false ? "desc" : "asc"}`); return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  private where(params: any[]) {
    if (!this.filters.length) return "";
    return " where " + this.filters.map(([sql, vals]) => { let s = sql; for (const v of vals) { params.push(v); s = s.replace("$?", `$${params.length}`); } return s; }).join(" and ");
  }

  async exec() {
    if (process.env.DBG) console.log("[db]", this.op, this.table, this.sel, JSON.stringify(this.filters.map(f=>f[1])));
    const params: any[] = [];
    const { cols, embeds } = parseSelect(this.sel);
    try {
      let sql = "";
      if (this.op === "select") {
        if (this.countHead) {
          const r = await this.pool.query(`select count(*)::int c from public.${this.table}${this.where(params)}`, params);
          return { data: null, error: null, count: r.rows[0].c };
        }
        const extra = cols === "*" ? [] : embeds.map((e) => TO_ONE[e.table]).filter((fk) => fk && fk !== TO_ONE[this.table]);
        sql = `select ${cols === "*" ? "*" : [cols, ...extra.map((x) => `"${x}"`)].join(", ")} from public.${this.table}${this.where(params)}${this.orders.length ? " order by " + this.orders.join(",") : ""}${this.lim ? " limit " + this.lim : ""}`;
      } else if (this.op === "insert" || this.op === "upsert") {
        const keys = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
        const values = this.rows.map((r) => "(" + keys.map((k) => { params.push(r[k] === undefined ? null : typeof r[k] === "object" && r[k] !== null ? JSON.stringify(r[k]) : r[k]); return `$${params.length}`; }).join(",") + ")").join(",");
        sql = `insert into public.${this.table} (${keys.map((k) => `"${k}"`).join(",")}) values ${values}`;
        if (this.op === "upsert") sql += ` on conflict (${this.conflict}) do update set ${keys.map((k) => `"${k}" = excluded."${k}"`).join(",")}`;
        sql += " returning *";
      } else if (this.op === "update") {
        const sets = Object.entries(this.patch).map(([k, v]) => { params.push(typeof v === "object" && v !== null ? JSON.stringify(v) : v); return `"${k}" = $${params.length}`; });
        sql = `update public.${this.table} set ${sets.join(",")}${this.where(params)} returning *`;
      } else {
        sql = `delete from public.${this.table}${this.where(params)} returning *`;
      }
      const r = await this.pool.query(sql, params);
      let rows = r.rows.map(norm);
      for (const e of embeds) {
        const fk = TO_ONE[e.table];
        for (const row of rows) {
          if (fk && row[fk] !== undefined) {
            const x = row[fk] ? await this.pool.query(`select ${e.cols} from public.${e.table} where id = $1`, [row[fk]]) : { rows: [] };
            row[e.alias] = x.rows[0] ? norm(x.rows[0]) : null;
          } else {
            const back = TO_ONE[this.table];
            const x = await this.pool.query(`select ${e.cols} from public.${e.table} where "${back}" = $1`, [row.id]);
            row[e.alias] = x.rows.map(norm);
          }
        }
      }
      if (this.op !== "select" && !this.returning) return { data: null, error: null };
      if (this.mode === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
      if (this.mode === "maybe") return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    } catch (e: any) {
      return { data: null, error: { code: e.code, message: e.message } };
    }
  }
  then(res: any, rej: any) { return this.exec().then(res, rej); }
}

function norm(row: any) {
  const o: any = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) o[k] = v.toISOString();
    else if (typeof v === "string" && /^\d{2}:\d{2}:\d{2}$/.test(v)) o[k] = v;
    else o[k] = v;
  }
  return o;
}

export function fakeDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return { from: (t: string) => new Q(pool, t), pool };
}
