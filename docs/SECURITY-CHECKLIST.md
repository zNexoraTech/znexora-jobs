# Security checklist (pentest before real users)

Test with 5 accounts: admin, employer A, employer B, seeker 1, seeker 2, plus logged out.
Use the browser DevTools console or curl against `https://<ref>.supabase.co/rest/v1/...` with each user's JWT.

## Database / RLS
- [ ] RLS is enabled on every table (Supabase → Database → Tables shows "RLS enabled").
- [ ] Logged out: can read only live jobs and employer `id, company_name, website, description`. Cannot read `phone`, `address`, `corporate_number`, profiles, applications, reports.
- [ ] Seeker cannot `update profiles set role='admin'` (role stays the same).
- [ ] Employer cannot set `verified=true` on own company.
- [ ] Employer cannot insert or update a job to `status='live'` or `'rejected'`.
- [ ] Employer A cannot read, update or delete Employer B's jobs or applications (change IDs → IDOR test).
- [ ] Employer cannot change an application's `message` or `cv_path` (only `status`).
- [ ] Seeker cannot apply to a pending/closed job, or apply twice.
- [ ] Seeker cannot set `status='hired'` on own application.
- [ ] Seeker cannot submit `cv_path` pointing at another user's folder.
- [ ] Seeker profile hidden from employers when "Share my profile" is off.
- [ ] Report `reporter_id` can't be spoofed.

## Storage
- [ ] `cvs` bucket is private; public URL returns 400/404.
- [ ] Seeker can't upload into another user's folder; non-PDF and >5 MB rejected.
- [ ] Employer B can't create a signed URL for an applicant CV of Employer A's job.

## Frontend
- [ ] Stored XSS: put `<img src=x onerror=alert(1)>` and `"><script>` in every text field (job title, description, company, message, skills) in all three languages → shows as plain text.
- [ ] Website field with `javascript:alert(1)` is not rendered as a link.
- [ ] Open redirect: `/login.html?next=//evil.com` stays on site.
- [ ] CSP header present (check with securityheaders.com); no inline scripts.
- [ ] Account enumeration: password reset message is the same for unknown emails.

## Platform
- [ ] `service_role` key not in the repo (GitHub secret scanning on).
- [ ] Supabase Auth: email confirmation on, password min 10, rate limits on, CAPTCHA on for production.
- [ ] MFA (TOTP) on your Supabase, Cloudflare, GitHub and admin accounts.
- [ ] Dependabot alerts on.
- [ ] Supabase Pro backups on; one restore tested.
- [ ] Breach response plan written (who to notify: affected users, Personal Information Protection Commission).
