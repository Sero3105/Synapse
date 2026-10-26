// Staggered entrance for the children of every [data-reveal] block, once, as it scrolls in.
const blocks = document.querySelectorAll<HTMLElement>('[data-reveal]')
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      e.target.classList.add('is-in')
      io.unobserve(e.target)
    }
  },
  { rootMargin: '0px 0px -12% 0px' },
)
for (const block of blocks) {
  ;[...block.children].forEach((child, i) => (child as HTMLElement).style.setProperty('--i', String(i)))
  io.observe(block)
}
