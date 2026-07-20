import { cn } from '@/lib/utils'
import { useT, type Lang } from '@/lib/i18n'

/**
 * 语言切换器(顶栏分段控件):「中 | EN」
 * 高 28px;容器 #F1F5F9 圆角 6px;选中段白底 slate-900 文字 600;未选 #64748B
 */
const OPTIONS: { value: Lang; label: string }[] = [
  { value: 'zh', label: '中' },
  { value: 'en', label: 'EN' },
]

export function LangSwitcher() {
  const { lang, setLang } = useT()
  return (
    <div
      role="group"
      aria-label="Language / 语言"
      className="flex h-7 items-center gap-0.5 rounded-md bg-[#F1F5F9] p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = lang === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => setLang(opt.value)}
            className={cn(
              'flex h-6 items-center rounded px-2 text-xs transition-colors duration-120',
              active
                ? 'bg-white font-semibold text-slate-900 shadow-sm'
                : 'font-medium text-[#64748B] hover:text-slate-900',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
