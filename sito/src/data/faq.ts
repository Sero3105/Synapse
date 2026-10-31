export interface Faq {
  question: string
  answer: string
}

export const faqs: readonly Faq[] = [
  {
    question: 'Is Synapse free?',
    answer:
      'Yes. Synapse is open source under the MIT licence, and the builds on GitHub Releases are free to download. There is no account and no subscription.',
  },
  {
    question: 'Can I open my Obsidian vault?',
    answer:
      'A vault is any folder of Markdown files, so you can open an existing one. Synapse writes only its own .synapse/ folder and never modifies .obsidian/. Obsidian community plugins are not supported.',
  },
  {
    question: 'Where are my notes stored?',
    answer:
      'Wherever you put the vault folder. Every note is a .md file you can open in any editor, sync however you like and back up with Time Machine. Preferences live separately, in ~/Library/Application Support/Synapse.',
  },
  {
    question: 'Why does macOS warn me the first time?',
    answer:
      'Builds are ad-hoc signed and not notarized yet, so macOS cannot verify them. Open System Settings → Privacy & Security and click Open Anyway, once.',
  },
  {
    question: 'Does it run on Intel Macs?',
    answer:
      'Since 1.3.0 there is an Intel (x64) build next to the Apple silicon one, both for macOS 13 Ventura or later. The Intel build has not been tested on Intel hardware yet, so please report any problem.',
  },
  {
    question: 'I read about tasks, related notes and export. Where are they?',
    answer:
      'They arrived with release 1.4.0. The current published download is 1.5.1, and the release notes say what each published version has.',
  },
  {
    question: 'Does Synapse go online?',
    answer:
      'Only to check for a new version at launch and once a day while open (one request to GitHub, which you can switch off) and when a note asks it to, such as loading a remote image or opening a web link in your browser. No telemetry, no cloud sync.',
  },
]
