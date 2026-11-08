# End Time Harvest Sunday Service Topics

A static HTML website backed by Supabase. Viewers can read topics and scripture without an account. Administrators sign in to manage topics, passages, highlights, and notes.

## Deploy to Vercel

1. Commit and push the repository to GitHub.
2. Import the repository into Vercel as a new project.
3. Leave **Root Directory** at the repository root, where `vercel.json` is located.
4. Deploy. The checked-in configuration selects **Other**, skips installation and building, and publishes only **public/**.

If the dashboard already contains manual overrides, use these values:

| Setting | Value |
| --- | --- |
| Framework Preset | Other |
| Root Directory | Repository root |
| Install Command | Empty |
| Build Command | Empty |
| Output Directory | public |

The live public library opens at `/`. The alternate viewer entry is `/viewer.html`; administrators use `/admin.html`. Missing URLs show a custom 404 page. Navigation uses hashes, so no catch-all rewrite is needed.

The public interface does not display an admin login link. Administrators should bookmark `/admin.html`.

No runtime server, package installation, environment variables, or build step is required. `vercel.json` also configures browser security headers and cache revalidation for application updates. Admin pages are marked not to appear in search results; Supabase authentication and database policies enforce editing access.

## Files

```text
public/
  index.html
  viewer.html
  admin.html
  404.html
  robots.txt
  static/             Browser scripts, styles, logo, and bundled KJV
vercel.json           Deployment configuration
supabase_schema.sql   Database setup; not published
```

Open `public/index.html` locally to view the website. Keep the entire `public` directory together. Internet access is required for Supabase; translations other than the bundled KJV load on demand from the [Bible JSON source](https://github.com/thiagobodruk/bible) and retain their respective publishers' licenses.

## Supabase and administrators

The project `fokbrfhqryneszoweapn` is already connected. `public/static/config.js` contains its public URL and publishable key. Database row-level security permits public reads of topics and passages and restricts writes to active administrators. Never place a service-role key, secret key, or administrator password in public files.

The administrator account created during setup remains available. Its password is not stored in this repository. Use **Settings → Change password** to update it. The login address `admin@endtimeharvest.local` is not a mailbox; replace it with an address you own in Supabase Authentication if you need email delivery. If email invitations or password-recovery links are enabled later, configure Supabase's Site URL and allowed redirect URLs for your production domain.

To add another administrator, the project owner creates a user in **Supabase Dashboard → Authentication → Users**, then grants access in the SQL editor:

```sql
update public.profiles set role = 'ADMIN', active = true
where id = (select id from auth.users where email = 'admin@example.com');
```

Set a profile's `active` field to `false` to revoke editing access. **Settings → Download backup** exports topics, passages, notes, and highlights without authentication credentials.

The locally bundled Supabase browser client is version 2.119.0. Its license notices are included in the vendor script. No test suite, mock records, npm manifest, or development dependency is required or included in the deployment.

## Database traffic and live updates

- Home requests only the six latest topic summaries in one query; it does not download verse bodies or run total-count queries.
- Archive search runs in Postgres and returns 25 summaries at a time. Full scripture text is downloaded only when a topic is opened or an admin requests an export.
- Public content is cached in memory and, when available, browser storage for five minutes. Concurrent duplicate reads share one request. The cache is bounded to 30 entries and about 1 MB of stored JSON.
- A small `library_state` row supplies live change notices. One statement produces one notice, including when several verses are saved together. Notices contain IDs, not scripture bodies.
- An open topic fetches only affected verse rows; a reorder fetches IDs and positions only. The viewer updates passage cards without reloading or moving the reader's scroll position.
- Connections pause while the tab is hidden or the Bible reader/settings/forms are open. Reconnecting checks the small revision value to recover changes missed while disconnected. There is no periodic database polling.

`supabase_optimizations.sql` has already been applied to the connected project. For a new database, apply `supabase_schema.sql` first, then `supabase_optimizations.sql`. Both setup files remain outside the published website. RLS still controls every database write; hiding the admin link does not change authentication.

Realtime connections and change messages still use Supabase quota. The design reduces transferred data and repeated queries; it does not make live updates free.
