# Google OAuth Verification — Scope Justification

Copy-paste ready content for the Google Cloud Console verification flow
(Centrum weryfikacji → Uzasadnienia zakresu / Scope justifications).

---

## Requested scope

`https://www.googleapis.com/auth/calendar.readonly`

## Scope justification (paste into "Uzasadnienia zakresu" field)

HealthDesk is a cross-platform desktop wellness application that helps
knowledge workers take structured breaks to prevent computer-related
health issues (eye strain, musculoskeletal pain, dehydration, burnout).
The app schedules short "eye rest" breaks, longer stretching breaks,
water reminders, and breathing exercises based on configurable work
methods (Pomodoro, 20-20-20, 52-17, custom).

The `calendar.readonly` scope is required so the app can avoid
interrupting the user during meetings. Without calendar awareness, a
break popup can appear in the middle of a video call, which is both
socially disruptive and trains users to dismiss all reminders reflexively
— defeating the health purpose of the app.

**Specific data accessed:**

1. **Calendar list** (`GET /calendar/v3/users/me/calendarList`) — the
   user picks which calendars HealthDesk should watch in Settings. The
   app shows calendar names and colors; no other calendar metadata is
   used.

2. **Today's events** (`GET /calendar/v3/calendars/{id}/events` with
   `timeMin=start_of_day` and `timeMax=end_of_day`, `singleEvents=true`,
   `orderBy=startTime`, `maxResults=20`) — only events for the current
   day are fetched, for each user-selected calendar. The fields read
   are: `summary`, `start`, `end`, `organizer`, `description`,
   `hangoutLink`, `reminders`.

**How the data is used:**

- **In-meeting detection**: if the current time falls inside any event's
  `[start, end]` window, the break scheduler suppresses popups until the
  meeting ends. This is a read-only check performed locally; no data is
  sent anywhere.
- **Pre-meeting reminder**: if an event starts within 5 minutes, a
  single notification is shown so the user can finish what they are
  doing before the call. The notification uses only the event title and
  start time.
- **Display**: the upcoming events for today are shown in a read-only
  list inside the HealthDesk dashboard so the user can see at a glance
  what their day looks like. No editing, deletion, or creation is ever
  performed.

**Why read-only is sufficient:** HealthDesk never modifies the user's
calendar. The app does not create events, update events, delete events,
change reminders, share calendars, or write to any Google Calendar
resource. All writes are forbidden — the `calendar.readonly` scope is
the minimum required and matches the app's behavior exactly.

**How data is stored:** Event data is held **only in memory** while the
app is running. Nothing is persisted to disk, nothing is transmitted to
any third-party server, and the user can disconnect at any time
(Settings → Integrations → Disconnect), which revokes the token with
Google's `/revoke` endpoint and deletes all local OAuth material from
the operating-system keyring (Windows Credential Manager / macOS
Keychain / Linux Secret Service).

**Authentication:** The app uses the OAuth 2.0 Authorization Code flow
with PKCE (RFC 7636, S256 challenge) and a random `state` parameter to
protect the callback. No `client_secret` is shipped in the binary.

## Additional information (paste into "Informacje dodatkowe" field, optional)

HealthDesk is GPL-3.0 licensed, open source on GitHub
(https://github.com/JarekSaternus/HealthDesk), and distributed as a free
desktop installer from https://healthdesk.site. The calendar integration
is entirely optional — the app's core break-scheduling features work
without any Google account. All calendar data processing happens locally
on the user's machine; no telemetry or analytics service receives
calendar content.

---

## Video script (60-90 seconds — record this flow)

Record with OBS Studio or Windows Xbox Game Bar (Win+G). Upload to
YouTube as **Unlisted** and paste the link into "Link do filmu".

Scene 1 (~10s) — HealthDesk launch
- Show the HealthDesk main window with the dashboard visible.
- Narrate: "This is HealthDesk, a desktop app that reminds me to take
  healthy breaks during computer work. I want to show how it uses
  Google Calendar."

Scene 2 (~15s) — Trigger OAuth connect
- Click the sidebar → Settings → Integracje (Integrations) tab.
- Click "Połącz z Google Calendar" / "Connect Google Calendar" button.
- Narrate: "I click Connect, which opens the browser."

Scene 3 (~15s) — Google consent screen
- Browser opens the Google OAuth consent page.
- Make sure the URL bar shows accounts.google.com.
- Make sure the app name "HealthDesk" is visible.
- Make sure the scope "See and download any calendar you can access
  using your Google Calendar" is visible in the permission list.
- Click "Allow".
- Narrate: "Google shows me exactly what the app wants — read-only
  access to my calendars. I click Allow."

Scene 4 (~15s) — Return to app
- Browser shows the "Połączono z Google Calendar!" success page.
- Switch back to HealthDesk.
- Settings → Integracje now shows "Connected" status.
- Show the calendar list with checkboxes for each calendar.
- Narrate: "HealthDesk is now connected. I can pick which calendars it
  should watch."

Scene 5 (~15s) — Show data usage
- Go back to the main dashboard.
- Show the "Upcoming events today" section with a real event or two.
- Point to a status indicator that says "In meeting" or "Next meeting
  in 32 min".
- Narrate: "The app reads only today's events and uses them to avoid
  interrupting me during meetings. It never writes to my calendar."

Scene 6 (~5s) — Disconnect demonstration
- Settings → Integracje → click "Rozłącz" / "Disconnect".
- Show the status changing back to "Not connected".
- Narrate: "Disconnecting revokes the token at Google and clears all
  local data."

**Upload checklist:**
- [ ] Video is 60-120 seconds
- [ ] Audio narration in English (or clear captions)
- [ ] URL bar visible on consent screen
- [ ] Scope description readable on consent screen
- [ ] Allow button click visible
- [ ] Uploaded to YouTube as **Unlisted**
- [ ] Link copied into "Link do filmu" in Centrum weryfikacji

## OAuth flow end-to-end test (before recording)

```bash
npm run tauri dev
```

Then in the running app:
1. Settings → Integrations → Google Calendar → Connect
2. Browser should open with URL starting
   `https://accounts.google.com/o/oauth2/v2/auth?client_id=...&...&code_challenge=...&code_challenge_method=S256`
3. Grant permission
4. Should see "Połączono z Google Calendar!" in browser
5. HealthDesk should show calendars list
6. No errors in Rust log (`tauri dev` console)

If the token exchange fails with `invalid_client` or similar, Google
may require `client_secret` for Desktop apps even with PKCE. In that
case, the new secret from the rotation (the `****b.iht` one visible in
GCP Console) needs to be injected via the `HEALTHDESK_GCAL_CLIENT_SECRET`
build-time env var — but the current code does not read it since
commit 989932f removed `option_env!`. Would need a revert + rebuild.
