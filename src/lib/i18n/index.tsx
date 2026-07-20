import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { zh as commonZh, en as commonEn } from './pages/common'
import { zh as layoutZh, en as layoutEn } from './pages/layout'
import { zh as loginZh, en as loginEn } from './pages/login'
import { zh as dashboardZh, en as dashboardEn } from './pages/dashboard'
import { zh as lineageZh, en as lineageEn } from './pages/lineage'
import { zh as sqlZh, en as sqlEn } from './pages/sql'
import { zh as metadataZh, en as metadataEn } from './pages/metadata'
import { zh as changesZh, en as changesEn } from './pages/changes'

/**
 * i18n 核心:LanguageProvider + useT()
 * - 默认中文(zh),localStorage 键 `lineagehub-lang` 持久化选择
 * - 平铺字典,dot 路径 key(`<页面前缀>.<分组>.<名称>`,如 `layout.nav.dashboard`)
 * - 缺失 key:console.warn 并 fallback 到 zh 文案;zh 也缺失时 warn 并原样返回 key
 * - 不引入 react-i18next 等外部依赖
 *
 * 字典按页面拆分在 ./pages/*.ts,此处 merge 成 zh/en 两个总字典。
 * 各页面 agent 只改自己的 pages/<page>.ts 桩文件,避免并行冲突。
 */

export type Lang = 'zh' | 'en'

export const LANG_STORAGE_KEY = 'lineagehub-lang'

/** 插值变量:{name} 占位符,如 t('common.table.total', { count: 3 }) */
export type I18nVars = Record<string, string | number>

/** merge 后的平铺总字典;zh 为全量基准(fallback 源) */
export const dictionaries: Record<Lang, Record<string, string>> = {
  zh: {
    ...commonZh,
    ...layoutZh,
    ...loginZh,
    ...dashboardZh,
    ...lineageZh,
    ...sqlZh,
    ...metadataZh,
    ...changesZh,
  },
  en: {
    ...commonEn,
    ...layoutEn,
    ...loginEn,
    ...dashboardEn,
    ...lineageEn,
    ...sqlEn,
    ...metadataEn,
    ...changesEn,
  },
}

function interpolate(text: string, vars?: I18nVars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (raw, name: string) =>
    name in vars ? String(vars[name]) : raw,
  )
}

/**
 * 纯函数翻译(不依赖 React):lang 字典命中 → 插值返回;
 * 缺失 → console.warn + fallback zh;zh 也缺 → warn + 返回 key 本身。
 * 导出供非组件代码(如 lib/format.ts)与冒烟脚本使用;组件内请优先用 useT() 的 t。
 */
export function translate(lang: Lang, key: string, vars?: I18nVars): string {
  const dict = dictionaries[lang]
  if (key in dict) return interpolate(dict[key], vars)
  if (lang !== 'zh' && key in dictionaries.zh) {
    console.warn(`[i18n] missing key "${key}" for lang "${lang}", fallback to zh`)
    return interpolate(dictionaries.zh[key], vars)
  }
  console.warn(`[i18n] missing key "${key}"`)
  return key
}

function readStoredLang(): Lang {
  try {
    if (typeof window !== 'undefined') {
      const v = window.localStorage.getItem(LANG_STORAGE_KEY)
      if (v === 'zh' || v === 'en') return v
    }
  } catch {
    /* localStorage 不可用(隐私模式/非浏览器环境)时静默使用默认 */
  }
  return 'zh'
}

// 模块级当前语言:供无法走 React context 的纯函数(如 relativeTime)读取
let currentLang: Lang = readStoredLang()

/** 非 React 环境(工具函数)读取当前语言;React 组件请使用 useT() */
export function getLang(): Lang {
  return currentLang
}

export interface I18nContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: string, vars?: I18nVars) => string
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'zh',
  setLang: () => {},
  t: (key, vars) => translate('zh', key, vars),
})

/** 语言 Provider:默认中文,切换后写入 localStorage(lineagehub-lang) */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang)

  // 同步更新模块级 currentLang:保证切换事件后的首次渲染中,
  // 纯函数(getLang,如 relativeTime)已读到新语言(useEffect 提交后才跑会慢一拍)
  const setLang = useCallback((next: Lang) => {
    currentLang = next
    setLangState(next)
  }, [])

  useEffect(() => {
    currentLang = lang
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang)
    } catch {
      /* 持久化失败静默 */
    }
  }, [lang])

  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang, setLang],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** 组件取文案:const { t, lang, setLang } = useT() */
export function useT(): I18nContextValue {
  return useContext(I18nContext)
}
