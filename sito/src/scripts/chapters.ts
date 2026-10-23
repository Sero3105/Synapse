// "Colour by chapter": each section declares its field with data-chapter, and the sticky header
// takes the colours of the chapter currently passing under it.
const header = document.querySelector<HTMLElement>('[data-site-header]')
const chapters = document.querySelectorAll<HTMLElement>('[data-chapter]')

if (header && chapters.length) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) header.dataset.on = (e.target as HTMLElement).dataset.chapter
    },
    // a thin line where the header sits
    { rootMargin: '-32px 0px -95% 0px' },
  )
  chapters.forEach((c) => io.observe(c))

  // hide the header while reading down, bring it back on the way up
  let last = scrollY
  addEventListener(
    'scroll',
    () => {
      const y = scrollY
      if (Math.abs(y - last) < 8) return
      header.dataset.hidden = String(y > last && y > 400 && !header.contains(document.activeElement))
      last = y
    },
    { passive: true },
  )
}
