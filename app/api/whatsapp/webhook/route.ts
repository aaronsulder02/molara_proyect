import { after, NextResponse } from "next/server";
import { verifySignature, getAccountByPhoneId } from "@/lib/whatsapp";
import { handleInbound } from "@/lib/bot";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Verificación del webhook (Meta → Configuración → Webhook → Verificar y guardar) */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const mode = u.searchParams.get("hub.mode");
  const token = u.searchParams.get("hub.verify_token");
  const challenge = u.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Eventos entrantes: mensajes de pacientes y estados de entrega */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // Respondemos 200 de inmediato (Meta reintenta si tardamos) y procesamos después.
  after(async () => {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        const v = change.value ?? {};
        const phoneId = v.metadata?.phone_number_id;
        if (!phoneId) continue;
        const acc = await getAccountByPhoneId(phoneId);
        if (!acc) {
          console.warn("[webhook] número no registrado en Molara:", phoneId);
          continue;
        }
        for (const st of v.statuses ?? []) {
          await db()
            .from("messages")
            .update({ status: st.status, error: st.errors?.[0]?.message ?? null })
            .eq("wa_message_id", st.id);
        }
        for (const msg of v.messages ?? []) {
          const contact = (v.contacts ?? []).find((c: any) => c.wa_id === msg.from) ?? v.contacts?.[0];
          try {
            await handleInbound(acc, msg, contact);
          } catch (e) {
            console.error("[webhook] error procesando mensaje", e);
          }
        }
      }
    }
  });

  return NextResponse.json({ ok: true });
}
