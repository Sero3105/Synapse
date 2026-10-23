export const formatBytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`

export const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
