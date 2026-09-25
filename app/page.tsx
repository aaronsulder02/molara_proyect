import Link from "next/link";
import { Logo, LogoMark } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { PhoneDemo } from "@/components/PhoneDemo";
import { Pricing } from "@/components/Pricing";

const FEATURES = [
  { icon: "sparkles", c: "var(--teal)", bg: "var(--mint)", t: "Asistente con IA", d: "Entiende mensajes como “¿tienes algo mañana en la tarde?” y responde con horarios reales de tu agenda." },
  { icon: "list", c: "#0f7a3d", bg: "#e4f9ec", t: "Botones nativos de WhatsApp", d: "Listas y botones oficiales de Meta: tus pacientes agendan con 3 toques, sin escribir ni equivocarse." },
  { icon: "globe", c: "#5a3fd0", bg: "var(--violet-50)", t: "Agenda web propia", d: "Un link de reserva con tu marca para Instagram, Google y tu sitio. Misma agenda, cero dobles reservas." },
  { icon: "bell", c: "#9a5b00", bg: "var(--sun-50)", t: "Recordatorios que confirman", d: "El día anterior tu paciente recibe su hora con botones para confirmar, reagendar o cancelar." },
  { icon: "headset", c: "#2350b8", bg: "var(--blue-50)", t: "Bandeja compartida", d: "Ve todas las conversaciones y toma el control cuando haga falta. El bot se pausa solo al derivar." },
  { icon: "instagram", c: "#c13584", bg: "#fdebf5", t: "Métricas de Instagram", d: "Visualizaciones, alcance, guardados y compartidos de cada publicación, sin salir del panel." },
  { icon: "shield", c: "var(--ink-2)", bg: "#eef2f1", t: "Equipo con roles", d: "Dueño, administradores y recepción, cada uno con su usuario y contraseña. Datos aislados por consultorio." },
];

const FAQ = [
  { q: "¿Necesito cambiar mi número de WhatsApp?", a: "Puedes usar un número nuevo o migrar el actual a la API oficial de WhatsApp Business (Cloud API). Lo registras en Meta y luego pegas sus identificadores en Molara; te guiamos paso a paso." },
  { q: "¿Es la API oficial de Meta?", a: "Sí. Molara usa exclusivamente WhatsApp Cloud API de Meta: sin riesgo de bloqueos por herramientas no oficiales, con nombre verificado y botones interactivos." },
  { q: "¿Qué pasa si el paciente pregunta algo clínico?", a: "El asistente nunca diagnostica. Ante urgencias, reclamos o preguntas clínicas deriva la conversación a tu equipo, que responde desde la bandeja del panel." },
  { q: "¿Cuánto cobra Meta por los mensajes?", a: "Las respuestas dentro de la ventana de 24 h iniciada por el paciente no tienen costo. Los recordatorios con plantilla fuera de esa ventana se cobran según la tarifa oficial de Meta para Chile, directo a tu cuenta." },
  { q: "¿Puedo tener varios dentistas con horarios distintos?", a: "Sí. Cada profesional tiene sus bloques de atención por día, y el motor de citas cruza servicios, duración, bloqueos y citas existentes para no chocar nunca." },
  { q: "¿Mis datos están seguros?", a: "Cada consultorio está aislado con Row Level Security en Postgres (Supabase). Solo los usuarios de tu equipo acceden a tus pacientes y citas." },
];

