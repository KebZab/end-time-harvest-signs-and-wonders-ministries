# Sermon Library

End Time Harvest Signs & Wonders Ministries, Inc.

## Open the website

Double-click **index.html** or **viewer.html** to view the public sermon library. Open **admin.html** to sign in and manage sermons.

No Python, Node.js, launcher, terminal command, installation, or build is required to use the website. Keep the `static/` folder beside the HTML files. You can also upload these three HTML files and the entire `static/` folder to any static HTTPS host.

Internet access is required for Supabase. The full 66-book KJV is bundled locally. Other translations load on demand from the existing [Bible JSON source](https://github.com/thiagobodruk/bible); they retain their publishers' licenses.

## Public and admin access

Viewers can read and search sermons, passages, highlights, notes, and the Bible Library without an account. Only `admin.html` restores the admin session and displays editing controls. Supabase row-level security enforces admin-only writes.

The initial admin login is `admin@endtimeharvest.local`. The generated password was provided in the setup conversation and is not stored in the repository. Change it under **Account** after signing in. This is a login identifier, not a mailbox; replace it with an email you own in Supabase Authentication for email recovery.

**Access & backup** downloads sermons and recorded scripture passages as JSON, including notes and highlights. Authentication credentials are never included.

## Supabase

The connected project is `fokbrfhqryneszoweapn`. `static/config.js` contains its URL and public publishable key. Never add a service-role or secret key to the frontend.

`supabase_schema.sql` contains the schema and access policies already applied to the project. It allows public reads, restricts writes to active admins, protects profiles, and provides atomic sermon creation and passage reordering. User-supplied metadata and first signup cannot grant admin access.

To add an admin, the project owner creates a user in **Supabase Dashboard → Authentication → Users**, then grants access through the SQL editor:

```sql
update public.profiles set role = 'ADMIN', active = true
where id = (select id from auth.users where email = 'admin@example.com');
```

Set the profile's `active` field to `false` to revoke editing access.

## Files and optional developer checks

- `index.html` / `viewer.html`: public entry pages.
- `admin.html`: admin sign in and management.
- `static/`: styles, logo, JavaScript, and bundled KJV.
- `static/vendor/supabase.js`: locally bundled Supabase JavaScript client, version 2.119.0.

The optional `package.json`, lockfile, and `tests/` are for development checks only (`npm ci` then `npm test`). They are not needed to open or host the website. There is no start or build command.
