import i18next from "i18next";
import { createI18nStore } from "svelte-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";
import zhCN from "./locales/zh-cn.json";
import zhTW from "./locales/zh-tw.json";
function supportedLocale(tag) {
  if (!tag) return;
  try {
    const locale = new Intl.Locale(tag);
    if (locale.language === "en" || locale.language === "es") return locale.language;
    if (locale.language === "zh") return locale.maximize().script === "Hant" ? "zh-TW" : "zh-CN";
  } catch { /* An invalid preference should not hide a supported browser language. */ }
}
export function getLocale() {
  const cookie = document.cookie.match(/(?:^|;\s*)language=([^;]+)/)?.[1];
  return supportedLocale(cookie) || [navigator.language, ...(navigator.languages || [])].map(supportedLocale).find(Boolean) || "en";
}
void i18next.init({
  lng: getLocale(),
  resources: {
    en: {
      translation: en
    },
    es: {
      translation: es
    },
    "zh-CN": {
      translation: zhCN
    },
    "zh-TW": {
      translation: zhTW
    }
  },
  interpolation: {
    escapeValue: false
  }
});
const i18n = createI18nStore(i18next);
export default i18n;
