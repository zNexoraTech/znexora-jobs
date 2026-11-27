# Daily robot: collect jobs automatically every day

Every day at **06:00 Japan time** the robot does this by itself:

1. Imports jobs from every employer feed (careers pages / XML feeds that verified employers added).
2. Runs your saved searches at **Jooble** (a job search engine with an official API) and adds new jobs.
3. Skips duplicates, sorts every job into a category, and publishes it (or holds it for your review).
4. **Closes** jobs that expired, that the source stopped showing, or that are older than 30 days.
5. Writes a report you can read in **Admin → Daily robot**.

The jobs then go through what you already have: category pages, email alerts to matching seekers, the Excel download, and (if you switch it on) Telegram/Facebook posts.

Collected jobs are shown as **"apply on the original listing"**. Seekers read a summary on your site and apply on the source site. You are not acting as a paid recruitment agent.

**Time needed:** about 45 minutes, plus waiting for the Jooble key email.

---

## Before you start (finish these first)

- [ ] `supabase/migrations/005_grants.sql` has been run in the SQL Editor, and you can log in.
- [ ] Your account shows the **Admin** menu. If not, run this in the SQL Editor:
  ```sql
  insert into public.profiles (id, role, display_name)
  select id, 'admin', 'Admin' from auth.users where email = 'zinmarlwin.ncd@gmail.com'
  on conflict (id) do update set role = 'admin', suspended = false;
  ```
- [ ] You changed the password you shared in the chat.

---

## Step 1. Upload the new files to GitHub (10 min)

Upload these files to the **same paths** in your `znexora-jobs` repo (Add file → Upload files, or edit each file and paste):

| File | New or changed |
|---|---|
| `supabase/migrations/006_daily_collector.sql` | new |
| `supabase/functions/daily-collector/index.ts` | new |
| `supabase/functions/_shared/jooble.ts` | new |
| `supabase/functions/_shared/feeds.ts` | new |
| `supabase/functions/import-feeds/index.ts` | changed |
| `supabase/functions/share-job/index.ts` | changed |
| `.github/workflows/deploy-functions.yml` | new |
| `site/admin.html` | changed (new "Daily robot" tab) |
| `site/assets/js/pages/admin.js` | changed |
| `site/assets/js/pages/home.js` | changed |
| `site/assets/css/style.css` | changed |
| `site/i18n/en.json`, `site/i18n/ja.json`, `site/i18n/my.json` | changed |
| `docs/DAILY-COLLECTOR.md` | new (this guide) |

Easiest way: unzip `znexora-jobs.zip` and drag the whole `supabase`, `site`, `docs` and `.github` folders onto the repo's upload page. GitHub replaces files with the same name.

> `.github` is a hidden folder on Mac. Press **Cmd + Shift + .** in Finder to see it. If uploading it is awkward, create the file on GitHub instead: **Add file → Create new file**, type the name `.github/workflows/deploy-functions.yml`, and paste the contents.

---

## Step 2. Create the robot's tables (2 min)

1. Supabase → **SQL Editor** → **New query**.
2. Paste all of `supabase/migrations/006_daily_collector.sql` and click **Run**.
3. You should see **Success. No rows returned**. It's safe to run again if unsure.

This adds: the robot settings, 8 starter searches (外国人歓迎 in Tokyo/Osaka/Aichi, ミャンマー語, 特定技能, 介護 外国人, 英語 日本語不要, English speaking Tokyo), and the run reports.

---

## Step 3. Request a Jooble API key (5 min + waiting)

1. Open **https://jp.jooble.org/api/about** (the Japan site).
2. Fill in the form:
   - Website: `https://znexoratech.github.io/znexora-jobs/`
   - Describe it as: "Job board for foreign workers in Japan, showing job summaries with links to the original listings."
3. Jooble emails you a key (a long code like `a1b2c3d4-...`). Keep it secret.
4. **Read the terms in that email** (for example, whether they ask you to show "jobs by Jooble"). Tell me if anything there needs a change on the site.

> The free key has a **limited number of requests in total** (reported to be about 500). The robot is set to stop at 480 and uses 8 a day, so the key lasts about 2 months. Before it runs out, ask Jooble for a larger allowance (reply to their email; they offer partner deals for sites that send them traffic). You can watch the counter in Admin → Daily robot.

You can do steps 4 to 7 while you wait. Without a key, the robot still runs the employer feeds and the clean-up.

---

## Step 4. Let GitHub deploy the functions for you (10 min)

The new workflow uploads all your Supabase functions every time you change them, so you don't need to install anything.