export default function Landing() {
  return (
    <div className="lp">
      <nav className="lp-nav">
        <div className="container">
          <Link href="/" aria-label="Molara inicio"><Logo size={32} /></Link>
          <div className="lp-links">
            <a href="#producto">Producto</a>
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#precios">Precios</a>
            <a href="#faq">Preguntas</a>
          </div>
          <div className="lp-cta">
            <Link href="/login" className="btn btn-ghost">Ingresar</Link>
            <Link href="/registro" className="btn btn-primary">Prueba gratis</Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className="hero">
        <div className="container">
          <div>
            <span className="eyebrow"><b>NUEVO</b> Asistente IA + botones oficiales de WhatsApp</span>
            <h1>
              Tu consultorio agenda <em>solo</em>, 24/7, por WhatsApp.
            </h1>
            <p className="lead">
              Molara es la recepcionista inteligente para odontólogos: responde, agenda, confirma y recuerda horas
              en WhatsApp y en la web, mientras tú atiendes pacientes.
            </p>
            <div className="hero-actions">
              <Link href="/registro" className="btn btn-primary btn-lg">
                Crear mi consultorio gratis <Icon name="arrow" size={18} />
              </Link>
              <a href="#como-funciona" className="btn btn-lg">Ver cómo funciona</a>
            </div>
            <div className="trust">
              <span><Icon name="shield" size={16} /> API oficial de Meta</span>
              <span><Icon name="bolt" size={16} /> Listo en 15 minutos</span>
              <span><Icon name="check" size={16} /> 14 días gratis, sin tarjeta</span>
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <PhoneDemo />
            <div className="float-card" style={{ left: -24, top: 90 }}>
              <div className="ic" style={{ background: "var(--mint)", color: "var(--teal-700)" }}><Icon name="calendar" /></div>
              <div><b>+1 hora agendada</b><span className="muted tiny">hace 2 min · WhatsApp</span></div>
            </div>
            <div className="float-card" style={{ right: -18, bottom: 110, animationDelay: "1.2s" }}>
              <div className="ic" style={{ background: "var(--sun-50)", color: "#9a5b00" }}><Icon name="bell" /></div>
              <div><b>Asistencia confirmada</b><span className="muted tiny">Recordatorio automático</span></div>
            </div>
          </div>
        </div>
      </header>

      <section className="strip" aria-label="Cifras">
        <div className="container">
          <div className="stat"><b>24/7</b><span>agenda abierta, incluso de madrugada</span></div>
          <div className="stat"><b>3 toques</b><span>para reservar con botones nativos</span></div>
          <div className="stat"><b>0</b><span>dobles reservas: motor anti-choque</span></div>
          <div className="stat"><b>15 min</b><span>para dejarlo funcionando</span></div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="section" id="producto">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Producto</span>
            <h2>Todo lo que hace una gran recepción, sin horario de cierre</h2>
            <p>La mayoría de tus pacientes ya te escribe por WhatsApp. Molara convierte cada mensaje en una hora agendada.</p>
          </div>
          <div className="features">
            <div className="feature big">
              <div>
                <div className="ic" style={{ background: "rgba(255,255,255,.1)", color: "#5eead4" }}><Icon name="calendar" /></div>
                <h3 style={{ fontSize: 26 }}>Un motor de citas, tres canales</h3>
                <p style={{ marginTop: 10 }}>
                  WhatsApp, agenda web y panel del equipo leen y escriben la misma agenda en tiempo real. La base de datos
                  bloquea cualquier cruce de horarios por profesional, aunque dos pacientes reserven en el mismo segundo.
                </p>
              </div>
              <div className="chips">
                {["Servicios con duración", "Horarios por profesional", "Bloqueos y vacaciones", "Anticipación mínima", "Reagendar en 1 toque", "Pacientes automáticos", "Zona horaria de Chile", "Multiusuario con roles"].map((c) => (
                  <span className="chip" key={c}>{c}</span>
                ))}
              </div>
            </div>
            {FEATURES.map((f) => (
              <div className="feature" key={f.t}>
                <div className="ic" style={{ background: f.bg, color: f.c }}><Icon name={f.icon} size={22} /></div>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW */}
      <section className="section" id="como-funciona" style={{ background: "var(--bg)" }}>
        <div className="container">
          <div className="section-head">
            <span className="kicker">Cómo funciona</span>
            <h2>De cero a agenda automática en una tarde</h2>
            <p>Sin instalaciones ni implementaciones de semanas. Tú controlas todo desde el panel.</p>
          </div>
          <div className="steps">
            <div className="step">
              <h3>Crea tu consultorio</h3>
              <p>Te registras con usuario y contraseña. Cargamos servicios y horarios de ejemplo que ajustas en minutos.</p>
            </div>
            <div className="step">
              <h3>Conecta tu WhatsApp</h3>
              <p>Registra tu número en Meta y pega su Phone Number ID y WABA ID en el formulario. Molara lo verifica y se suscribe solo.</p>
            </div>
            <div className="step">
              <h3>Comparte y recibe horas</h3>
              <p>Tus pacientes escriben al WhatsApp o usan tu link de reserva. Tú ves la agenda llenarse desde el panel.</p>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARE */}
      <section className="section">
        <div className="container" style={{ maxWidth: 920 }}>
          <div className="section-head">
            <span className="kicker">Por qué Molara</span>
            <h2>Menos teléfono, más sillón ocupado</h2>
          </div>
          <div className="table-wrap">
            <table className="compare">
              <thead>
                <tr><th></th><th>Recepción manual</th><th>Suites con IA tradicionales</th><th className="me">Molara</th></tr>
              </thead>
              <tbody>
                <tr><td>Agenda fuera de horario</td><td>✗</td><td>✓</td><td className="me">✓</td></tr>
                <tr><td>Botones y listas nativas de WhatsApp</td><td>✗</td><td>A veces</td><td className="me">✓</td></tr>
                <tr><td>Agenda web + WhatsApp en la misma base</td><td>✗</td><td>✓</td><td className="me">✓</td></tr>
                <tr><td>Métricas de Instagram en el panel</td><td>✗</td><td>✗</td><td className="me">✓</td></tr>
                <tr><td>Autoservicio: lo configuras tú</td><td>—</td><td>Implementación asistida</td><td className="me">✓ 15 min</td></tr>
                <tr><td>Costo de implementación</td><td>—</td><td>Desde $390.000</td><td className="me">$0</td></tr>
                <tr><td>Precio mensual</td><td>Sueldo + turnos</td><td>$300.000+</td><td className="me">Desde $29.990</td></tr>
              </tbody>
            </table>
          </div>
          <p className="tiny faint" style={{ marginTop: 10, textAlign: "center" }}>Rangos de precio referenciales de soluciones con IA publicadas en Chile (2026).</p>
        </div>
      </section>

      {/* PRICING */}
      <section className="section" id="precios" style={{ background: "var(--bg)" }}>
        <div className="container">
          <div className="section-head">
            <span className="kicker">Precios</span>
            <h2>Planes simples, en pesos chilenos</h2>
            <p>Empieza gratis. Cambia o cancela cuando quieras.</p>
          </div>
          <Pricing />
        </div>
      </section>

      {/* FAQ */}
      <section className="section" id="faq">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Preguntas frecuentes</span>
            <h2>Lo que nos suelen preguntar</h2>
          </div>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="container">
        <div className="cta-band">
          <div>
            <h2>Tu próxima hora puede agendarse esta noche, mientras duermes.</h2>
            <p>Crea tu consultorio en Molara y conecta tu WhatsApp hoy. 14 días gratis.</p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Link href="/registro" className="btn btn-lg" style={{ background: "#fff", color: "var(--teal-700)", borderColor: "#fff" }}>
              Empezar gratis <Icon name="arrow" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <div className="stack-sm">
            <Logo size={30} tagline />
            <p className="small muted" style={{ maxWidth: 300, marginTop: 8 }}>
              Recepción inteligente por WhatsApp para consultorios odontológicos de Chile y Latinoamérica.
            </p>
          </div>
          <div>
            <h4>Producto</h4>
            <a href="#producto">Funciones</a>
            <a href="#precios">Precios</a>
            <a href="#faq">Preguntas</a>
          </div>
          <div>
            <h4>Cuenta</h4>
            <Link href="/registro">Crear cuenta</Link>
            <Link href="/login">Ingresar</Link>
          </div>
          <div>
            <h4>Integraciones</h4>
            <span className="small muted" style={{ display: "block" }}>WhatsApp Cloud API</span>
            <span className="small muted" style={{ display: "block" }}>Instagram Graph API</span>
            <span className="small muted" style={{ display: "block" }}>Vercel AI Gateway</span>
          </div>
        </div>
        <div className="container" style={{ marginTop: 36, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span className="tiny faint">© {new Date().getFullYear()} Molara. Hecho en Chile.</span>
          <span className="tiny faint" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><LogoMark size={16} /> WhatsApp es una marca de Meta Platforms, Inc.</span>
        </div>
      </footer>
    </div>
  );
}
