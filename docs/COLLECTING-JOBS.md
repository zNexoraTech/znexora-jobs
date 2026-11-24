# Collecting jobs: what to prepare and how to switch each source on

There are five ways jobs get onto the site. 1 to 3 work as soon as Supabase is set up. 4 and 5 need outside accounts or approval.

| # | Source | Who uses it | Needs |
|---|---|---|---|
| 1 | Post a job (form) | Employers | Nothing extra |
| 2 | Multi-job form ("Add jobs", up to 20 at once) | Employers, recruiters, staffing companies | Migrations 003 + 004 |
| 3 | Shared jobs + admin import | Job seekers send, you publish | Migration 002 (done) |
| 4 | Careers page / XML feed, imported daily | Verified employers | Migration 003 + `import-feeds` function |
| 5 | More jobs from other sites (Careerjet) | Shown on the jobs page | Careerjet partner account + `careerjet-search` function |
| – | Hello Work job data | Later | Hello Work approval (see bottom) |

---

## Step 1. Run migrations 003 and 004 (2 min)
Supabase → SQL Editor → run `003_job_import.sql`, then `004_categories.sql`.

Employers then see **Add jobs** in their dashboard: a form with one card per job (up to 20). **Copy** duplicates a card (keeping everything except the title) so similar jobs take seconds.

### What the robot does with every job (form, single post, feed or admin import)
1. **Sorts it into an industry**: restaurant, care, factory, construction, logistics, retail, hotel, cleaning, agriculture, IT, office, education, other. It uses the employer's choice, or detects it from the title/description in English, Japanese and Burmese when left on "Detect automatically".
2. **Shows it on the matching category page** (`jobs.html?cat=restaurant` …) and in the "Browse by industry" grid on the home page.
3. **Posts it to the matching social channels**: your main Telegram channel/Facebook Page, plus the industry channel/Page if you set one (see `docs/SOCIAL-AND-ALERTS.md`, `TELEGRAM_CHANNELS` / `FB_PAGES`).
4. **Emails matching job seekers** in the next daily alert. Alerts can now include an industry.
5. **Keeps the Excel up to date**: Admin → **Excel** → *Download Excel* builds a fresh .xlsx from the live database (sheets: Jobs, Employers, Shared jobs) every time you click.

## Step 2. Daily import from careers pages and XML feeds (15 min)

**What employers need:** a careers page with Google for Jobs markup (`JobPosting` in JSON-LD; most applicant-tracking systems such as HRMOS, Wantedly, HERP and Talentio output it), **or** an XML feed in the common `<job>` format (the one Indeed and Stanby use).

**What you do:**
1. Install the Supabase CLI and link your project (see README step 5).
2. Deploy:
   ```bash
   supabase functions deploy import-feeds --no-verify-jwt
   supabase secrets set CRON_SECRET="a-long-random-string" \
     ALLOWED_ORIGINS="https://znexoratech.github.io"
   ```
   (`CRON_SECRET` is the same one used for job alerts. Skip it if already set.)
3. Schedule it daily at 06:00 Japan time (21:00 UTC). Enable `pg_cron` and `pg_net` in Database → Extensions first:
   ```sql
   select cron.schedule('import-feeds', '0 21 * * *', $$
     select net.http_post(
       url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/import-feeds',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','a-long-random-string'),
       body    := '{}'::jsonb,
       timeout_milliseconds := 120000
     );
   $$);
   ```

**How it behaves**
- Only **verified** employers can add a feed (max 3 each). Employers can also click **Run now** (at most every 10 minutes).
- New jobs follow your normal rules: trusted employers' clean jobs go live, everything else waits in Admin → Jobs to review.
- Jobs that disappear from the feed are closed automatically, which keeps listings accurate (an MHLW requirement for job sites).
- Imported jobs have no visa types (feeds don't contain them). They show "employer hasn't listed visa types", and the employer can edit them to add visas.
- Security: only public `https://` addresses are fetched (no internal or private IPs, no odd ports, max 3 redirects, 3 MB, 15 s timeout). XML with DOCTYPE/ENTITY declarations is refused.

## Step 3. "More jobs from other sites" with Careerjet (20 min + approval)
1. Sign up as a publisher at **careerjet.com/partners** and register your site. You get an **API key** for your site.
2. Deploy:
   ```bash
   supabase functions deploy careerjet-search --no-verify-jwt
   supabase secrets set CAREERJET_API_KEY="your-key" CAREERJET_LOCALE="ja_JP" \
     ALLOWED_ORIGINS="https://znexoratech.github.io"
   ```
   Check the exact locale code for Japan in your Careerjet account (the format is `language_COUNTRY`).
3. In `site/assets/js/config.js` set `CAREERJET_ENABLED: true` and commit.

Up to 10 results appear under your own jobs on the jobs page, with a warning that they're from other sites. Results link out to the original listing, are cached for 10 minutes, and the key stays secret on the server.

## Step 4 (later). Hello Work job data
The labour ministry shares Hello Work jobs (only those whose employers agreed) as XML files through the **ハローワーク求人・求職情報提供サービス**. Prepare:
- Your MHLW notification acceptance number (特定募集情報等提供事業), since you must be a registered job site first
- Company or sole-proprietor details, contact person, privacy measures
- Then contact Hello Work / MHLW to confirm a job information site can use the data service, and apply.

When approved, send me the data specification they give you and I'll add a Hello Work importer that refreshes daily.

---

## Don't
- Don't scrape Facebook groups, Indeed, CareerCross or other job sites. It breaks their terms, the job text is copyrighted, and Meta removed group access for apps in April 2024.
- Don't import a careers page without the company's permission.
- Don't leave stale jobs online. Feeds close missing jobs automatically, and jobs expire after 60 days.

## Preparation checklist
- [ ] Supabase set up and migrations 001, 002, 003, 004 run
- [ ] Supabase CLI installed and project linked
- [ ] `CRON_SECRET` chosen; `pg_cron` + `pg_net` enabled
- [ ] `import-feeds` deployed and scheduled
- [ ] A short "How to send us your jobs" message for recruiters (register, then Add jobs, or give us your careers-page address)
- [ ] (Optional) Telegram channels / Facebook Pages per industry
- [ ] Careerjet publisher account and API key
- [ ] (Later) MHLW notification number, then Hello Work data service application
