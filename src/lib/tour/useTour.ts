/**
 * 新手引导(driver.js)封装
 * - start():构建 driver 实例并 drive(0);跨页步骤在 onNextClick/onPrevClick 中
 *   先 navigate(path) 再等 NAV_WAIT 让目标页渲染,然后 moveTo(index) 高亮
 * - 锚点元素不存在或不可见(移动端折叠、角色专属入口)→ 自动跳过该步
 * - 结束(完成/关闭)→ onDestroyed 写入 localStorage 标记
 * - 语言切换:Layout 监听 lang 变化调用 destroyActiveTour() 直接关闭
 */
import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { driver } from 'driver.js'
import type { Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import './tour.css'
import { useT } from '@/lib/i18n'
import { TOUR_STEPS, isTourDone, markTourDone } from './tourSteps'

/** 全局唯一活动实例(同时只允许一个引导) */
let activeDriver: Driver | null = null

/** 关闭进行中的引导(语言切换 / 重新开始时调用);destroy 会触发 onDestroyed 写标记 */
export function destroyActiveTour(): void {
  if (activeDriver) {
    const d = activeDriver
    activeDriver = null
    d.destroy()
  }
}

/** 导航后等待目标页渲染的时长(ms) */
const NAV_WAIT = 500

function anchorVisible(anchor: string): boolean {
  const el = document.querySelector(`[data-tour="${anchor}"]`)
  if (!el) return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

export interface UseTour {
  start: () => void
  stop: () => void
  isDone: () => boolean
}

export function useTour(): UseTour {
  const { t } = useT()
  const navigate = useNavigate()

  const start = useCallback(() => {
    destroyActiveTour()

    const currentPath = () => window.location.pathname + window.location.search

    const d = driver({
      showProgress: true,
      progressText: t('tour.progress'),
      nextBtnText: t('tour.btn.next'),
      prevBtnText: t('tour.btn.prev'),
      doneBtnText: t('tour.btn.done'),
      popoverClass: 'lineagehub-tour',
      overlayOpacity: 0.55,
      stagePadding: 6,
      allowClose: true,
      steps: TOUR_STEPS.map((s) => ({
        ...(s.anchor ? { element: `[data-tour="${s.anchor}"]` } : {}),
        skipMissingElement: true,
        popover: {
          title: t(s.titleKey),
          description: t(s.descKey),
          ...(s.side ? { side: s.side } : {}),
          ...(s.align ? { align: s.align } : {}),
        },
      })),
      onDestroyed: () => {
        markTourDone() // 完成或手动关闭都写入标记,不再自动弹
        if (activeDriver === d) activeDriver = null
      },
      onNextClick: () => advance(1),
      onPrevClick: () => advance(-1),
    })

    /** 展示第 index 步:先按需切路由,再校验锚点可见性,缺失则沿 dir 跳过 */
    function show(index: number, dir: 1 | -1, navigated: boolean) {
      if (!d.isActive() || index < 0 || index >= TOUR_STEPS.length) return
      const s = TOUR_STEPS[index]
      if (s.path && currentPath() !== s.path) {
        if (navigated) return // 已导航过一次仍不在目标路由,放弃防死循环
        navigate(s.path)
        window.setTimeout(() => show(index, dir, true), NAV_WAIT)
        return
      }
      if (s.anchor && !anchorVisible(s.anchor)) {
        const next = index + dir
        if (next < 0 || next >= TOUR_STEPS.length) {
          d.destroy()
          return
        }
        show(next, dir, false)
        return
      }
      d.moveTo(index)
    }

    function advance(dir: 1 | -1) {
      const cur = d.getActiveIndex() ?? 0
      const next = cur + dir
      if (next >= TOUR_STEPS.length) {
        d.destroy() // 末步「完成」
        return
      }
      if (next < 0) return
      show(next, dir, false)
    }

    activeDriver = d
    d.drive(0)
  }, [t, navigate])

  const stop = useCallback(() => destroyActiveTour(), [])

  return { start, stop, isDone: isTourDone }
}
