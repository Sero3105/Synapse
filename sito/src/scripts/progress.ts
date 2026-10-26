// Scroll progress of a tall "pinned" section: 0 when its top reaches the top of the viewport,
// 1 when its bottom reaches the bottom. Work is done only while the section is on screen.
export function onScrollProgress(section: HTMLElement, update: (progress: number) => void) {
  let frame = 0
  let visible = false

  const measure = () => {
    frame = 0
    const rect = section.getBoundingClientRect()
    const travel = rect.height - innerHeight
    update(travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 1)
  }
  const schedule = () => {
    if (visible && !frame) frame = requestAnimationFrame(measure)
  }

  new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting
    schedule()
  }).observe(section)
  addEventListener('scroll', schedule, { passive: true })
  addEventListener('resize', schedule)
  measure()
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
