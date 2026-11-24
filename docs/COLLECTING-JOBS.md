# Collecting jobs: what to prepare and how to switch each source on

There are five ways jobs get onto the site. 1 to 3 work as soon as Supabase is set up. 4 and 5 need outside accounts or approval.

| # | Source | Who uses it | Needs |
|---|---|---|---|
| 1 | Post a job (form) | Employers | Nothing extra |
| 2 | CSV upload (many jobs at once) | Employers, recruiters, staffing companies | Migration 003 |
| 3 | Shared jobs + admin import | Job seekers send, you publish | Migration 002 (done) |
| 4 | Careers page / XML feed, imported daily | Verified employers | Migration 003 + `import-feeds` function |
| 5 | More jobs from other sites (Careerjet) | Shown on the jobs page | Careerjet partner account + `careerjet-search` function |
| – | Hello Work job data | Later | Hello Work approval (see bottom) |

---

## Step 1. Run migration 003 (2 min)
Supabase → SQL Editor → New query → paste `supabase/migrations/003_job_import.sql` → Run.

That's all CSV upload needs. Employers see **Import jobs** in their dashboard:
1. Download the template (`site/templates/jobs-template.csv`)
2. Fill one row per job in Excel / Google Sheets
3. Upload. They get a preview showing which rows are OK and what's wrong with the others, then import.

Rows with the same `ref` update the existing job, so recruiters can re-upload their whole list every week. Up to 200 rows per file. UTF-8 and Excel's Japanese CSV (Shift_JIS) both work.

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
- [ ] Supabase set up and migrations 001, 002, 003 run
- [ ] Supabase CLI installed and project linked
- [ ] `CRON_SECRET` chosen; `pg_cron` + `pg_net` enabled
- [ ] `import-feeds` deployed and scheduled
- [ ] A short "How to send us your jobs" message for recruiters (CSV template + feed option)
- [ ] Careerjet publisher account and API key
- [ ] (Later) MHLW notification number, then Hello Work data service application
