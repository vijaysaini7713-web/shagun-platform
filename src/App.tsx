import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { needsMfa, useAuth } from "./lib/auth";
import { Spinner } from "./components/ui";
import { supabaseConfigured } from "./lib/supabase";

const Landing = lazy(() => import("./pages/Landing"));
const GuestFlow = lazy(() => import("./pages/guest/GuestFlow"));
const Login = lazy(() => import("./pages/auth/Login"));
const Mfa = lazy(() => import("./pages/auth/Mfa"));
const Home = lazy(() => import("./pages/admin/Home"));
const Dashboard = lazy(() => import("./pages/admin/Dashboard"));
const Counter = lazy(() => import("./pages/counter/Counter"));
const SuperAdmin = lazy(() => import("./pages/super/SuperAdmin"));

function RequireLogin({ children, mfa = true }: { children: ReactNode; mfa?: boolean }) {
  const auth = useAuth();
  const loc = useLocation();
  if (auth.loading) return <Spinner />;
  if (!auth.session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (mfa && needsMfa(auth)) return <Navigate to="/mfa" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  if (!supabaseConfigured) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-bold">Setup needed</h1>
        <p className="mt-2 text-gray-600">Copy .env.example to .env and add your Supabase URL and anon key.</p>
      </div>
    );
  }
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/w/:code" element={<GuestFlow />} />
        <Route path="/w/:code/assisted" element={<RequireLogin mfa={false}><GuestFlow assisted /></RequireLogin>} />
        <Route path="/login" element={<Login />} />
        <Route path="/mfa" element={<RequireLogin mfa={false}><Mfa /></RequireLogin>} />
        <Route path="/app" element={<RequireLogin><Home /></RequireLogin>} />
        <Route path="/app/e/:eventId/*" element={<RequireLogin><Dashboard /></RequireLogin>} />
        <Route path="/app/e/:eventId/counter" element={<RequireLogin><Counter /></RequireLogin>} />
        <Route path="/super" element={<RequireLogin><SuperAdmin /></RequireLogin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
