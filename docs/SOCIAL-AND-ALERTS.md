# Setup: visas, instant publishing, shared jobs, alerts and auto-share

Do these steps on **staging** first, then repeat on production.

## 1. Run the database update (5 min)
Supabase → SQL Editor → New query → paste all of `supabase/migrations/002_visas_autopublish_tips_alerts.sql` → Run.

This adds:
- **Visa types on every job** (`eligible_visas`, `ssw_field`) and a visa filter
- **Instant publishing**: after you approve a verified employer's first job, their next jobs go live straight away. Jobs containing risky phrases (fees, deposits, "no visa", ビザ不要, ကြိုတင်ငွေ …) still go to review. You can switch it off per employer in Admin → Instant publishing.
- **Shared jobs** (`job_tips`): any logged-in user can send a job they saw on Facebook/Telegram/LINE
- **Imported jobs**: admin publishes them as "apply directly to the employer" listings
- **Job alerts** (`job_alerts`): up to 5 saved searches per job seeker

Nothing else changes for existing data. Existing jobs get an empty visa list. Ask employers to edit them and tick the visa types.

## 2. Job alerts by email (15 min)
1. Create a free account at **resend.com**, add and verify your domain, and create an API key.
2. Deploy the function (Supabase CLI):
   ```bash
   supabase functions deploy send-job-alerts --no-verify-jwt
   supabase secrets set RESEND_API_KEY=re_xxx \
     ALERT_FROM_EMAIL="ZNexora Jobs <alerts@your-domain.com>" \
     SITE_URL="https://znexoratech.github.io/znexora-jobs/" \
     CRON_SECRET="a-long-random-string"
   ```
   `--no-verify-jwt` is needed because the scheduler calls it. The function checks `CRON_SECRET` itself.
3. Supabase → Database → Extensions: enable **pg_cron** and **pg_net**.
4. SQL Editor, run once (change the project ref and secret). This runs every day at 09:00 Japan time (00:00 UTC):
   ```sql
   select cron.schedule('send-job-alerts', '0 0 * * *', $$
     select net.http_post(
       url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-job-alerts',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','a-long-random-string'),
       body    := '{}'::jsonb
     );
   $$);
   ```
   Test it now with the same `select net.http_post(...)` line on its own.

## 3. Auto-share new jobs to Telegram and Facebook (20 min)
Set up either one, or both. A channel without its secrets is skipped.

**Telegram channel**
1. In Telegram, talk to **@BotFather** → `/newbot` → copy the bot token.
2. Create your channel, add the bot as an **administrator** who can post.
3. Chat id = `@your_channel_name` (public channel) or the numeric id.

**Facebook Page**
1. You need a Facebook **Page** (not a personal profile or group) and a Meta developer app.
2. Get a **long-lived Page access token** with `pages_manage_posts` and `pages_read_engagement` (Meta Graph API Explorer → generate user token → exchange for long-lived → `/me/accounts` gives the Page token).
3. Page id is on the Page's About section or in the `/me/accounts` result.
   Note: Meta can require App Review before posting works outside development mode.

**Deploy and connect**
```bash
supabase functions deploy share-job --no-verify-jwt
supabase secrets set WEBHOOK_SECRET="another-long-random-string" \
  SITE_URL="https://znexoratech.github.io/znexora-jobs/" \
  TELEGRAM_BOT_TOKEN=123:abc TELEGRAM_CHAT_ID=@your_channel \
  FB_PAGE_ID=1234567890 FB_PAGE_TOKEN=EAAB...
```
**Per-industry channels (optional).** Every job goes to the main channel/Page above, *and* to its industry's channel/Page if you set one:
```bash
supabase secrets set TELEGRAM_CHANNELS='{"restaurant":"@zjobs_food","care":"@zjobs_care","factory":"@zjobs_factory"}'
supabase secrets set FB_PAGES='{"care":{"id":"1234567890","token":"EAAB..."}}'
```
Industries: restaurant, care, factory, construction, logistics, retail, hotel, cleaning, agriculture, it, office, education, other.

Supabase → Database → **Webhooks** → Create:
- Table `jobs`, events **Insert** and **Update**
- Type: **Supabase Edge Functions** → `share-job`, method POST
- HTTP header: `x-webhook-secret` = your WEBHOOK_SECRET

Each job is posted once, when it first goes live (tracked in `jobs.shared_at`).

## 4. Shared jobs and imports: how to run it
1. People send jobs from **Share a job you saw** (link in the jobs page, home page and footer).
2. Admin → **Shared jobs**: read it, and **contact the employer first**. Only publish with their OK to show the job and contact details.
3. Click **Import this job**: the form is pre-filled. Choose or create the employer listing, tick visa types, enter how to apply, tick the consent box, then **Publish job**.
4. Imported jobs show a gold "Apply directly to the employer" box instead of the apply form. Applications don't go through your site, which keeps you a job *information* site rather than a placement agency.

Don't copy posts from Facebook groups automatically. It breaks Facebook's terms and can get your accounts banned.

## 5. Visa information
- Employers must tick at least one visa type before submitting a job, plus the Specified Skilled Worker field if they tick SSW.
- Job pages show "Who can apply (visa types)". The jobs page has a "My visa type" filter. Alerts can include a visa type.
- `site/legal/visa-guide.html` explains each status in English, Burmese and Japanese (text in `site/i18n/*.json`, keys `visa.*`, `ssw.*`, `vg.*`).
- **Review the visa text with an administrative scrivener (行政書士)** before launch, and re-check it at least every 6 months. Rules for Myanmar nationals (特定活動), Specified Skilled Worker fields, and the move from 技能実習 to 育成就労 (from 2027) are changing.
