import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en.json";
import hi from "../locales/hi.json";

const saved = (() => {
  try {
    return localStorage.getItem("lang");
  } catch {
    return null;
  }
})();
const browser = typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en") ? "en" : "hi";

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi } },
  lng: saved === "en" || saved === "hi" ? saved : browser,
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
});

i18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem("lang", lng);
  } catch {
    /* storage may be blocked */
  }
  document.documentElement.lang = lng;
});

export default i18n;
