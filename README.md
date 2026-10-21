# Fleet Logbook

Daily machine logbook for the plant hire fleet (CAT 426F, Bobcat S530, Tata 2628).

- **Drivers** open a link on their phone (no sign-in), fill in hours/km, fuel, diesel added and defects, and submit.
- **Everything is saved to a Google Sheet** in your Google account.
- **The dashboard** shows fleet status, service countdowns, fuel burn, defects, service history and parts stock.

```
Driver's phone ──► index.html (GitHub Pages) ──► Google Apps Script ──► Google Sheet
Your browser   ──► dashboard.html            ──┘
```

| File | What it is |
|---|---|
| `index.html` | Driver form. Share this link in the WhatsApp group. |
| `dashboard.html` | Your dashboard. Protected by an admin key. |
| `apps-script/Code.gs` | Backend that reads and writes the Google Sheet. |
| `config.js` | Holds your Apps Script URL. |
| `style.css` | Shared styling. |

---

## Setup (about 15 minutes, once)

### 1. Create the Google Sheet
1. Go to [sheets.new](https://sheets.new) and name it **Fleet Logbook**.

### 2. Add the script
1. In the Sheet: **Extensions → Apps Script**.
2. Delete what's in `Code.gs`, paste in the whole of [`apps-script/Code.gs`](apps-script/Code.gs), and click **Save**.
3. In the function dropdown at the top, choose **setup** and click **Run**. Approve the permission prompts. (Google warns that the app is unverified because it's your own script: click **Advanced → Go to Fleet Logbook**.)
4. Open **Execution log**. It shows your **Driver PIN** and **Dashboard ADMIN_KEY**. Copy both somewhere safe.
   You can change them any time under **Project Settings (gear icon) → Script properties**.

### 3. Fill in the Sheet
`setup` created these tabs:

| Tab | What to do |
|---|---|
| **Lists** | Driver names in column A (Operators), sites/clients in column B (Sites). The form only accepts names on this list. |
| **Machines** | Already has your 3 machines. `meter` is `h` (hours) or `km`. Optionally set `baseline` = current reading. |
| **Intervals** | Placeholder intervals (250 h / 500 h / 10,000 km). **Check them against each manual.** Fill in `last_done_at` with the reading at the last service so the countdowns start correctly. |
| **Parts** | Leave empty; add stock from the dashboard's Stock tab. |
| **Logs, Services** | Filled automatically. Don't rename the headers. |

### 4. Deploy the script as a web app
1. In Apps Script: **Deploy → New deployment**.
2. Gear icon → **Web app**.
3. **Execute as:** Me. **Who has access:** Anyone.
4. **Deploy**, then copy the **Web app URL** (ends in `/exec`).

### 5. Connect the site
1. On GitHub, open `config.js` → pencil icon → replace `PASTE_YOUR_WEB_APP_URL_HERE` with the URL from step 4 → **Commit changes**.

### 6. Turn on GitHub Pages
1. Repo **Settings → Pages**.
2. **Source:** Deploy from a branch. **Branch:** `main`, folder `/ (root)` → **Save**.
3. After a minute your links are:
   - Driver form: `https://jjkoch-ops.github.io/fleet-logbook/`
   - Dashboard: `https://jjkoch-ops.github.io/fleet-logbook/dashboard.html`

### 7. Go live
1. Open the dashboard, enter the ADMIN_KEY.
2. Submit a test log from your own phone with the PIN, check it appears in the Logs tab and on the dashboard, then delete that test row from the Sheet.
3. Pin the driver link and the PIN in the WhatsApp group.

---

## Day to day

- **Drivers:** one entry per machine per shift. With no signal, the form saves the log on the phone and sends it automatically when signal returns.
- **Form checks:** reading can't go below the last one; unusually large jumps need a tick to confirm; defects need a description.
- **Photos** of the hour meter are saved to a Drive folder called *Fleet Logbook photos* and linked in the Logs tab.
- **Record a service** on the dashboard's Service tab. It resets that service's countdown and takes the parts used off stock.
- **Change the PIN** (e.g. when a driver leaves) under Script properties. Drivers re-enter it once.

## Daily report (email and WhatsApp)

Every evening you get a summary: machines **not logged today**, what was logged (hours worked, operator, diesel), defects reported, services overdue or due soon, and parts to reorder.

1. Paste the latest `Code.gs` into Apps Script and save (and redeploy: **Deploy → Manage deployments → Edit → New version → Deploy**).
2. In the function dropdown choose **testReport** → **Run**. Approve the new permissions (sending email, scheduling). Check your inbox.
3. Choose **installDailyReport** → **Run**. The report now goes out every day at about 18:00.
4. Check **Project Settings → Time zone** is *(GMT+02:00) Johannesburg*.

Optional script properties (**Project Settings → Script properties**):

| Property | Default | Use |
|---|---|---|
| `NOTIFY_EMAIL` | your Google account | Send to another address, or several separated by commas |
| `REPORT_HOUR` | `18` | Hour to send (0–23). Run `installDailyReport` again after changing it |
| `SKIP_DAYS` | `Sun` | Days with no report, e.g. `Sat,Sun` |

### WhatsApp to your own phone (optional, free)

Uses [CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/), a free third-party service that sends WhatsApp messages to **your own number only** (not to a group).

1. Check the current CallMeBot number on their website and save it in your contacts.
2. Send it the WhatsApp message: `I allow callmebot to send me messages`
3. It replies with your API key.
4. Add script properties `CALLMEBOT_PHONE` (e.g. `+27821234567`) and `CALLMEBOT_APIKEY`.
5. Run **testReport** to check.

## Updating the script

If `Code.gs` changes: paste the new version into Apps Script, then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same.

## Security notes

- The driver link is public, so the PIN stops strangers submitting logs.
- The dashboard key protects your data. Don't share the dashboard key in WhatsApp.
- All data stays in your Google Sheet.

## Trucks: hours + km, logged per trip (Tata 2628)

Machines tab columns:

| Column | Meaning |
|---|---|
| `meter` | `h` for every machine. Services count on hours. |
| `km` | `yes` = the form also asks for the odometer (km) |
| `km_baseline` | optional current odometer before the first log |
| `trips` | `yes` = the driver submits after **each trip** with From, To and Material |

Lists tab column C (**Materials**) fills the Material suggestions on the form.

After pasting a new version of `Code.gs`, run **upgrade** once. It adds the new columns and sets the Tata to `meter=h`, `km=yes`, `trips=yes`. Then set the Tata's service interval in **hours** on the Intervals tab.
