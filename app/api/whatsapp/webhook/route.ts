import { after, NextResponse } from "next/server";
import { verifySignature, getAccountByPhoneId, getAccountsByPhoneIds } from "@/lib/whatsapp";
import { handleInbound } from "@/lib/bot";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Verificación del webhook.
 *  Acepta el token global de la plataforma (WEBHOOK_VERIFY_TOKEN) o el token propio de cada
 *  consultorio, que Molara registra en Meta automáticamente al conectar el número. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const mode = u.searchParams.get("hub.mode");
  const token = u.searchParams.get("hub.verify_token");
  const challenge = u.searchParams.get("hub.challenge") ?? "";
  const ok = () => new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  if (mode !== "subscribe" || !token) return new Response("Forbidden", { status: 403 });
  if (process.env.WEBHOOK_VERIFY_TOKEN && token === process.env.WEBHOOK_VERIFY_TOKEN) return ok();
  if (token.startsWith("molara_")) {
    const { data } = await db()
      .from("whatsapp_accounts")
      .update({ webhook_verified_at: new Date().toISOString() })
      .eq("webhook_verify_token", token)
      .select("id");
    if (data?.length) return ok();
  }
  return new Response("Forbidden", { status: 403 });
}

/** Eventos entrantes: mensajes de pacientes y estados de entrega */
export async function POST(req: Request) {
  const raw = await req.text();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  // Cada consultorio usa su propia app de Meta: la firma se valida con el App Secret
  // del consultorio dueño del número (o con el de la plataforma).
  const phoneIds = [
    ...new Set<string>(
      (body?.entry ?? []).flatMap((e: any) => (e?.changes ?? []).map((c: any) => c?.value?.metadata?.phone_number_id)).filter(Boolean).map(String)
    ),
  ];
  const accounts = await getAccountsByPhoneIds(phoneIds);
  // Regla: vale la firma de la plataforma, o la del App Secret de CADA número incluido
  // (así un consultorio no puede firmar eventos a nombre de otro).
  const sig = req.headers.get("x-hub-signature-256");
  const platform = process.env.META_APP_SECRET;
  const anySecret = !!platform || accounts.some((a) => a.app_secret);
  const valid = !anySecret
    ? verifySignature(raw, sig, []) // sin secretos configurados: solo en desarrollo
    : (!!platform && verifySignature(raw, sig, [platform])) ||
      (accounts.length > 0 && accounts.every((a) => !!a.app_secret && verifySignature(raw, sig, [a.app_secret])));
  if (!valid) {
    return new Response("Invalid signature", { status: 401 });
  }
  if (accounts.length) {
    await db()
      .from("whatsapp_accounts")
      .update({ webhook_last_event_at: new Date().toISOString(), webhook_status: "active" })
      .in("id", accounts.map((a) => a.id));
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
