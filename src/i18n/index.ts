import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import ptCommon from './locales/pt/common.json'
import enCommon from './locales/en/common.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      pt: { common: ptCommon },
      en: { common: enCommon },
    },
    defaultNS: 'common',
    fallbackLng: 'pt',
    supportedLngs: ['pt', 'en'],
    nsSeparator: false,
    interpolation: { escapeValue: false },
    detection: {
      order: ['cookie', 'localStorage', 'navigator'],
      caches: ['cookie', 'localStorage'],
      lookupCookie: 'i18n_lang',
      lookupLocalStorage: 'i18n_lang',
    },
  })

export default i18n
