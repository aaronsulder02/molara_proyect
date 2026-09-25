import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { sendRemindersForClinic } from "@/lib/bot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Cron diario (vercel.json): recordatorio a los pacientes con hora para mañana. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
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
  return NextResponse.json({ ok: true, results });
}
