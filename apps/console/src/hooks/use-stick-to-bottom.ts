/**
 * Keeps a scroll container pinned to its newest content — but only while the reader is already near the bottom.
 * Scrolling up to read an older message is never yanked back down. Beautiful UI's harness pattern (MIT).
 */
import { type RefObject, useEffect } from "react"

export const useStickToBottom = (scroller: RefObject<HTMLElement | null>, threshold = 120) => {
  useEffect(() => {
    const element = scroller.current
    const content = element?.firstElementChild
    if (!element || !content) return
    let pinned = true
    let frame = 0
    const onScroll = () => {
      pinned = element.scrollHeight - element.scrollTop - element.clientHeight < threshold
    }
    const follow = () => {
      if (!pinned) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight
      })
    }
    element.addEventListener("scroll", onScroll, { passive: true })
    const resize = new ResizeObserver(follow)
    resize.observe(content)
    const mutation = new MutationObserver(follow)
    mutation.observe(content, { childList: true, subtree: true })
    follow()
    return () => {
      element.removeEventListener("scroll", onScroll)
      resize.disconnect()
      mutation.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [scroller, threshold])
}
