// Setup tab: the onboarding guide (an AI-assistant prompt and a manual
// checklist). The checklist ticks persist in localStorage.

export const REPO = 'https://github.com/lettucegoblin/omnieven'

const PROMPT = `I have Even Realities G2 glasses and want to run Omni, a self-hosted dashboard server for them: ${REPO}

Please set it up on this machine:
1. Clone the repository and install dependencies (Node.js 22.18+ is required; install it if missing).
2. Follow README.md ("Quick start") to run the server permanently (systemd user unit or docker compose) and expose it over HTTPS at a public URL my phone can reach. Set PUBLIC_URL to that URL.
3. Seed the starter apps and confirm GET <PUBLIC_URL>/api/status answers with the token.
4. Keep my server hostname and token out of any git repository.

When it is running, give me the WebSocket URL (wss://…/ws) and the token to paste into the Omni app on my phone, or the setup page URL with the QR code.`

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

export function initSetup() {
  $<HTMLAnchorElement>('link-repo').href = REPO
  $<HTMLAnchorElement>('link-docs').href = `${REPO}/blob/main/docs/APPS.md`
  $<HTMLAnchorElement>('link-issues').href = `${REPO}/issues`
  const ta = $<HTMLTextAreaElement>('ai-prompt')
  ta.value = PROMPT
  const btn = $<HTMLButtonElement>('copy-prompt')
  btn.onclick = async () => {
    try { await navigator.clipboard.writeText(PROMPT) } catch { ta.focus(); ta.select(); document.execCommand('copy') }
    const was = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = was }, 1500)
  }
  // checklist persistence
  for (const box of Array.from(document.querySelectorAll<HTMLInputElement>('#steps input[type=checkbox]'))) {
    const key = `omni.setup.${box.id}`
    box.checked = localStorage.getItem(key) === '1'
    box.parentElement!.classList.toggle('done', box.checked)
    box.onchange = () => { localStorage.setItem(key, box.checked ? '1' : '0'); box.parentElement!.classList.toggle('done', box.checked) }
  }
}
