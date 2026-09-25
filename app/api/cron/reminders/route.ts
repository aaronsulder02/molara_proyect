import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { sendRemindersForClinic } from "@/lib/bot";
import { runSetup, isPublicHttps, publicAppUrl } from "@/lib/metaConnect";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Cron diario (vercel.json): recordatorio a los pacientes con hora para mañana. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Reintenta la conexión automática de los números cuyo webhook quedó pendiente o con error
  const webhooks: any[] = [];
  if (isPublicHttps(publicAppUrl())) {
    const { data: pend } = await db().from("whatsapp_accounts").select("*").neq("webhook_status", "active").not("app_secret", "is", null);
    for (const a of pend ?? []) {
      const r = await runSetup(a.clinic_id, { phoneNumberId: a.phone_number_id, wabaId: a.waba_id, token: a.access_token, appId: a.app_id, appSecret: a.app_secret });
      webhooks.push({ clinic: a.clinic_id, status: r.ok ? r.status : "error", error: r.error ?? null });
    }
  }
  const { data: accounts } = await db().from("whatsapp_accounts").select("*, clinic:clinics(*)").eq("status", "connected");
  const results: any[] = [];
  for (const acc of accounts ?? []) {
    try {
      results.push({ clinic: acc.clinic?.name, ...(await sendRemindersForClinic(acc.clinic, acc)) });
    } catch (e: any) {
      results.push({ clinic: acc.clinic?.name, error: e?.message });
    }
  }
  return NextResponse.json({ ok: true, results, webhooks });
}
