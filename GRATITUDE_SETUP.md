# Gratitude Wall activation

This update is prepared for The Gathering Place website and its installed PWA. GitHub write access is now available. The update is on codex/gratitude-wall; the live site is unchanged. Supabase project ucudchsbuzfvbnntrdto is active, the schema and photo bucket are installed, and the public frontend configuration is filled in. Do not publish until email setup and the remaining live checks pass.

## Connect

1. DONE: created The Gathering Place Gratitude in The gathering place organization.
2. DONE: applied create_gratitude_wall migration. Do not rerun gratitude-setup.sql in this project.
3. In Authentication email templates, set the Magic Link template to display `{{ .Token }}` (an email code), instead of requiring a link. Enable email signups. Configure production SMTP: Supabase's default mail service is restricted and is not sufficient for a public community. Set sensible authentication rate limits.
4. Set the site's actual deployed URL in Authentication URL Configuration. This implementation uses codes so visitors can complete sign-in inside the installed app.
5. DONE: gratitude-config.js contains the project URL and PUBLIC publishable key. Never add a secret or service_role key. Database policies protect writes; the public key is intentionally browser-readable.
6. Have the site owner sign in once. Add her verified `auth.users.id` to `public.gratitude_admins` using the SQL editor. Do not grant admin via editable user metadata. The owner can delete any post/comment on the wall. Review reports in the Supabase Table Editor (`gratitude_reports`); reports are not public.

## Required live checks before merge

- Signed out: read posts/comments/photos; direct REST inserts and storage uploads must fail.
- Sign in with a real delivered code in browser and installed iPhone app. Sign out and confirm the composer disappears.
- Post text-only, photo-only and combined entries. Check on a second device without signing in.
- Confirm unsupported or >5 MB uploads fail, including direct storage requests.
- With a second account, attempt to spoof another user's ID, delete their post/comment/photo, read reports, update posts, and add yourself as admin: all must fail.
- Owner account can delete another user's post/comment. Deleted photos are removed from storage when removal succeeds; already issued image URLs can remain valid for up to five minutes.
- Submit and review a report; confirm reports do not appear publicly. Verify keyboard and mobile layouts.
- Test failed network requests, expired sign-in codes, and refreshing the feed. No submission should show success unless the server accepted it.

## Operational notes

- The daily question remains “What are you grateful for today?” A supporting prompt rotates by the visitor's local date and updates while the page is open. No notification subscription or automated email reminders are included.
- Posts/comments render as text, not HTML. Public rows include display names and user UUIDs, never email addresses. Do not use email addresses as display names.
- Photos use a private bucket with publicly readable posted objects via five-minute signed URLs. They are publicly viewable content, not private shares. Refresh renews image links.
- Posts and comments are not cached by the service worker. Online access is required. The wall has no offline posting queue.
- Failed post inserts attempt upload cleanup. Review orphaned uploads periodically, especially after account deletion or failed cleanup. Burst limits are per account; monitor storage use and abuse. Account deletion and any uploaded media cleanup are handled by the owner through Supabase.
- Feed loads 20 posts at a time. Each post shows up to 50 recent comments. There are no simulated posts or fake sign-ins.
- No end-to-end backend test has run until a real project and email delivery are connected. Frontend checks do not establish that database policies or email delivery work in production.

Documentation: https://supabase.com/docs/guides/auth/auth-email-passwordless and https://supabase.com/docs/guides/storage/security/access-control

## Verification completed
JavaScript syntax passes. SQL transaction tested authenticated posting, rejection of spoofed user IDs, cross-account deletion denial, and non-admin status; all temporary data rolled back. Permission checks verified public read access with no public write/report access or member self-promotion. Security advisor returned no warnings or errors; its sole informational finding is the intentionally inaccessible admin table (RLS enabled, no client policies). See https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy. Browser visual checks could not run because a browser binary is unavailable. Email delivery, real-device auth, image uploads and full live tests remain pending.
