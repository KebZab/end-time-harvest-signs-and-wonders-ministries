#!/usr/bin/env python3
"""
End Time Harvest Signs & Wonders Ministries, Inc.
Sermon Tracking and Bible Verse Management System

Zero-dependency server (Python 3.9+ standard library only).
Run:  python server.py     then open  http://localhost:8000
"""
import hashlib, hmac, json, mimetypes, os, re, secrets, sqlite3, sys, time, traceback
from contextlib import closing
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import bible_db

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
DB_PATH = os.environ.get("DB_PATH", str(BASE / "data" / "church.db"))
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE") == "1"   # set to 1 when served over HTTPS
SESSION_DAYS = 7

BOOKS = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
         "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra",
         "Nehemiah", "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon",
         "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
         "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah",
         "Malachi", "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians",
         "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians",
         "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon",
         "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude",
         "Revelation"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','VIEWER')),
  pw_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sermons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  pastor TEXT NOT NULL,
  sermon_date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS verses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sermon_id INTEGER NOT NULL REFERENCES sermons(id) ON DELETE CASCADE,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse_start INTEGER,
  verse_end INTEGER,
  note TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  translation TEXT NOT NULL DEFAULT 'KJV',
  verse_text TEXT NOT NULL DEFAULT '',
  highlights TEXT NOT NULL DEFAULT '[]',
  verse_list TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sermons_date ON sermons(sermon_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_verses_sermon ON verses(sermon_id, position);
"""


def db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db():
    with closing(db()) as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript(SCHEMA)
        con.execute("DELETE FROM sessions WHERE expires_at < ?", (now_iso(),))

        # Schema migrations for verses
        cols = {row["name"] for row in con.execute("PRAGMA table_info(verses)").fetchall()}
        if "translation" not in cols:
            con.execute("ALTER TABLE verses ADD COLUMN translation TEXT NOT NULL DEFAULT 'KJV'")
        if "verse_text" not in cols:
            con.execute("ALTER TABLE verses ADD COLUMN verse_text TEXT NOT NULL DEFAULT ''")
        if "highlights" not in cols:
            con.execute("ALTER TABLE verses ADD COLUMN highlights TEXT NOT NULL DEFAULT '[]'")
        if "verse_list" not in cols:
            con.execute("ALTER TABLE verses ADD COLUMN verse_list TEXT NOT NULL DEFAULT ''")
        con.commit()
    bible_db.init_bible_db()


# ---------------------------------------------------------------- security helpers
def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def now_iso():
    return utcnow().strftime("%Y-%m-%d %H:%M:%S")


def hash_password(pw):
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${h.hex()}"


def verify_password(pw, stored):
    try:
        _, salt, h = stored.split("$")
        calc = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1, dklen=32)
        return hmac.compare_digest(calc, bytes.fromhex(h))
    except Exception:
        return False


DUMMY_HASH = hash_password("not-a-real-password")   # keeps login timing similar for unknown users
FAILS = {}                                           # (ip, username) -> [timestamps]


def throttled(key):
    recent = [t for t in FAILS.get(key, []) if time.time() - t < 600]
    FAILS[key] = recent
    return len(recent) >= 5


def tok_hash(t):
    return hashlib.sha256(t.encode()).hexdigest()


class ApiError(Exception):
    def __init__(self, status, msg):
        self.status, self.msg = status, msg


# ---------------------------------------------------------------- validation
def text(body, key, maxlen, required=False, label=None):
    v = str(body.get(key) or "").strip()
    if required and not v:
        raise ApiError(400, f"{label or key} is required.")
    if len(v) > maxlen:
        raise ApiError(400, f"{label or key} must be {maxlen} characters or fewer.")
    return v


def clean_sermon(body):
    title = text(body, "title", 200, True, "Sermon title")
    pastor = text(body, "pastor", 120, True, "Pastor's name")
    date = text(body, "sermon_date", 10, True, "Date")
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise ApiError(400, "Date must be a valid date.")
    return title, pastor, date, text(body, "description", 5000)


def to_int(v, lo, hi, label, required=False):
    if v in (None, ""):
        if required:
            raise ApiError(400, f"{label} is required.")
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise ApiError(400, f"{label} must be a number.")
    if not lo <= n <= hi:
        raise ApiError(400, f"{label} must be between {lo} and {hi}.")
    return n


def clean_verse(d):
    if not isinstance(d, dict):
        raise ApiError(400, "Invalid verse.")
    book_raw = str(d.get("book") or "").strip()
    book = bible_db.normalize_book(book_raw) or book_raw
    if book not in BOOKS and book not in bible_db.BOOK_MAP.values():
        raise ApiError(400, f"'{book_raw}' is not a recognised Bible book.")
    chapter = to_int(d.get("chapter"), 1, 150, "Chapter", True)
    vs = to_int(d.get("verse_start"), 1, 176, "Verse")
    ve = to_int(d.get("verse_end"), 1, 176, "Last verse")
    verse_list_str = str(d.get("verse_list") or "").strip()

    if vs is None and verse_list_str:
        # Extract first verse number from verse_list
        m = re.search(r"\d+", verse_list_str)
        if m:
            vs = int(m.group(0))

    if ve is not None and vs is None:
        raise ApiError(400, "A verse range needs a starting verse.")
    if ve is not None and ve < vs:
        raise ApiError(400, f"In {book} {chapter}, the last verse must come after the first.")
    if ve is not None and ve == vs:
        ve = None

    note = text(d, "note", 5000, label="Note")
    translation = str(d.get("translation") or "KJV").strip().upper()
    verse_text = str(d.get("verse_text") or "").strip()

    hl = d.get("highlights")
    if isinstance(hl, list):
        highlights = json.dumps(hl)
    elif isinstance(hl, str):
        highlights = hl
    else:
        highlights = "[]"

    if not verse_list_str and vs is not None:
        verse_list_str = f"{vs}" + (f"-{ve}" if ve else "")

    # Auto-fetch verse text from bible_db if empty
    if not verse_text:
        vl = []
        if verse_list_str:
            for part in verse_list_str.split(","):
                part = part.strip()
                if "-" in part:
                    s_str, e_str = part.split("-", 1)
                    if s_str.isdigit() and e_str.isdigit():
                        vl.extend(range(int(s_str), int(e_str) + 1))
                elif part.isdigit():
                    vl.append(int(part))
        elif vs is not None:
            vl = list(range(vs, (ve or vs) + 1))
        if vl:
            try:
                fetched = bible_db.get_verses_text(translation, book, chapter, vl)
                verse_text = fetched.get("text", "")
            except Exception:
                pass

    return book, chapter, vs, ve, note, translation, verse_text, highlights, verse_list_str


def fmt_ref(v):
    r = f"{v['book']} {v['chapter']}"
    vlist = v['verse_list'] if 'verse_list' in v.keys() and v['verse_list'] else None
    if vlist:
        r += f":{vlist}"
    elif v["verse_start"]:
        r += f":{v['verse_start']}"
        if v["verse_end"]:
            r += f"-{v['verse_end']}"
    tr = v['translation'] if 'translation' in v.keys() and v['translation'] else 'KJV'
    return f"{r} ({tr})"


def user_dict(r):
    return {k: r[k] for k in ("id", "username", "full_name", "role", "active", "created_at")}


def verse_dict(r):
    d = {k: r[k] for k in ("id", "sermon_id", "book", "chapter", "verse_start", "verse_end", "note", "position")}
    d["translation"] = r["translation"] if "translation" in r.keys() and r["translation"] else "KJV"
    d["verse_text"] = r["verse_text"] if "verse_text" in r.keys() and r["verse_text"] else ""
    try:
        d["highlights"] = json.loads(r["highlights"]) if "highlights" in r.keys() and r["highlights"] else []
    except Exception:
        d["highlights"] = []
    d["verse_list"] = r["verse_list"] if "verse_list" in r.keys() and r["verse_list"] else ""
    d["ref"] = fmt_ref(r)
    return d


# ---------------------------------------------------------------- sermon helpers
def get_sermon(con, sid):
    s = con.execute("SELECT * FROM sermons WHERE id=?", (sid,)).fetchone()
    if not s:
        raise ApiError(404, "Sermon not found.")
    out = {k: s[k] for k in ("id", "title", "pastor", "sermon_date", "description")}
    rows = con.execute("SELECT * FROM verses WHERE sermon_id=? ORDER BY position, id", (sid,)).fetchall()
    out["verses"] = [verse_dict(r) for r in rows]
    out["verse_count"] = len(rows)
    return out


def attach_refs(con, sermons):
    if not sermons:
        return sermons
    ids = [s["id"] for s in sermons]
    rows = con.execute(f"SELECT * FROM verses WHERE sermon_id IN ({','.join('?' * len(ids))}) "
                       "ORDER BY position, id", ids).fetchall()
    by = {}
    for r in rows:
        by.setdefault(r["sermon_id"], []).append(fmt_ref(r))
    for s in sermons:
        s["refs"] = by.get(s["id"], [])
        s["verse_count"] = len(s["refs"])
    return sermons


REF_SQL = ("(v.book||' '||v.chapter||COALESCE(':'||v.verse_start,'')||COALESCE('-'||v.verse_end,'')"
           "||' '||COALESCE(v.translation,'')||' '||COALESCE(v.verse_text,'')||' '||COALESCE(v.note,''))")


def like(t):
    return "%" + t.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def search_clause(q):
    terms = q.split()[:8]
    if not terms:
        return "1=1", []
    per_term, args = [], []
    for t in terms:
        per_term.append("(s.title LIKE ? ESCAPE '\\' OR s.pastor LIKE ? ESCAPE '\\' OR "
                        "s.description LIKE ? ESCAPE '\\' OR s.sermon_date LIKE ? ESCAPE '\\' OR "
                        f"EXISTS (SELECT 1 FROM verses v WHERE v.sermon_id=s.id AND {REF_SQL} LIKE ? ESCAPE '\\'))")
        args += [like(t)] * 5
    phrase = f"EXISTS (SELECT 1 FROM verses v WHERE v.sermon_id=s.id AND {REF_SQL} LIKE ? ESCAPE '\\')"
    return f"({phrase} OR ({' AND '.join(per_term)}))", [like(" ".join(terms))] + args


# ---------------------------------------------------------------- route handlers
def r_me(h, con, user, body, q):
    n = con.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    admin_u = con.execute("SELECT username FROM users WHERE role='ADMIN' AND active=1 ORDER BY id ASC LIMIT 1").fetchone()
    viewer_u = con.execute("SELECT username FROM users WHERE role='VIEWER' AND active=1 ORDER BY id ASC LIMIT 1").fetchone()
    return {
        "user": user_dict(user) if user else None,
        "setup_needed": n == 0,
        "admin_username": admin_u["username"] if admin_u else "KevinZabal",
        "viewer_username": viewer_u["username"] if viewer_u else "member"
    }


def start_session(h, con, uid):
    token = secrets.token_urlsafe(32)
    exp = (utcnow() + timedelta(days=SESSION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    con.execute("INSERT INTO sessions VALUES (?,?,?)", (tok_hash(token), uid, exp))
    h.cookie = (f"sid={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_DAYS * 86400}"
                + ("; Secure" if COOKIE_SECURE else ""))


def make_user(con, body, role):
    username = text(body, "username", 40, True, "Username")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,40}", username):
        raise ApiError(400, "Username must be 3-40 letters, numbers, dots, dashes or underscores.")
    full = text(body, "full_name", 100, True, "Full name")
    pw = str(body.get("password") or "")
    if len(pw) < 8:
        raise ApiError(400, "Password must be at least 8 characters.")
    if con.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
        raise ApiError(409, "That username is already taken.")
    cur = con.execute("INSERT INTO users (username, full_name, role, pw_hash) VALUES (?,?,?,?)",
                      (username, full, role, hash_password(pw)))
    return cur.lastrowid


def r_setup(h, con, user, body, q):
    if con.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
        raise ApiError(403, "Setup is already complete.")
    uid = make_user(con, body, "ADMIN")
    start_session(h, con, uid)
    return {"ok": True}


def r_login(h, con, user, body, q):
    uname = str(body.get("username") or "").strip()
    key = (h.client_address[0], uname.lower())
    if throttled(key):
        raise ApiError(429, "Too many failed attempts. Please wait 10 minutes and try again.")
    row = con.execute("SELECT * FROM users WHERE username=?", (uname,)).fetchone()
    ok = verify_password(str(body.get("password") or ""), row["pw_hash"] if row else DUMMY_HASH)
    if not (row and ok and row["active"]):
        FAILS.setdefault(key, []).append(time.time())
        raise ApiError(401, "Incorrect username or password.")
    FAILS.pop(key, None)
    start_session(h, con, row["id"])
    return {"ok": True}


def r_logout(h, con, user, body, q):
    m = re.search(r"(?:^|;\s*)sid=([^;]+)", h.headers.get("Cookie", ""))
    if m:
        con.execute("DELETE FROM sessions WHERE token_hash=?", (tok_hash(m.group(1)),))
    h.cookie = "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
    return {"ok": True}


def r_change_pw(h, con, user, body, q):
    if not verify_password(str(body.get("current") or ""), user["pw_hash"]):
        raise ApiError(400, "Your current password is incorrect.")
    new = str(body.get("new") or "")
    if len(new) < 8:
        raise ApiError(400, "New password must be at least 8 characters.")
    con.execute("UPDATE users SET pw_hash=? WHERE id=?", (hash_password(new), user["id"]))
    return {"ok": True}


def r_books(h, con, user, body, q):
    return BOOKS


def r_stats(h, con, user, body, q):
    last = con.execute("SELECT id FROM sermons ORDER BY sermon_date DESC, id DESC LIMIT 1").fetchone()
    recent = [dict(r) for r in con.execute(
        "SELECT id, title, pastor, sermon_date FROM sermons ORDER BY sermon_date DESC, id DESC LIMIT 6")]
    return {"latest": get_sermon(con, last["id"]) if last else None,
            "total_sermons": con.execute("SELECT COUNT(*) FROM sermons").fetchone()[0],
            "total_verses": con.execute("SELECT COUNT(*) FROM verses").fetchone()[0],
            "recent": attach_refs(con, recent)}


def r_sermons(h, con, user, body, q):
    where, args = search_clause((q.get("q", [""])[0] or "").strip()[:200])
    rows = con.execute(f"SELECT s.id, s.title, s.pastor, s.sermon_date FROM sermons s WHERE {where} "
                       "ORDER BY s.sermon_date DESC, s.id DESC LIMIT 500", args).fetchall()
    return attach_refs(con, [dict(r) for r in rows])


def r_sermon(h, con, user, body, q, sid):
    return get_sermon(con, int(sid))


def insert_verses(con, sid, verses):
    pos = con.execute("SELECT COALESCE(MAX(position),0) FROM verses WHERE sermon_id=?", (sid,)).fetchone()[0]
    for v in verses:
        pos += 1
        b, ch, vs, ve, note, tr, txt, hl, vlist = clean_verse(v)
        con.execute("INSERT INTO verses (sermon_id, book, chapter, verse_start, verse_end, note, position, "
                    "translation, verse_text, highlights, verse_list) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (sid, b, ch, vs, ve, note, pos, tr, txt, hl, vlist))


def verse_list(body):
    vs = body.get("verses") or []
    if not isinstance(vs, list) or len(vs) > 200:
        raise ApiError(400, "Invalid verse list.")
    return [clean_verse(v) and v for v in vs]   # validate everything before writing anything


def r_sermon_create(h, con, user, body, q):
    t, p, d, desc = clean_sermon(body)
    vs = verse_list(body)
    cur = con.execute("INSERT INTO sermons (title, pastor, sermon_date, description) VALUES (?,?,?,?)",
                      (t, p, d, desc))
    insert_verses(con, cur.lastrowid, vs)
    return get_sermon(con, cur.lastrowid)


def r_sermon_update(h, con, user, body, q, sid):
    get_sermon(con, int(sid))
    t, p, d, desc = clean_sermon(body)
    con.execute("UPDATE sermons SET title=?, pastor=?, sermon_date=?, description=?, "
                "updated_at=CURRENT_TIMESTAMP WHERE id=?", (t, p, d, desc, int(sid)))
    return get_sermon(con, int(sid))


def r_sermon_delete(h, con, user, body, q, sid):
    get_sermon(con, int(sid))
    con.execute("DELETE FROM sermons WHERE id=?", (int(sid),))
    return {"ok": True}


def r_verses_add(h, con, user, body, q, sid):
    get_sermon(con, int(sid))
    vs = verse_list(body)
    insert_verses(con, int(sid), vs)
    return get_sermon(con, int(sid))


def r_verse_update(h, con, user, body, q, vid):
    row = con.execute("SELECT sermon_id FROM verses WHERE id=?", (int(vid),)).fetchone()
    if not row:
        raise ApiError(404, "Verse not found.")
    b, ch, vs, ve, note, tr, txt, hl, vlist = clean_verse(body)
    con.execute("UPDATE verses SET book=?, chapter=?, verse_start=?, verse_end=?, note=?, "
                "translation=?, verse_text=?, highlights=?, verse_list=? WHERE id=?",
                (b, ch, vs, ve, note, tr, txt, hl, vlist, int(vid)))
    return get_sermon(con, row["sermon_id"])


def r_verse_delete(h, con, user, body, q, vid):
    row = con.execute("SELECT sermon_id FROM verses WHERE id=?", (int(vid),)).fetchone()
    if not row:
        raise ApiError(404, "Verse not found.")
    con.execute("DELETE FROM verses WHERE id=?", (int(vid),))
    return get_sermon(con, row["sermon_id"])


def r_sermon_reorder_verses(h, con, user, body, q, sid):
    get_sermon(con, int(sid))
    order = body.get("order") or []
    if not isinstance(order, list):
        raise ApiError(400, "Invalid order list.")
    for pos, vid in enumerate(order, 1):
        con.execute("UPDATE verses SET position=? WHERE id=? AND sermon_id=?", (pos, int(vid), int(sid)))
    return get_sermon(con, int(sid))


def r_bible_books(h, con, user, body, q):
    return bible_db.BOOKS


def r_bible_translations(h, con, user, body, q):
    return bible_db.get_available_translations()


def r_bible_chapter(h, con, user, body, q):
    tr = q.get("translation", ["KJV"])[0]
    book = q.get("book", ["Genesis"])[0]
    chapter = q.get("chapter", ["1"])[0]
    data = bible_db.get_chapter(tr, book, chapter)
    if not data:
        raise ApiError(404, f"Passage not found for {book} {chapter} in {tr}.")
    return data


def r_bible_search(h, con, user, body, q):
    query = (q.get("q", [""])[0] or "").strip()
    tr = q.get("translation", ["KJV"])[0]
    testament = q.get("testament", [None])[0]
    book = q.get("book", [None])[0]
    limit = int(q.get("limit", [50])[0])
    return bible_db.search_bible(query, tr, testament, book, limit)


def r_bible_verses(h, con, user, body, q):
    tr = q.get("translation", ["KJV"])[0]
    book = q.get("book", ["John"])[0]
    chapter = q.get("chapter", ["3"])[0]
    v_raw = q.get("verses", [""])[0]
    v_list = []
    for part in v_raw.split(","):
        part = part.strip()
        if "-" in part:
            s_str, e_str = part.split("-", 1)
            if s_str.isdigit() and e_str.isdigit():
                v_list.extend(range(int(s_str), int(e_str) + 1))
        elif part.isdigit():
            v_list.append(int(part))
    return bible_db.get_verses_text(tr, book, chapter, v_list)


def r_users(h, con, user, body, q):
    return [user_dict(r) for r in con.execute("SELECT * FROM users ORDER BY role, full_name COLLATE NOCASE")]


def r_user_create(h, con, user, body, q):
    role = "ADMIN" if body.get("role") == "ADMIN" else "VIEWER"
    return user_dict(con.execute("SELECT * FROM users WHERE id=?", (make_user(con, body, role),)).fetchone())


def r_user_update(h, con, user, body, q, uid):
    uid = int(uid)
    row = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        raise ApiError(404, "User not found.")
    if uid == user["id"] and ("active" in body or "role" in body):
        raise ApiError(400, "You cannot change your own role or deactivate yourself.")
    if "full_name" in body:
        con.execute("UPDATE users SET full_name=? WHERE id=?", (text(body, "full_name", 100, True, "Full name"), uid))
    if "role" in body and body["role"] in ("ADMIN", "VIEWER"):
        con.execute("UPDATE users SET role=? WHERE id=?", (body["role"], uid))
    if "active" in body:
        con.execute("UPDATE users SET active=? WHERE id=?", (1 if body["active"] else 0, uid))
        if not body["active"]:
            con.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
    if body.get("password"):
        if len(str(body["password"])) < 8:
            raise ApiError(400, "Password must be at least 8 characters.")
        con.execute("UPDATE users SET pw_hash=? WHERE id=?", (hash_password(str(body["password"])), uid))
        con.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
    return user_dict(con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone())


def r_user_delete(h, con, user, body, q, uid):
    if int(uid) == user["id"]:
        raise ApiError(400, "You cannot delete your own account.")
    con.execute("DELETE FROM users WHERE id=?", (int(uid),))
    return {"ok": True}


def r_export(h, con, user, body, q):
    data = {"church": "End Time Harvest Signs & Wonders Ministries, Inc.",
            "exported_at": now_iso() + " UTC",
            "sermons": [get_sermon(con, r["id"]) for r in
                        con.execute("SELECT id FROM sermons ORDER BY sermon_date DESC, id DESC")]}
    name = f"sermon-backup-{utcnow():%Y-%m-%d}.json"
    return 200, data, {"Content-Disposition": f'attachment; filename="{name}"'}


ID = r"(\d+)"
ROUTES = [  # (method, path regex, handler, access)  access: None=public, "ANY"=signed in, "ADMIN"
    ("GET", r"/api/me", r_me, None),
    ("POST", r"/api/setup", r_setup, None),
    ("POST", r"/api/login", r_login, None),
    ("POST", r"/api/logout", r_logout, None),
    ("POST", r"/api/account/password", r_change_pw, "ANY"),
    ("GET", r"/api/books", r_books, "ANY"),
    ("GET", r"/api/stats", r_stats, "ANY"),
    ("GET", r"/api/sermons", r_sermons, "ANY"),
    ("GET", rf"/api/sermons/{ID}", r_sermon, "ANY"),
    ("POST", r"/api/sermons", r_sermon_create, "ADMIN"),
    ("PUT", rf"/api/sermons/{ID}", r_sermon_update, "ADMIN"),
    ("DELETE", rf"/api/sermons/{ID}", r_sermon_delete, "ADMIN"),
    ("POST", rf"/api/sermons/{ID}/verses", r_verses_add, "ADMIN"),
    ("POST", rf"/api/sermons/{ID}/reorder-verses", r_sermon_reorder_verses, "ADMIN"),
    ("PUT", rf"/api/verses/{ID}", r_verse_update, "ADMIN"),
    ("DELETE", rf"/api/verses/{ID}", r_verse_delete, "ADMIN"),
    ("GET", r"/api/bible/books", r_bible_books, None),
    ("GET", r"/api/bible/translations", r_bible_translations, None),
    ("GET", r"/api/bible/chapter", r_bible_chapter, None),
    ("GET", r"/api/bible/search", r_bible_search, None),
    ("GET", r"/api/bible/verses", r_bible_verses, None),
    ("GET", r"/api/users", r_users, "ADMIN"),
    ("POST", r"/api/users", r_user_create, "ADMIN"),
    ("PUT", rf"/api/users/{ID}", r_user_update, "ADMIN"),
    ("DELETE", rf"/api/users/{ID}", r_user_delete, "ADMIN"),
    ("GET", r"/api/export", r_export, "ADMIN"),
]
ROUTES = [(m, re.compile(p), f, a) for m, p, f, a in ROUTES]

SEC_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                               "script-src 'self'; connect-src 'self' https://bible-api.com; "
                               "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "SermonTracker"
    cookie = None

    def log_message(self, fmt, *args):
        pass

    def send(self, status, payload, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
        for k, v in {**SEC_HEADERS, **(extra or {})}.items():
            self.send_header(k, v)
        if self.cookie:
            self.send_header("Set-Cookie", self.cookie)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def send_json(self, status, data, extra=None):
        self.send(status, json.dumps(data).encode(), "application/json; charset=utf-8",
                  {"Cache-Control": "no-store", **(extra or {})})

    def do_OPTIONS(self):
        self.send_response(204)
        origin = self.headers.get("Origin", "*")
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, Cookie")
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self): self.dispatch()
    def do_HEAD(self): self.dispatch()
    def do_POST(self): self.dispatch()
    def do_PUT(self): self.dispatch()
    def do_DELETE(self): self.dispatch()

    def dispatch(self):
        u = urlparse(self.path)
        try:
            if u.path.startswith("/api/"):
                self.api(u)
            elif self.command in ("GET", "HEAD"):
                self.static(u.path)
            else:
                raise ApiError(405, "Method not allowed.")
        except ApiError as e:
            self.send_json(e.status, {"error": e.msg})
        except Exception:
            traceback.print_exc()
            self.send_json(500, {"error": "Something went wrong on the server. Please try again."})

    def current_user(self, con):
        m = re.search(r"(?:^|;\s*)sid=([^;]+)", self.headers.get("Cookie", ""))
        if not m:
            return None
        return con.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id "
                           "WHERE s.token_hash=? AND s.expires_at>? AND u.active=1",
                           (tok_hash(m.group(1)), now_iso())).fetchone()

    def api(self, u):
        match = None
        allowed = set()
        for method, rx, fn, access in ROUTES:
            m = rx.fullmatch(u.path)
            if m:
                allowed.add(method)
                if method == self.command:
                    match = (m, fn, access)
        if not match:
            raise ApiError(405 if allowed else 404, "Not found.")
        m, fn, access = match
        body = {}
        if self.command in ("POST", "PUT", "DELETE"):
            if not self.headers.get("Content-Type", "").startswith("application/json"):
                raise ApiError(415, "Requests must be JSON.")
            n = int(self.headers.get("Content-Length") or 0)
            if n > 500_000:
                raise ApiError(413, "Request too large.")
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                raise ApiError(400, "Invalid JSON.")
            if not isinstance(body, dict):
                raise ApiError(400, "Invalid request.")
        with closing(db()) as con:
            user = self.current_user(con)
            if access and not user:
                raise ApiError(401, "Please sign in.")
            if access == "ADMIN" and user["role"] != "ADMIN":
                raise ApiError(403, "Only administrators can do this.")
            res = fn(self, con, user, body, parse_qs(u.query), *m.groups())
            con.commit()
        if isinstance(res, tuple):
            self.send_json(res[0], res[1], res[2])
        else:
            self.send_json(200, res)

    def static(self, path):
        rel = "index.html" if path == "/" else path[len("/static/"):] if path.startswith("/static/") else None
        f = (STATIC / rel).resolve() if rel else None
        if not f or STATIC not in f.parents or not f.is_file():
            raise ApiError(404, "Page not found.")
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        cache = "max-age=86400" if f.suffix == ".png" else "no-cache"
        self.send(200, f.read_bytes(), ctype + ("; charset=utf-8" if ctype.startswith("text/") or "javascript" in ctype else ""),
                  {"Cache-Control": cache})


def safe_print(*args, **kwargs):
    if sys.stdout is not None:
        try:
            print(*args, **kwargs)
        except Exception:
            pass


def main():
    init_db()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    safe_print("\n  End Time Harvest Signs & Wonders Ministries, Inc.")
    safe_print("  Sermon Tracking and Bible Verse Management System\n")
    safe_print(f"  Open in your browser:  http://localhost:{PORT}")
    safe_print(f"  Database file:         {DB_PATH}")
    safe_print("  Press Ctrl+C to stop.\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        safe_print("\n  Stopped.")


if __name__ == "__main__":
    main()
