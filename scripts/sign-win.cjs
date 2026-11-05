// Windows Authenticode signing with osslsigncode, so the Windows installers can
// be signed on macOS (brew install osslsigncode) or Linux (apt install osslsigncode).
//
// Certificate: GARIMPO_WIN_PFX (path to a .pfx/.p12) and GARIMPO_WIN_PFX_PASSWORD.
// Without them the files are left unsigned. A timestamp is added when the
// timestamp server is reachable, so signatures stay valid after the certificate expires.
const { execFileSync } = require('child_process')
const fs = require('fs')

const TIMESTAMP = process.env.GARIMPO_WIN_TIMESTAMP || 'http://timestamp.digicert.com'

module.exports = async function sign(config) {
  const pfx = process.env.GARIMPO_WIN_PFX
  if (!pfx) return
  if (!fs.existsSync(pfx)) throw new Error(`GARIMPO_WIN_PFX not found: ${pfx}`)
  const out = config.path + '.signed'
  const base = ['sign', '-pkcs12', pfx, '-pass', process.env.GARIMPO_WIN_PFX_PASSWORD || '', '-n', config.name || 'Garimpo', '-i', config.site || 'https://github.com/diegocostadf/garimpo', '-h', 'sha256']
  const run = (extra) => {
    fs.rmSync(out, { force: true })
    execFileSync('osslsigncode', [...base, ...extra, '-in', config.path, '-out', out], { stdio: 'pipe' })
  }
  try {
    run(['-ts', TIMESTAMP])
  } catch {
    run([])
  }
  fs.renameSync(out, config.path)
}
