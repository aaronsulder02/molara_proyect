# Molara — Recepción inteligente por WhatsApp para consultorios dentales

SaaS multi-consultorio construido con **Next.js 16 + Supabase + WhatsApp Cloud API (Meta) + Vercel AI Gateway**.
Dependencias de producción: solo `next`, `react`, `react-dom` y `@supabase/supabase-js`. Meta, la IA e Instagram se llaman con `fetch` nativo.

## Qué incluye

| Módulo | Ruta |
|---|---|
| Landing de marca (precios en CLP, FAQ, demo animada de WhatsApp) | `/` |
| Registro de consultorio (usuario + contraseña) e inicio de sesión | `/registro`, `/login` |
| Panel: resumen, agenda semanal/lista, pacientes, servicios y horarios, bloqueos | `/panel/...` |
| Bandeja de WhatsApp en tiempo real, tomar control / reactivar bot | `/panel/conversaciones` |
| Formulario para registrar el número propio de Meta (verifica y suscribe la app) | `/panel/whatsapp` |
| Métricas de Instagram (vistas, alcance, guardados, compartidos, engagement) | `/panel/instagram` |
| Equipo con roles (dueño / administrador / recepción) | `/panel/usuarios` |
| Agenda web pública por consultorio | `/reservar/[slug]` |
| Webhook de WhatsApp (firma HMAC, idempotente, respuesta inmediata) | `/api/whatsapp/webhook` |
| Recordatorios diarios con botones Confirmar / Reagendar / Cancelar | `/api/cron/reminders` (Vercel Cron) |

**Chatbot:** listas y botones nativos de Meta (menú, servicios, días, horarios paginados, confirmación, mis citas, reagendar, cancelar, ubicación con botón a Maps, enlace CTA a la agenda web, derivación a humano). Si hay clave del **Vercel AI Gateway**, el texto libre lo atiende un agente con *tool calling* que usa esas mismas pantallas interactivas; si la IA falla o no está configurada, responde por palabras clave. Nunca hay doble reserva: una restricción `EXCLUDE` en Postgres bloquea choques por profesional.

## Puesta en marcha (15 min)

1. **Base de datos:** Supabase → SQL Editor → pega y ejecuta `supabase/schema.sql` (se puede re-ejecutar).
2. **Variables:** copia `.env.example` a `.env.local` y completa. Imprescindible agregar **`SUPABASE_SECRET_KEY`** (Supabase → Project Settings → API Keys → *Secret keys*): el webhook y el alta de usuarios la necesitan.
3. `npm install` y `npm run dev` → abre http://localhost:3000, crea tu consultorio.
4. **Desplegar en Vercel** (el webhook de Meta necesita URL pública HTTPS): importa el repo, copia las variables y pon `NEXT_PUBLIC_APP_URL` con tu dominio. En Vercel el AI Gateway se autentica solo (OIDC); en local usa `AI_GATEWAY_API_KEY`.
5. **Meta → tu app → WhatsApp → Configuración → Webhook:** URL `https://TU-DOMINIO/api/whatsapp/webhook`, token = `WEBHOOK_VERIFY_TOKEN`, suscribe el campo `messages`.
6. En el panel → **WhatsApp**, marca “Usar el número de ejemplo” (lee `BUSINESS_PHONE`, `WABA_ID`, `WHATSAPP_ACCESS_TOKEN`) o pega las credenciales de otro número. Escribe “Hola” a ese número y el bot responde.

> Recordatorios fuera de la ventana de 24 h: crea en Meta una plantilla UTILITY con `{{1}}` nombre, `{{2}}` fecha/hora, `{{3}}` consultorio y 2 botones rápidos (Confirmo / Cancelar), y escribe su nombre en *Ajustes → Asistente*.

## Pruebas

```bash
npm test                          # motor de disponibilidad y zona horaria
npm i -D tsx pg && npx tsx tests/e2e/bot.e2e.ts   # chatbot de punta a punta contra Postgres local
```

## Estructura

```
app/            páginas (landing, auth, panel, reservar) y API routes
lib/            slots.ts (motor puro), availability.ts, booking.ts, bot.ts, whatsapp.ts, ai.ts, instagram.ts, session.ts
supabase/       schema.sql (tablas, RLS, anti doble reserva, vista de agenda)
proxy.ts        protege /panel y renueva la sesión de Supabase
```
