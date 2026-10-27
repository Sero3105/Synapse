// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import { links, product } from './src/config/site.ts'

// The public domain is not decided yet. Set SITE_URL at build time (for example
// https://synapse.pages.dev) to emit canonical URLs, the sitemap and its robots.txt entry.
const site = process.env.SITE_URL || undefined

export default defineConfig({
  ...(site ? { site } : {}),
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: product.name,
      disable404Route: true,
      description: product.description,
      logo: { src: './src/assets/logo.svg', alt: '' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub repository', href: links.repo }],
      components: {
        SocialIcons: './src/components/docs/DocsSocial.astro',
        Footer: './src/components/docs/DocsFooter.astro',
        Hero: './src/components/docs/DocsHero.astro',
        SiteTitle: './src/components/docs/DocsSiteTitle.astro',
        Header: './src/components/docs/DocsHeader.astro',
        ThemeSelect: './src/components/docs/DocsThemeSelect.astro',
      },
      expressiveCode: { styleOverrides: { borderRadius: '8px', borderColor: 'transparent' } },
      lastUpdated: false,
      editLink: { baseUrl: `${links.repo}/edit/main/sito/` },
      customCss: ['@fontsource-variable/source-serif-4', './src/styles/tokens.css', './src/styles/starlight.css'],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Introduction', slug: 'docs' },
            { slug: 'docs/installation' },
            { slug: 'docs/getting-started' },
          ],
        },
        { label: 'Guides', items: [{ autogenerate: { directory: 'docs/guides' } }] },
        { label: 'Configuration', items: [{ autogenerate: { directory: 'docs/configuration' } }] },
        {
          label: 'Help',
          items: [{ slug: 'docs/troubleshooting' }, { slug: 'docs/faq' }, { slug: 'docs/releases' }],
        },
        { label: 'Download Synapse', link: links.download },
      ],
    }),
  ],
})
