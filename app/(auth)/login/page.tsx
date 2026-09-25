import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/session";
import { AuthSide } from "../AuthSide";
import { LoginForm } from "./LoginForm";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getContext()) redirect("/panel");
  const { next } = await searchParams;
  return (
    <div className="auth">
      <AuthSide />
      <main className="auth-main">
        <div className="auth-card stack">
          <Link href="/"><Logo size={30} /></Link>
          <div>
            <h1>Bienvenido de vuelta</h1>
            <p className="muted">Ingresa al panel de tu consultorio.</p>
          </div>
          <LoginForm next={next} />
          <p className="small muted" style={{ textAlign: "center" }}>
            ¿Aún no tienes cuenta? <Link href="/registro" style={{ color: "var(--teal)", fontWeight: 600 }}>Crea tu consultorio gratis</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
