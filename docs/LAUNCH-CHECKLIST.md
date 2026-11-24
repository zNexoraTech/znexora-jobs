# Launch checklist

Order matters: don't skip the gates.

## Build (private)
- [ ] Staging works end to end with dummy accounts (signup → company → job → admin approve → apply → CV download → status change → delete account)
- [ ] `docs/SECURITY-CHECKLIST.md` passed
- [ ] Burmese and Japanese text reviewed by native speakers
- [ ] Terms, Privacy Policy, Posting rules, Seeker guide finished in 3 languages (reviewed by a professional if possible)

## GATE 1 — Company written consent
- [ ] Written consent from your employer saved (clause 11.1, plus 19.3 and IP ownership confirmed)

## Business setup
- [ ] 開業届 submitted
- [ ] Address decided (home or virtual office) — the MHLW list is public
- [ ] Production domain bought, connected to Cloudflare Pages
- [ ] Production Supabase project (Tokyo, **Pro plan**, backups on), migration run, function deployed
- [ ] Supabase Auth Site URL / Redirect URLs set to the production domain
- [ ] Turnstile enabled
- [ ] Custom SMTP for auth emails (Supabase → Auth → SMTP; e.g. Resend) — the built-in sender is rate limited

## GATE 2 — MHLW notification
- [ ] gBizID + e-Gov account
- [ ] 特定募集情報等提供事業届出書 (Form 8-3) filed on e-Gov
- [ ] Acceptance number received → put it in `config.js` (`MHLW_NUMBER`, `OPERATOR_NAME`) and `about.html`

## Go public
- [ ] Remove `X-Robots-Tag` from `site/_headers`
- [ ] Replace `site/robots.txt` with the public version (see comment inside)
- [ ] Remove `<meta name="robots" content="noindex, nofollow">` from every HTML file
- [ ] Remove Cloudflare Access from the production domain
- [ ] 10–20 verified employers with live jobs before announcing
- [ ] Soft launch → fixes → public launch

## Every year
- [ ] By 31 August: 特定募集情報等提供事業概況報告書 (status as of 1 June) on e-Gov
- [ ] Changes to name / address / URL → notify within 30 days
