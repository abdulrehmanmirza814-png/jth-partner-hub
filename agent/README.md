# JTH Assistant

An assistant that **lives on your computer and works it like a person**: it looks at the screen, moves the mouse, types on the keyboard and uses any app you use. It also has faster, safer shortcuts for the jobs you do every day.

| Layer | What it does | Used for |
|---|---|---|
| **Desktop assistant** (new) | Sees your screen, uses mouse + keyboard in **any** app | "Do this task for me" - anything |
| **Official connections** | Gmail, Facebook/Instagram, WhatsApp Web, web research | Daily jobs: faster, cheaper and safer than clicking |
| **Browser tasks** | A separate browser window runs written instructions | Scheduled web jobs |

Everything runs on your laptop. Claude does the thinking.

---

## 1. Start the desktop assistant (15 minutes)

1. Install **Node.js 20+** (nodejs.org) and **Google Chrome**.
2. In the `agent` folder run `npm install`.
3. Copy `.env.example` to `.env` and paste your key (console.anthropic.com > API keys).
4. **Mac only:** System Settings > Privacy & Security > allow your Terminal app under **Screen Recording** and **Accessibility**. **Windows:** nothing extra (it can't control programs that were started "as administrator").
5. Check it can see and control your screen:

       npm run desktop-selftest

   It saves a screenshot, moves the mouse to four spots and tells you if the clicks land in the right place. If it warns about display scaling, tell me your computer and scaling.
6. Start it:

       npm run desktop

   It prints a **control panel link** (`http://127.0.0.1:8787/?t=...`). Open it and keep it in a browser tab or bookmark. This is your remote control: type tasks, approve actions, press STOP.
7. Type a first, harmless task in the panel, e.g. *"Open Notepad and write a short thank-you note to a guest, but don't save it."* Watch it work.

You can also queue tasks from a terminal: `npm run do -- "Open Gmail and tell me which emails need a reply today"`.

### Example: what happens
> You: *"Open WhatsApp, find the chat with John Smith, and reply that his safari pickup is at 3pm from the Marina hotel lobby."*
>
> The assistant takes a screenshot, finds WhatsApp, opens John's chat, types the message... then it **stops and asks you** in the panel: *"Press Enter to send in WhatsApp - John Smith: 'Your pickup is at 3pm...'"* You press **Approve** (or edit the text, or Decline). Only then does it send.

### How it keeps you safe
- **Approval before anything goes out.** Sending, posting, paying, deleting, installing or submitting a form always asks you first (mode `supervised`, the default). It also asks every time it presses Enter after typing in WhatsApp, Gmail, Facebook, Instagram, Outlook, Slack etc., even if the AI forgets to.
- **You are always in control.**
  - **Touch the mouse** and it pauses instantly. Press *Continue* in the panel when you are done.
  - **Move the mouse into a screen corner**: emergency stop (it also switches itself off).
  - The red **STOP** button in the panel does the same.
- **Secrets are protected.** It won't type card numbers, keys or passwords without asking, and asks you to log in yourself. Password managers, banking and wallet windows are blocked unless you approve.
- **Screen content is never an order.** Text on a web page or in an email that says "do X" is treated as data, not instructions.
- **Everything is recorded.** `data/desktop/runs/<run>/` keeps each screenshot it saw and each action it took.
- **Modes** (`config/agent.config.json` > `desktop.mode`): `watch` = you approve every step (start here for a day or two), `supervised` = approvals for risky things (default), `auto` = no questions (only the stops above).
- Your standing rules go in `config/desktop-rules.md` in plain English; it reads them before every task.

### Keep it always on
- **Windows:** double-click `scripts/start-windows.bat` (restarts itself if it crashes). Put a shortcut to it in `shell:startup` to launch at login.
- **Mac:** double-click `scripts/start-mac.command` (also keeps the Mac awake). Add it to Login Items.
- These start **everything** (`npm start`): desktop assistant + panel + WhatsApp + email + scheduled jobs.
- While it works the mouse is busy, so use the computer for other things between tasks, or run long jobs at night with a schedule.

---

## 2. Your day, automated

Set these up one at a time. All are optional.

### Gmail: morning check + drafted replies
One-time setup (about 15 minutes, free):
1. console.cloud.google.com > create a project > **APIs & Services > Library > Gmail API > Enable**.
2. **OAuth consent screen**: User type *External*, add your own email as a *Test user*.
3. **Credentials > Create credentials > OAuth client ID > Desktop app.** Copy the Client ID and secret into `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
4. `npm run gmail-auth`, open the link, allow access. (Google shows an "unverified app" notice for your own project: that is normal.)

Then:

    npm run mail         # read new important email, draft replies as Gmail DRAFTS
    npm run briefing     # the same + a summary: who needs you, what was drafted

- Replies are saved in **Gmail > Drafts**, in your style (learned from your sent mail). You read and press Send. Newsletters are skipped without cost.
- Suspicious mail (fake invoices, "update bank details", links) is flagged, never answered. Prices not in `config/business.md` and sensitive topics (refunds, complaints...) get a `[REVIEW: ...]` line at the top of the draft.
- While `npm start` runs: new mail is checked every 30 minutes (urgent ones alert you), and a briefing is written every morning (`briefing.at`, default 08:00) to `data/briefings/`.
- `email.mode: "auto"` + `email.auto_send_categories` lets it send safe categories by itself. Leave it on `draft` until you trust it.

### WhatsApp: replies to guests and agents
Reads your exported chats to learn your tone (steps 3-7 of the earlier guide are unchanged):

    npm run learn -- --summarize       # after putting exported .txt chats in data/chats/
    npm run chat-test -- "Price for desert safari for 4 adults?"
    npm run login                      # scan the WhatsApp QR code once
    npm start                          # mode "draft" = types the reply, you press Enter

Prices only come from `config/business.md`. Payments, refunds, complaints, voice notes, groups and anything it is unsure about are never sent: they alert you instead. `"mode": "auto"` sends safe replies by itself.

### Facebook and Instagram: posts you approve
Setup (one time): your Instagram must be **Professional** and linked to your Facebook Page. At developers.facebook.com create an app, and generate a **Page access token** with `pages_manage_posts` and `instagram_content_publish`. Put `META_PAGE_ID`, `META_PAGE_TOKEN` and `META_IG_USER_ID` in `.env`.

    npm run social -- draft "weekend desert safari offer" --count=2
    npm run social -- plan --days=7      # a week of varied posts
    npm run review                       # approve / edit / add image / schedule / reject

- Nothing is published until you approve it in `review`. Scheduled posts go out while `npm start` runs.
- Instagram needs a **public image link** (e.g. a photo in this repo's `assets/` folder on your site). It can write the captions and say which photo to use, but it cannot create photos or videos.
- `social.plan` in the config can draft a post every morning for your review.

### Research with the tools you choose
    npm run research -- "What are competitors charging for a Dubai desert safari?" --sites=tripadvisor.com,getyourguide.com

Uses web search, compares sources and saves a report with links to `data/research/`. Put your preferred sources in `config/research.md`. For tools that need a login (Semrush, etc.), give the desktop assistant the task instead.

### Ask Claude / ChatGPT
    npm run ask -- claude "Write a 30-second video script for our dhow cruise"
    npm run ask -- openai "..."          # official OpenAI API (needs OPENAI_API_KEY + OPENAI_MODEL in .env)
    npm run delegate -- chatgpt "..."    # types into the ChatGPT website with your saved login

Be aware: **Claude and ChatGPT can write scripts, captions and plans, but they cannot make the video itself.** Video/design apps (CapCut, Canva, Adobe...) can be operated by the desktop assistant, but expect to supervise those tasks. Driving the ChatGPT *website* with automation is against OpenAI's terms and may break at any time; the API is the safe route.

### Scheduled tasks
Plain-English jobs in `tasks/*.md`. Add `mode: desktop` to make the desktop assistant do it, and `schedule: daily 09:00` (or `every 2h`). See `tasks/README.md`. Example: `tasks/facebook-tourism-comments.md` (capped, approval-gated, runs in a separate browser).

---

## 3. Please read: limits and risks

- **WhatsApp and Facebook rules.** Automating personal WhatsApp or mass promotional commenting breaks their terms; accounts can be restricted. Keep numbers low, use `draft`/approval modes, use a number you can afford to lose while testing. The official WhatsApp Business API is the safer long-term route.
- **Cost.** The desktop assistant sends one screenshot to Claude per step, so a 20-step task costs roughly a few dollars on the default model at worst. Set `AGENT_MODEL=claude-sonnet-5-5` (cheaper) in `.env`. `desktop.max_steps` and `max_minutes` cap each task.
- **Privacy.** Screenshots of your screen (and email/chat text) are sent to Anthropic to do the task. Close anything private before running tasks, and don't run it on a screen showing banking or other people's confidential data. Local data (`data/`, `.env`) is git-ignored; never commit it.
- **It makes mistakes.** Screen-driving AI can misclick or misread. That's why it checks the screen every step, asks before risky actions, and keeps a recording. Start in `watch` mode.
- **Can't do:** create photos/videos by itself, pass captchas, enter your passwords/2FA (it asks you), or work while the laptop is asleep or locked.
- **Panel safety.** The control panel only listens on your own computer and needs its secret link; no website you visit can command it. Don't share the link.

## 4. What was tested
- 81 automated checks (`npm test`, plus `npm run test:real` on a virtual Linux screen): message parsing, safety rules, approvals, stop/pause behaviour, panel security, Gmail/Meta/OpenAI against fake servers, and the **real mouse, keyboard, screenshot and approval loop against a real browser window**.
- **Not tested here:** Windows and macOS themselves (display scaling, permissions), the live Claude API (no key in the build environment), live WhatsApp Web, Facebook, Instagram and Gmail. Use `npm run desktop-selftest`, `watch` mode, `--dry`, and drafts first. If the live API rejects the optional refusal-fallback setting, set `"llm": {"fallbacks": false}` in the config.

## 5. Files
| | |
|---|---|
| `config/agent.config.json` | modes, limits, schedule times |
| `config/business.md` | your facts and prices (the only source of prices) |
| `config/desktop-rules.md` | your standing rules for the computer assistant |
| `config/social.md`, `config/research.md` | brand voice; preferred research sources |
| `tasks/*.md` | scheduled jobs |
| `data/` | everything private: chats, drafts, briefings, recordings, logins (git-ignored) |
| `data/owner-alerts.md` | everything that needed you |
