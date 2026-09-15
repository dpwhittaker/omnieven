# Privacy policy — Omni

Omni is an open-source dashboard for Even Realities G2 glasses. The phone app is a thin
bridge: it connects only to **a server you run yourself**, at the address you enter in the
app. The developers of Omni operate no servers, receive no data from the app, and include
no analytics or advertising.

## What the app does with each permission

| Permission | Why it is requested | Where the data goes |
|---|---|---|
| **network** | To reach your own Omni server (WebSocket + HTTPS). The whitelist in `app.json` names only that server. | Your server. Nowhere else. |
| **g2-microphone** | Only when an app on your server asks for it (for example a voice memo or transcription app), and only while you have started it on the glasses. | Streamed to your server; what happens next is decided by the apps you install there (e.g. saved as a file, or sent to a speech-to-text provider you configured with your own key). |
| **location** | Only when an app on your server asks for it (for example weather). | Your server. |

## What the phone app stores

Your server's address and token, in the Even App's local storage, so the app reconnects
on the next launch. Nothing else.

## Your server

Everything your apps collect (notes, recordings, transcripts, settings) lives in the
`data/` folder of your own server and in the apps you chose to install. Third-party
services (news feeds, speech-to-text, task managers, AI models) are contacted only by
apps that you installed and configured with your own credentials; their handling of that
data is governed by their own policies.

## Contact

Questions: open an issue at https://github.com/lettucegoblin/omnieven/issues.
