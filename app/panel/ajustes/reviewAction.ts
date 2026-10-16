"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { cleanHandle, reviewTemplatePayload } from "@/lib/bot";
import { normalizePhone } from "@/lib/booking";
import { getAccountByClinic, sendWa } from "@/lib/whatsapp";

type S = { error?: string; ok?: string } | undefined;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Fidelización: link de reseñas de Google (día siguiente a la cita) e invitación a seguir el Instagram. */
export async function saveReviewLink(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireAdmin();
    const url = str(fd, "google_review_url");
    if (url && !/^https:\/\/\S+$/.test(url)) return { error: "El link de reseñas debe empezar con https:// (cópialo desde tu Perfil de Empresa de Google)." };
    const rawIg = str(fd, "instagram_handle");
    const handle = rawIg ? cleanHandle(rawIg) : null;
    if (rawIg && !handle) return { error: "Usuario de Instagram inválido. Escríbelo como @tuconsultorio o pega el link del perfil." };
    const { error } = await db()
      .from("clinics")
      .update({
        google_review_url: url || null,
        review_template: str(fd, "review_template") || null,
        review_template_lang: str(fd, "review_template_lang") || "es",
        instagram_handle: handle,
        instagram_perk: str(fd, "instagram_perk").slice(0, 120) || null,
      })
      .eq("id", clinic.id);
    if (error) return { error: error.message };
    revalidatePath("/panel", "layout");
    return { ok: "Fidelización guardada ✔" };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

/** Envía la plantilla de reseña a un número de prueba con datos de ejemplo, para comprobarla sin esperar al cron. */
export async function sendReviewTest(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireAdmin();
    if (!clinic.review_template) return { error: "Primero guarda el nombre de la plantilla de reseña." };
    const phone = normalizePhone(str(fd, "test_phone"));
    if (phone.length < 10) return { error: "Escribe un celular con código de país (ej: +56 9 1234 5678)." };
    const acc = await getAccountByClinic(clinic.id);
    if (!acc) return { error: "Conecta WhatsApp antes de probar la plantilla." };
    const { data: svc } = await db().from("services").select("name").eq("clinic_id", clinic.id).order("sort").limit(1).maybeSingle();
    const name = str(fd, "test_name") || "Camila";
    const r = await sendWa(acc, phone, reviewTemplatePayload(clinic, name, svc?.name ?? "limpieza dental"));
    if (r.ok) return { ok: `Enviada a +${phone} con: ${name} · ${svc?.name ?? "limpieza dental"} · ${clinic.name}. Revisa tu WhatsApp.` };
    const e = String(r.error || "");
    const hint = /132001|does not exist|not exist in/i.test(e) ? " → Meta no encuentra la plantilla con ese nombre e idioma (¿aún en revisión, o el idioma no es «" + (clinic.review_template_lang || "es") + "»?)."
      : /132000|parameter/i.test(e) ? " → La plantilla no tiene exactamente 3 variables ({{1}}, {{2}}, {{3}})."
      : /132015|paused|132016|disabled/i.test(e) ? " → Meta pausó o deshabilitó la plantilla."
      : "";
    return { error: `Meta respondió: ${e}${hint}` };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}
