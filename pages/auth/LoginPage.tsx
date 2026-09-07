import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ShieldCheck } from "lucide-react";

import { signIn } from "../../app/auth/authService";

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const result = await signIn({ email, password });

      if (!result.ok) {
        setErrorMessage(result.error.message);
        return;
      }

      navigate("/", { replace: true });
    } catch {
      setErrorMessage("The authentication request could not be completed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-100">
      <div className="grid min-h-screen lg:grid-cols-2">
        <section className="flex flex-col bg-[#202225] text-white">
          <div className="p-8 lg:p-14">
            <h1 className="text-5xl font-bold tracking-wide text-red-600 lg:text-6xl">
              ALFAEV
            </h1>

            <p className="mt-3 text-base text-zinc-400 lg:text-lg">
              Enterprise Resource Planning & Manufacturing Execution System
            </p>
          </div>

          <div className="flex flex-1 items-center px-8 pb-12 lg:px-14">
            <div className="max-w-2xl">
              <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-3xl bg-red-600 shadow-lg shadow-red-600/20">
                <ShieldCheck size={46} />
              </div>

              <h2 className="text-4xl font-semibold leading-tight lg:text-6xl">
                Centralizovano upravljanje projektima, proizvodnjom i
                dokumentacijom.
              </h2>

              <p className="mt-8 max-w-xl text-lg leading-relaxed text-zinc-400 lg:text-xl">
                Jedinstveno radno okruženje za planiranje, praćenje i kontrolu
                svih poslovnih procesa unutar ALFA PROTEH sistema.
              </p>
            </div>
          </div>

          <div className="border-t border-white/10 px-8 py-6 lg:px-14">
            <p className="text-sm text-zinc-500 lg:text-base">
              ALFAEV • Internal Enterprise Platform
            </p>
          </div>
        </section>

        <section className="flex items-center justify-center bg-zinc-100 p-6 lg:p-12">
          <div className="w-full max-w-xl">
            <div className="mb-10">
              <h2 className="text-4xl font-bold text-zinc-900 lg:text-5xl">
                Prijava u sistem
              </h2>

              <p className="mt-3 text-base text-zinc-500 lg:text-lg">
                Unesite svoje pristupne podatke za nastavak rada.
              </p>
            </div>

            <div className="rounded-4xl border border-zinc-200 bg-white p-8 shadow-xl shadow-black/5 transition lg:p-12">
              <form onSubmit={handleSubmit} className="space-y-7">
                <div>
                  <label
                    htmlFor="login-email"
                    className="mb-3 block text-sm font-semibold uppercase tracking-wide text-zinc-600"
                  >
                    Email
                  </label>

                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    placeholder="Unesite email adresu"
                    className="w-full rounded-2xl border border-zinc-300 px-5 py-5 text-lg outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                  />
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="mb-3 block text-sm font-semibold uppercase tracking-wide text-zinc-600"
                  >
                    Lozinka
                  </label>

                  <input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    placeholder="Unesite lozinku"
                    className="w-full rounded-2xl border border-zinc-300 px-5 py-5 text-lg outline-none transition focus:border-red-600 focus:ring-4 focus:ring-red-600/10"
                  />
                </div>

                {errorMessage && (
                  <p
                    role="alert"
                    className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                  >
                    {errorMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  aria-busy={isSubmitting}
                  className="w-full rounded-2xl bg-red-600 py-5 text-lg font-semibold text-white transition hover:-translate-y-0.5 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:bg-red-600"
                >
                  {isSubmitting ? "Prijava u toku..." : "Prijava u sistem"}
                </button>
              </form>
            </div>

            <p className="mt-8 text-center text-sm text-zinc-500 lg:text-left">
              ALFA PROTEH • ERP / MES Platform
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

export default LoginPage;