**4a. Create a Supabase access token**
1. Go to **https://supabase.com/dashboard/account/tokens**.
2. Click **Generate new token**, name it `github-deploy`, and copy it. (It's shown only once.)

**4b. Add two secrets to GitHub**
1. GitHub → your `znexora-jobs` repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add:
   - Name `SUPABASE_ACCESS_TOKEN`, value: the token from 4a
   - Name `SUPABASE_PROJECT_REF`, value: `dslybmgvlhhkkguhnanb`

**4c. Run the deploy**
1. GitHub → **Actions** tab → **Deploy Supabase functions** (left side) → **Run workflow** → **Run workflow**.
2. Wait for the green tick (about 1 to 2 minutes).
3. Check: Supabase → **Edge Functions**. You should see `daily-collector`, `import-feeds`, `share-job`, `send-job-alerts`, `delete-account` and `careerjet-search`.

If it fails with a red ✗, click the run, open the red step, and send me a screenshot.

---

## Step 5. Add the robot's secrets in Supabase (5 min)

**5a. Make a random password for the scheduler.** In the SQL Editor run:
```sql
select encode(gen_random_bytes(24), 'hex') as cron_secret;
```
Copy the result. This is your **CRON_SECRET**. Skip this if you already set one for job alerts; use the same value.

**5b. Add the secrets.** Supabase → **Edge Functions** → **Secrets** (left menu "Edge Function Secrets") → **Add new secret**:

| Name | Value |
|---|---|
| `CRON_SECRET` | the value from 5a |
| `ALLOWED_ORIGINS` | `https://znexoratech.github.io` |
| `JOOBLE_API_KEY` | your Jooble key (add it when the email arrives) |
| `JOOBLE_HOST` | `jp.jooble.org` (only change this if Jooble's email names a different site) |

Secrets take effect straight away; you don't need to redeploy.

> Never put these values in `config.js` or anywhere in the GitHub repo.

---

## Step 6. Schedule it every day (5 min)

1. Supabase → **Database** → **Extensions**: search for **pg_cron** and turn it on, then **pg_net** and turn it on.
2. SQL Editor → run this, replacing the **two** placeholders:
   ```sql
   select cron.schedule('daily-collector', '0 21 * * *', $$
     select net.http_post(
       url     := 'https://dslybmgvlhhkkguhnanb.supabase.co/functions/v1/daily-collector',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','PASTE-YOUR-CRON-SECRET'),
       body    := '{}'::jsonb,
       timeout_milliseconds := 300000
     );
   $$);
   ```
   `0 21 * * *` is 21:00 UTC, which is **06:00 Japan time**.
3. If you scheduled `import-feeds` earlier, remove that schedule (the robot now does it):
   ```sql
   select cron.unschedule('import-feeds');
   ```
   An error saying it doesn't exist is fine.
4. Check: `select jobname, schedule from cron.job;` should list `daily-collector`.

---

## Step 7. Test it now (5 min)

1. Open your site → log in → **Admin** → **Daily robot**.
2. Click **Run now** and wait up to 2 minutes.
3. **Recent runs** shows a row with Added / Updated / Closed numbers, and a line per search such as `jooble · 外国人歓迎 @ 東京都: ok: 50 found, 38 new, 0 updated`.
4. Open **Jobs**. The new jobs are there, sorted into categories. Click one: it shows the summary and a link to the original listing.

**Run now** works at most once every 15 minutes, and every click uses Jooble requests, so don't test repeatedly.

---

## Step 8. Choose how strict to be (2 min)

In **Admin → Daily robot**:

| Setting | Start with | Why |
|---|---|---|
| New collected jobs | **Wait for my review** for the first week, then **Publish straight away** | Lets you check the quality before jobs go live automatically. Jobs with scam phrases always wait for review. |
| Jooble searches per day | 8 | Each search uses 1 request from your allowance |
| Also post collected jobs to Telegram / Facebook | **Off** at first | Many jobs a day can look like spam and get a Page restricted |
| Max collected jobs posted per day | 10 | Applies only when the option above is on |
| Close if the source hasn't shown it for | 7 days | Keeps listings current |
| Close a collected job after | 30 days | Old jobs are usually filled |

Under **What the robot looks for**, you can add searches (for example `工場 外国人` + `愛知県`, `ホテル 英語`, `建設 特定技能`), switch them off, or delete them. Searches run oldest-first, so with more than 8 searches they take turns across days.

---

## Every day: what you do (2 min)

- Glance at **Admin → Daily robot → Recent runs**. A red **Problem** badge shows what went wrong.
- If you chose "Wait for my review", approve jobs in **Admin → Jobs to review**.
- Every couple of weeks, check the **Jooble requests used** line.

## If something goes wrong

| What you see | What to do |
|---|---|
| "The daily robot isn't set up yet" in the Admin tab | Do Step 2 |
| "Couldn't start the robot" | Do Step 4; check that `daily-collector` is in Edge Functions |
| `jooble: skipped: JOOBLE_API_KEY not set` | Do Step 5 with your key |
| `Jooble answered HTTP 403` | Wrong key, or the key is for another country: check `JOOBLE_HOST` |
| `stopped: Jooble request allowance used up` | Ask Jooble for more. After you get a new key, update `JOOBLE_API_KEY` and reset the counter: `update public.collector_settings set jooble_requests_used = 0;` (in the SQL Editor) |
| No run at 06:00 | Check that `select * from cron.job_run_details order by start_time desc limit 5;` shows runs, and that the secret in the schedule matches `CRON_SECRET` |
| Many "skipped" | Normal: duplicates, jobs without a Japanese prefecture, and jobs you already have are skipped |

## Adding more sources later

- **Hello Work (government job API):** the biggest and best source of employer-consented jobs. Apply after you file your MHLW notification (特定募集情報等提供事業). When approved, send me the specification and I'll add a Hello Work step to the robot. The database already has a `hellowork` source type.
- **Employer feeds:** every verified employer can add their careers page in **Add jobs → Job feeds**. The robot imports them every morning.
- **Never** add scraping of Facebook groups or other job sites. It breaks their terms and the accuracy rules for job sites.
