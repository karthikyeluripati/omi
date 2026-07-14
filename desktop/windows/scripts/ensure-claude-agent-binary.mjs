// Fails a packaged Windows build loudly when the Claude Code executable is
// missing from the installed tree. @anthropic-ai/claude-agent-sdk-win32-x64 is
// an optionalDependency, so pnpm exits 0 even when its ~247 MB download fails
// (seen in PR #9304 review on a flaky network) — and SDK 0.3.205 ships no JS
// fallback: the bridge would still answer the ACP initialize handshake but the
// first real agent task would have nothing to spawn. Run before
// electron-builder (see build:win / build:unpack) so that failure mode is a
// hard packaging error instead of a broken app.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// claude.exe is ~235 MB; anything far below that is a truncated download.
const DEFAULT_MIN_BYTES = 50 * 1024 * 1024

const BINARY_PACKAGE = '@anthropic-ai/claude-agent-sdk-win32-x64'

/** Locate claude.exe in either the flattened or the pnpm store layout. */
export function findClaudeBinary(root) {
  const direct = join(root, 'node_modules', ...BINARY_PACKAGE.split('/'), 'claude.exe')
  if (existsSync(direct)) return direct

  const pnpmDir = join(root, 'node_modules', '.pnpm')
  if (existsSync(pnpmDir)) {
    const prefix = BINARY_PACKAGE.replace('/', '+') + '@'
    for (const entry of readdirSync(pnpmDir)) {
      if (!entry.startsWith(prefix)) continue
      const candidate = join(
        pnpmDir,
        entry,
        'node_modules',
        ...BINARY_PACKAGE.split('/'),
        'claude.exe'
      )
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * Verify the Claude Code binary is present and plausibly complete. Only
 * meaningful for Windows packaging; other platforms skip (their binaries live
 * in their own platform packages and this app currently packages win32-x64).
 */
export function checkClaudeBinary(root, platform = process.platform, minBytes = DEFAULT_MIN_BYTES) {
  if (platform !== 'win32') {
    return { ok: true, skipped: true }
  }
  const binary = findClaudeBinary(root)
  if (!binary) {
    return {
      ok: false,
      reason:
        `${BINARY_PACKAGE} is not installed (claude.exe not found). It is an ` +
        'optionalDependency, so a failed download does NOT fail `pnpm install` — ' +
        'but without it the bundled Claude Code agent cannot run. ' +
        'Re-run `pnpm install` on a reliable network and check for download errors.'
    }
  }
  const size = statSync(binary).size
  if (size < minBytes) {
    return {
      ok: false,
      reason:
        `claude.exe at ${binary} is only ${size} bytes — looks like a truncated ` +
        'download. Remove it and re-run `pnpm install`.'
    }
  }
  return { ok: true, binary, size }
}

// Invoked directly (not imported by tests): run the check for this repo.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const result = checkClaudeBinary(root)
  if (!result.ok) {
    console.error(`[ensure-claude-agent-binary] FAIL: ${result.reason}`)
    process.exit(1)
  }
  if (result.skipped) {
    console.log('[ensure-claude-agent-binary] non-Windows platform — skipped')
  } else {
    console.log(
      `[ensure-claude-agent-binary] OK: ${result.binary} (${Math.round(result.size / 1024 / 1024)} MB)`
    )
  }
}
