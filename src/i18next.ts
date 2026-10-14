import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const sortedLanguages = [
  ["ru", "русский"],
  ["en", "English"],
] as const;

type TranslationResource = Record<string, unknown>;

const localeModules = import.meta.glob<{ default: TranslationResource }>(
  ["./locales/en.json", "./locales/ru.json"],
  {
    eager: true,
  },
);

const resources = Object.fromEntries(
  Object.entries(localeModules).flatMap(([path, module]) => {
    const lang = path.match(/\/([\w-]+)\.json$/)?.[1];
    if (!lang) return [];

    return [[lang, { translation: module.default }]];
  }),
);

i18n
  .use(initReactI18next)
  .init({
    lng: "ru",
    fallbackLng: "ru",
    supportedLngs: ["ru", "en"],
    interpolation: {
      escapeValue: false,
    },
    resources,
  });

export default i18n;
