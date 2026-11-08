# Sermon Tracking and Bible Verse Management System
**End Time Harvest Signs & Wonders Ministries, Inc.**

Records every sermon and every Bible verse the pastor mentions. Has an **Admin / Lead panel** (full control) and a
**Viewer panel** (read only). Data is stored permanently in a database file.

## Start it (no installation of extra software)
You only need **Python 3.9 or newer** (https://www.python.org/downloads/).

- **Windows:** double-click `start.bat`
- **Mac / Linux:** run `./start.sh` (or `python3 server.py`)

Then open **http://localhost:8000** in a browser.
To let phones and other computers on the same Wi-Fi use it, open `http://<this-computer's-IP>:8000`.

## First-time setup
The first time you open the page it asks you to **create the administrator account**. After that, sign in and use
**Members and access** to add viewers (church members) and more admins. Nobody can use the system without an account.

## What each role can do
| | Admin / Lead | Viewer |
|---|---|---|
| See latest sermon, archive, verses, search | Yes | Yes |
| Read full text of passages & highlighted sentences | Yes | Yes |
| Browse & search the 66-book Digital Bible Library | Yes | Yes |
| Select multiple verses, stages & translations | Yes | No |
| Highlight sentences/phrases & choose colors | Yes | No |
| Create, edit, delete & reorder sermons & verses | Yes | No |
| Add, reset, deactivate, delete members | Yes | No |
| Download a backup | Yes | No |

The server enforces this on every request, so a viewer cannot change anything even by trying.

## Built-in Digital Bible Library & Highlighting
The system includes an offline digital Bible containing all **66 books** (Old Testament and New Testament) and supports **9 translations**:
- **KJV** (King James Version)
- **NKJV** (New King James Version)
- **NIV** (New International Version)
- **ESV** (English Standard Version)
- **NASB** (New American Standard Bible)
- **AMP** (Amplified Bible)
- **NLT** (New Living Translation)
- **WEB** (World English Bible)
- **BBE** (Bible in Basic English)

### Multiple Verse Selection & Staging:
1. Open any sermon record and click **"Add Bible Verse"**.
2. Select book, chapter, and click verses or click **Range...** to select multiple verses.
3. Select text with your cursor and click a highlight color (🟡 Yellow, 🟢 Green, 🔵 Blue, 🟣 Pink, 🟠 Orange) to emphasize phrases.
4. Add an optional pastor's note.
5. Click **"Stage This Passage"** to keep browsing other books/chapters and stage more passages.
6. Click **"Save to Sermon Notes"** when finished.

### Interactive Reordering & Editing:
- In the sermon notes, admins can reorder passages up or down (`▲` / `▼`) to match the order the pastor preached them.
- Click **Edit / Highlight** on any passage to switch translations, change highlighted text, or edit pastor notes.
- Viewers see complete verse texts, translations, vivid highlights, and notes displayed directly on the sermon page.

## Your logo
`static/logo.png` is the church logo. To change it, replace that file (keep the name).

## Backups (important)
All records live in **`data/church.db`**. Copy that file somewhere safe regularly (a USB drive or cloud folder).
Admins can also press **Download backup** on the *Members and access* page for a readable JSON copy.

## Putting it online
- Run it on a small server (or any always-on PC) and put it behind HTTPS (Caddy or nginx are easy choices).
- When using HTTPS, start with `COOKIE_SECURE=1` so sign-in cookies are only sent securely.
- Settings (environment variables): `PORT` (default 8000), `HOST` (default 0.0.0.0), `DB_PATH`, `COOKIE_SECURE`.

## Security built in
Passwords are stored as salted scrypt hashes, never in plain text. Sessions use random tokens in HttpOnly,
SameSite=Strict cookies and expire after 7 days. Five wrong passwords lock that username/device for 10 minutes.
All database queries are parameterised, all page content is escaped, and security headers are set.

## Folder contents
    server.py          the server, database and API
    static/            the web pages (index.html, app.css, app.js, logo.png)
    data/church.db     created automatically on first run: your records
    start.bat / start.sh
