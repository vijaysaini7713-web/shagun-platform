import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { Card, LanguageToggle } from "../../components/ui";

export default function Home() {
  const { t } = useTranslation();
  const { memberships, isPlatformAdmin, session } = useAuth();

  return (
    <div className="min-h-screen bg-maroon-50">
      <TopBar email={session?.user.email ?? ""} />
      <main className="mx-auto max-w-4xl space-y-4 p-4">
        {isPlatformAdmin && (
          <Link to="/super" className="block rounded-2xl bg-maroon-700 p-4 font-semibold text-white">
            {t("app.platform_admin")} →
          </Link>
        )}
        <h1 className="text-2xl font-bold">{t("app.my_weddings")}</h1>
        {memberships.length === 0 && <p className="text-gray-600">{t("app.no_weddings")}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {memberships.map((m) => (
            <Card key={m.id} className="space-y-2">
              <p className="font-display text-xl text-maroon-800">{m.event.bride_name} ♥ {m.event.groom_name}</p>
              <p className="text-sm text-gray-600">{m.event.event_date} · {t(`app.role.${m.role}`)}</p>
              <div className="flex gap-2 pt-2">
                {m.role !== "counter_staff" && (
                  <Link to={`/app/e/${m.event.id}`} className="rounded-xl bg-maroon-700 px-4 py-2 font-semibold text-white">{t("app.open_dashboard")}</Link>
                )}
                {m.role !== "viewer" && (
                  <Link to={`/app/e/${m.event.id}/counter`} className="rounded-xl border border-maroon-700 px-4 py-2 font-semibold text-maroon-800">{t("app.open_counter")}</Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}

export function TopBar({ email, title }: { email: string; title?: string }) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center justify-between bg-white px-4 py-3 shadow-sm">
      <Link to="/app" className="font-display text-xl text-maroon-800">Shagun{title ? ` · ${title}` : ""}</Link>
      <div className="flex items-center gap-3 text-sm">
        <span className="hidden text-gray-500 sm:inline">{email}</span>
        <LanguageToggle />
        <button onClick={() => supabase.auth.signOut()} className="font-semibold text-maroon-800">{t("common.logout")}</button>
      </div>
    </header>
  );
}
