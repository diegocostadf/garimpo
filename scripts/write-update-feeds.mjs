#!/usr/bin/env node
/**
 * Write the update feeds the in-app updater reads, from the installers in release/. Run after all the platform
 * builds, before uploading.
 *
 *   node scripts/write-update-feeds.mjs
 *
 * electron-builder's own feeds cannot be uploaded: each `electron-builder` run overwrites latest-mac.yml and
 * latest.yml, so the second architecture wipes the first, and they name files with a dash where GitHub's upload
 * turns the space in our file names into a dot, so the updater would 404. Hashing the finished files here also
 * means the feed describes exactly what gets uploaded. A feed whose files are not all present is skipped (build Mac and Windows, then run again).
 */
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const dir = 'release'
const name = `Garimpo`

const feeds = {
  // Apple Silicon picks the arm64 zip by name, Intel Macs the x64 one.
  'latest-mac.yml': [`${name}-${version}-x64-mac.zip`, `${name}-${version}-arm64-mac.zip`],
  // Only the 64-bit Windows installer updates in place; 32-bit Windows is sent to the download page.
  'latest.yml': [`${name}-Setup-${version}-x64.exe`]
}

const releaseDate = new Date().toISOString()
for (const [feed, files] of Object.entries(feeds)) {
  const missing = files.filter((file) => { try { statSync(join(dir, file)); return false } catch { return true } })
  if (missing.length) { console.log(`skipped ${feed}: missing ${missing.join(', ')}`); continue }
  const entries = files.map((file) => {
    const path = join(dir, file)
    const sha512 = createHash('sha512').update(readFileSync(path)).digest('base64')
    return { url: file.replace(/ /g, '.'), sha512, size: statSync(path).size }
  })
  const lines = [`version: ${version}`, 'files:']
  for (const e of entries) lines.push(`  - url: ${e.url}`, `    sha512: ${e.sha512}`, `    size: ${e.size}`)
  lines.push(`path: ${entries[0].url}`, `sha512: ${entries[0].sha512}`, `releaseDate: '${releaseDate}'`, '')
  writeFileSync(join(dir, feed), lines.join('\n'))
  console.log(`wrote ${feed}: ${entries.map((e) => e.url).join(', ')}`)
}
