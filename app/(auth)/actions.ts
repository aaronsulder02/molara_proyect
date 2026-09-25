"use server";
import { redirect } from "next/navigation";
import { authClient, db } from "@/lib/supabase";
import { clearSessionCookies, setSessionCookies } from "@/lib/session";

export type FormState = { error?: string; ok?: string } | undefined;

function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "consultorio";
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const password = String(fd.get("password") || "");
  if (!email || !password) return { error: "Ingresa tu correo y contraseña." };
  const { data, error } = await authClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) return { error: "Correo o contraseña incorrectos." };
  await setSessionCookies(data.session.access_token, data.session.refresh_token);
  const next = String(fd.get("next") || "/panel");
  redirect(next.startsWith("/panel") ? next : "/panel");
}

export async function logout() {
  await clearSessionCookies();
  redirect("/login");
}

const DEFAULT_SERVICES = [
  { name: "Evaluación odontológica", duration_min: 30, price: 15000, description: "Diagnóstico y plan de tratamiento", sort: 1 },
  { name: "Limpieza dental", duration_min: 45, price: 35000, description: "Destartraje y profilaxis", sort: 2 },
  { name: "Urgencia dental", duration_min: 30, price: 25000, description: "Dolor, fractura o infección", sort: 3 },
  { name: "Tapadura (resina)", duration_min: 45, price: 40000, description: "Restauración estética", sort: 4 },
  { name: "Blanqueamiento", duration_min: 60, price: 120000, description: "Sesión en consulta", sort: 5 },
  { name: "Control de ortodoncia", duration_min: 30, price: 30000, description: "Ajuste de brackets", sort: 6 },
];

export async function register(_: FormState, fd: FormData): Promise<FormState> {
  const clinicName = String(fd.get("clinic") || "").trim();
  const fullName = String(fd.get("name") || "").trim();
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const password = String(fd.get("password") || "");
  const phone = String(fd.get("phone") || "").trim();
  const city = String(fd.get("city") || "").trim();

  if (clinicName.length < 3) return { error: "Ingresa el nombre del consultorio." };
  if (fullName.length < 3) return { error: "Ingresa tu nombre." };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Correo inválido." };
  if (password.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres." };

  // 1. Usuario (confirmado de inmediato para poder probar sin correo)
  const { data: created, error: uErr } = await db().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (uErr || !created.user) {
    const msg = uErr?.message?.toLowerCase() ?? "";
    return { error: msg.includes("already") ? "Ese correo ya tiene una cuenta. Ingresa desde “Iniciar sesión”." : uErr?.message || "No se pudo crear el usuario." };
  }
  const userId = created.user.id;

  try {
    // 2. Consultorio con slug único
    let slug = slugify(clinicName);
    const { data: taken } = await db().from("clinics").select("id").eq("slug", slug).maybeSingle();
    if (taken) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: clinic, error: cErr } = await db()
      .from("clinics")
      .insert({ name: clinicName, slug, phone: phone || null, email, city: city || null })
      .select("id")
      .single();
    if (cErr) throw cErr;

    // 3. Membresía como dueño
    const { error: mErr } = await db().from("clinic_members").insert({ clinic_id: clinic.id, user_id: userId, role: "owner", full_name: fullName, email });
    if (mErr) throw mErr;

    // 4. Datos iniciales: servicios, profesional y horario base
    await db().from("services").insert(DEFAULT_SERVICES.map((s) => ({ ...s, clinic_id: clinic.id })));
    const { data: dentist } = await db()
      .from("dentists")
      .insert({ clinic_id: clinic.id, name: fullName.match(/^(dr|dra)\.?\s/i) ? fullName : `Dr(a). ${fullName}`, specialty: "Odontología general" })
      .select("id")
      .single();
    if (dentist) {
      const blocks: any[] = [];
      for (const wd of [1, 2, 3, 4, 5]) {
        blocks.push({ clinic_id: clinic.id, dentist_id: dentist.id, weekday: wd, start_time: "09:00", end_time: "13:00" });
        blocks.push({ clinic_id: clinic.id, dentist_id: dentist.id, weekday: wd, start_time: "14:30", end_time: "19:00" });
      }
      blocks.push({ clinic_id: clinic.id, dentist_id: dentist.id, weekday: 6, start_time: "09:00", end_time: "13:00" });
      await db().from("schedules").insert(blocks);
    }
  } catch (e: any) {
    await db().auth.admin.deleteUser(userId).catch(() => null);
    return { error: `No se pudo crear el consultorio: ${e?.message ?? e}. ¿Ejecutaste supabase/schema.sql?` };
  }

  const { data: s } = await authClient().auth.signInWithPassword({ email, password });
  if (s?.session) await setSessionCookies(s.session.access_token, s.session.refresh_token);
  redirect("/panel?bienvenida=1");
}
