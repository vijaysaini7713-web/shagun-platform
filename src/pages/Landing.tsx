import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "../components/ui";

export default function Landing() {
  const { i18n } = useTranslation();
  const hi = i18n.language === "hi";
  return (
    <div className="min-h-screen bg-gradient-to-b from-maroon-50 to-gold-100/50">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <span className="font-display text-2xl text-maroon-800">Shagun</span>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <Link to="/login" className="rounded-xl bg-maroon-700 px-4 py-2 font-semibold text-white">Login</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 text-center">
        <h1 className="font-display text-4xl text-maroon-800 sm:text-5xl">
          {hi ? "शादी का हर शगुन, एक जगह" : "Every wedding shagun, in one place"}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-gray-700">
          {hi
            ? "मेहमान QR स्कैन करें, ऑनलाइन शगुन भेजें या लिफ़ाफ़ा/गिफ्ट की फोटो दें — परिवार को लाइव डैशबोर्ड पर पूरा हिसाब।"
            : "Guests scan a QR, send online shagun or photograph their envelope or gift — the family sees every entry on a live dashboard."}
        </p>
        <div className="mt-10 grid gap-4 text-left sm:grid-cols-3">
          {[
            [hi ? "QR से एंट्री" : "QR entry", hi ? "हिंदी/English, बिना ऐप" : "Hindi/English, no app needed"],
            [hi ? "सीधा UPI" : "Direct UPI", hi ? "पैसा सीधे परिवार के खाते में" : "Money goes straight to the family"],
            [hi ? "सुरक्षित" : "Secure", hi ? "एन्क्रिप्टेड नंबर, 2-स्टेप लॉगिन" : "Encrypted numbers, 2-step login"],
          ].map(([a, b]) => (
            <div key={a} className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="font-bold text-maroon-800">{a}</p>
              <p className="text-gray-600">{b}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
