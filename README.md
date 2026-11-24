# ZNexora Jobs

A job board for the Myanmar community in Japan. Employers post jobs, job seekers apply. English / Burmese (မြန်မာ) / Japanese.

> **Status: private staging.** Don't collect real people's data until (1) your employer has given written consent and (2) your MHLW notification (特定募集情報等提供事業) has been accepted. Use dummy accounts only.

## How it works

| Part | Tool | Cost |
|---|---|---|
| Code | GitHub (private repo) | Free |
| Website hosting | Cloudflare Pages (serves the `site/` folder, no build step) | Free |
| Login, database, CV files | Supabase (Tokyo region) | Free → $25/month (Pro) at launch |
| Bot protection (optional) | Cloudflare Turnstile | Free |

The site is plain HTML + JavaScript modules, so there's nothing to compile. Security is enforced **in the database** (Row Level Security + triggers), not in the browser.

```
site/                     ← the website (Cloudflare Pages output directory)
  index.html, jobs.html, job.html, signup.html, login.html,
  dashboard.html, post-job.html, applicants.html, admin.html, ...
  legal/                  ← Terms, Privacy, Posting rules, Seeker guide (DRAFTS)
  assets/css/style.css
  assets/js/config.js     ← EDIT THIS: Supabase URL + anon key
  assets/js/pages/*.js    ← one script per page
  i18n/en.json my.json ja.json  ← all interface text
  _headers                ← security headers (CSP, HSTS, noindex for staging)
supabase/
  migrations/001_schema.sql   ← tables, RLS policies, triggers, storage bucket
  functions/delete-account/   ← Edge Function for "Delete my account"
  migrations/002_...sql       ← visas, instant publishing, shared jobs, alerts
  functions/send-job-alerts/  ← daily email alerts (Resend)
  functions/share-job/        ← auto-post new jobs to Telegram / Facebook Page
  seed.sql                    ← dummy data + make yourself admin (staging only)
docs/
  SECURITY-CHECKLIST.md
  LAUNCH-CHECKLIST.md
```

## Setup (about 30–60 minutes)

### 1. Upload to GitHub
1. Create a **private** repository, e.g. `znexora-jobs`.
2. Upload all files in this folder (drag and drop on GitHub, or `git push`).

### 2. Create the Supabase project (staging)
1. Go to supabase.com → New project → name `znexora-jobs-staging`, region **Tokyo (ap-northeast-1)**, strong DB password.
2. **SQL Editor** → New query → paste all of `supabase/migrations/001_schema.sql` → **Run**. It should finish with "Success".
3. Run `supabase/migrations/002_visas_autopublish_tips_alerts.sql` the same way (visas, instant publishing, shared jobs, alerts). See `docs/SOCIAL-AND-ALERTS.md` for the email-alert and Facebook/Telegram setup.
4. **Authentication → Sign In / Providers → Email**: keep email sign-up on and **Confirm email ON**. Set minimum password length to 10.
5. **Authentication → URL Configuration**:
   - Site URL: your Cloudflare address (step 3), e.g. `https://znexora-jobs.pages.dev`
   - Redirect URLs: add `https://znexora-jobs.pages.dev/**` and `http://localhost:8788/**`
6. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
   ⚠️ Never copy the `service_role` key into the website.

### 3. Edit the config
Open `site/assets/js/config.js` and paste the Project URL and anon key. Commit the change.

### 4. Deploy (choose A or B)

**A. GitHub Pages — quickest for testing**
1. GitHub Pages is free only for **public** repos (private needs GitHub Pro). A public repo is OK for testing: the anon key is meant to be public and the database rules protect the data. Just never commit the `service_role` key.
2. Push to `main` (or Actions tab → "Deploy site to GitHub Pages" → Run workflow). The included `.github/workflows/pages.yml` copies the `site/` folder to a `gh-pages` branch.
3. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `gh-pages`, folder `/ (root)`** → Save.
4. Open `https://YOUR-USERNAME.github.io/REPO-NAME/` (shown in Settings → Pages after the first run).
5. In Supabase → Authentication → URL Configuration: set Site URL to that address, and add `https://YOUR-USERNAME.github.io/REPO-NAME/**` to Redirect URLs.
6. Note: GitHub Pages ignores `_headers`; each page has a Content-Security-Policy meta tag instead. GitHub's terms don't allow running a commercial service on GitHub Pages, so **move to Cloudflare Pages (B) before public launch**.

**B. Cloudflare Pages — for production**
1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → choose the repo.
2. Build settings: Framework preset **None**, Build command **(leave empty)**, Build output directory **`site`**.
3. Deploy. You get `https://<project>.pages.dev`.
4. **Keep staging private**: Zero Trust → Access → Applications → add a self-hosted app for your `*.pages.dev` domain and allow only your email (free up to 50 users).

### 5. Deploy the delete-account function
Install the Supabase CLI (https://supabase.com/docs/guides/cli), then:
```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy delete-account
```
Edit `ALLOWED_ORIGINS` in `supabase/functions/delete-account/index.ts` first: add your site's origin (for GitHub Pages that's `https://YOUR-USERNAME.github.io`, without the repo name).

### 6. Create test users and make yourself admin
1. On your site, sign up: one admin account (as job seeker), two employers, two job seekers. Confirm each email.
2. In the SQL Editor, run `supabase/seed.sql` (change the emails to yours). This promotes your admin and adds a sample job.

### 7. Optional: Turnstile (bot protection)
1. Cloudflare → Turnstile → Add site → copy **site key** and **secret key**.
2. Supabase → Authentication → Attack Protection → enable CAPTCHA → Turnstile → paste the **secret key**.
3. Put the **site key** in `config.js` → `TURNSTILE_SITE_KEY`.

## Run locally
```bash
npx wrangler pages dev site      # http://localhost:8788  (applies _headers too)
# or simply:
cd site && python3 -m http.server 8788
```

## Who can do what (enforced in the database)

| Action | Visitor | Job seeker | Employer | Admin |
|---|---|---|---|---|
| See live jobs | ✅ | ✅ | ✅ | ✅ |
| Apply / upload CV | – | ✅ (live jobs only) | – | – |
| Create company profile | – | – | ✅ (unverified) | ✅ |
| Post jobs | – | – | ✅ first job reviewed, then instant (risky words always reviewed) | ✅ |
| Share a job seen on social media | – | ✅ | ✅ | ✅ |
| Import external jobs | – | – | – | ✅ |
| Email job alerts | – | ✅ (max 5) | – | – |
| Publish (make live) / reject jobs | – | – | – | ✅ |
| See applicants + CVs | – | own only | own jobs only | ✅ |
| Change own role / verify own company | – | ❌ | ❌ | ✅ |

Editing a live job automatically sends it back to review (stops bait-and-switch). Jobs expire after 60 days.

## Going to production
See `docs/LAUNCH-CHECKLIST.md`. In short: create a second Supabase project (Pro plan, backups), run the same migration, point a new Cloudflare Pages project or branch at it, then remove the `noindex` lines from `_headers`, `robots.txt` and every HTML `<head>`.

## Translations
All interface text is in `site/i18n/*.json`. The Burmese and Japanese text is a first draft: **have a native speaker review it** before launch. Legal pages in `site/legal/` are English drafts with TODOs.

## Ideas for later
Paid featured jobs (Stripe Checkout + a Supabase Edge Function webhook), email alerts for new jobs, employer subscriptions, CV search, Facebook/LINE login.
