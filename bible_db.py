import json
import os
import re
import sqlite3
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
BIBLE_DB_PATH = os.environ.get("BIBLE_DB_PATH", str(BASE_DIR / "data" / "bible.db"))

# List of 66 books with OT (1-39) and NT (40-66)
BOOKS = [
    # Old Testament
    {"id": 1, "name": "Genesis", "testament": "OT", "chapters": 50, "abbr": "Gen"},
    {"id": 2, "name": "Exodus", "testament": "OT", "chapters": 40, "abbr": "Exo"},
    {"id": 3, "name": "Leviticus", "testament": "OT", "chapters": 27, "abbr": "Lev"},
    {"id": 4, "name": "Numbers", "testament": "OT", "chapters": 36, "abbr": "Num"},
    {"id": 5, "name": "Deuteronomy", "testament": "OT", "chapters": 34, "abbr": "Deut"},
    {"id": 6, "name": "Joshua", "testament": "OT", "chapters": 24, "abbr": "Josh"},
    {"id": 7, "name": "Judges", "testament": "OT", "chapters": 21, "abbr": "Judg"},
    {"id": 8, "name": "Ruth", "testament": "OT", "chapters": 4, "abbr": "Ruth"},
    {"id": 9, "name": "1 Samuel", "testament": "OT", "chapters": 31, "abbr": "1Sam"},
    {"id": 10, "name": "2 Samuel", "testament": "OT", "chapters": 24, "abbr": "2Sam"},
    {"id": 11, "name": "1 Kings", "testament": "OT", "chapters": 22, "abbr": "1Kgs"},
    {"id": 12, "name": "2 Kings", "testament": "OT", "chapters": 25, "abbr": "2Kgs"},
    {"id": 13, "name": "1 Chronicles", "testament": "OT", "chapters": 29, "abbr": "1Chr"},
    {"id": 14, "name": "2 Chronicles", "testament": "OT", "chapters": 36, "abbr": "2Chr"},
    {"id": 15, "name": "Ezra", "testament": "OT", "chapters": 10, "abbr": "Ezra"},
    {"id": 16, "name": "Nehemiah", "testament": "OT", "chapters": 13, "abbr": "Neh"},
    {"id": 17, "name": "Esther", "testament": "OT", "chapters": 10, "abbr": "Esth"},
    {"id": 18, "name": "Job", "testament": "OT", "chapters": 42, "abbr": "Job"},
    {"id": 19, "name": "Psalms", "testament": "OT", "chapters": 150, "abbr": "Ps"},
    {"id": 20, "name": "Proverbs", "testament": "OT", "chapters": 31, "abbr": "Prov"},
    {"id": 21, "name": "Ecclesiastes", "testament": "OT", "chapters": 12, "abbr": "Eccl"},
    {"id": 22, "name": "Song of Solomon", "testament": "OT", "chapters": 8, "abbr": "Song"},
    {"id": 23, "name": "Isaiah", "testament": "OT", "chapters": 66, "abbr": "Isa"},
    {"id": 24, "name": "Jeremiah", "testament": "OT", "chapters": 52, "abbr": "Jer"},
    {"id": 25, "name": "Lamentations", "testament": "OT", "chapters": 5, "abbr": "Lam"},
    {"id": 26, "name": "Ezekiel", "testament": "OT", "chapters": 48, "abbr": "Ezek"},
    {"id": 27, "name": "Daniel", "testament": "OT", "chapters": 12, "abbr": "Dan"},
    {"id": 28, "name": "Hosea", "testament": "OT", "chapters": 14, "abbr": "Hos"},
    {"id": 29, "name": "Joel", "testament": "OT", "chapters": 3, "abbr": "Joel"},
    {"id": 30, "name": "Amos", "testament": "OT", "chapters": 9, "abbr": "Amos"},
    {"id": 31, "name": "Obadiah", "testament": "OT", "chapters": 1, "abbr": "Obad"},
    {"id": 32, "name": "Jonah", "testament": "OT", "chapters": 4, "abbr": "Jonah"},
    {"id": 33, "name": "Micah", "testament": "OT", "chapters": 7, "abbr": "Mic"},
    {"id": 34, "name": "Nahum", "testament": "OT", "chapters": 3, "abbr": "Nah"},
    {"id": 35, "name": "Habakkuk", "testament": "OT", "chapters": 3, "abbr": "Hab"},
    {"id": 36, "name": "Zephaniah", "testament": "OT", "chapters": 3, "abbr": "Zeph"},
    {"id": 37, "name": "Haggai", "testament": "OT", "chapters": 2, "abbr": "Hag"},
    {"id": 38, "name": "Zechariah", "testament": "OT", "chapters": 14, "abbr": "Zech"},
    {"id": 39, "name": "Malachi", "testament": "OT", "chapters": 4, "abbr": "Mal"},
    # New Testament
    {"id": 40, "name": "Matthew", "testament": "NT", "chapters": 28, "abbr": "Matt"},
    {"id": 41, "name": "Mark", "testament": "NT", "chapters": 16, "abbr": "Mark"},
    {"id": 42, "name": "Luke", "testament": "NT", "chapters": 24, "abbr": "Luke"},
    {"id": 43, "name": "John", "testament": "NT", "chapters": 21, "abbr": "John"},
    {"id": 44, "name": "Acts", "testament": "NT", "chapters": 28, "abbr": "Acts"},
    {"id": 45, "name": "Romans", "testament": "NT", "chapters": 16, "abbr": "Rom"},
    {"id": 46, "name": "1 Corinthians", "testament": "NT", "chapters": 16, "abbr": "1Cor"},
    {"id": 47, "name": "2 Corinthians", "testament": "NT", "chapters": 13, "abbr": "2Cor"},
    {"id": 48, "name": "Galatians", "testament": "NT", "chapters": 6, "abbr": "Gal"},
    {"id": 49, "name": "Ephesians", "testament": "NT", "chapters": 6, "abbr": "Eph"},
    {"id": 50, "name": "Philippians", "testament": "NT", "chapters": 4, "abbr": "Phil"},
    {"id": 51, "name": "Colossians", "testament": "NT", "chapters": 4, "abbr": "Col"},
    {"id": 52, "name": "1 Thessalonians", "testament": "NT", "chapters": 5, "abbr": "1Thess"},
    {"id": 53, "name": "2 Thessalonians", "testament": "NT", "chapters": 3, "abbr": "2Thess"},
    {"id": 54, "name": "1 Timothy", "testament": "NT", "chapters": 6, "abbr": "1Tim"},
    {"id": 55, "name": "2 Timothy", "testament": "NT", "chapters": 4, "abbr": "2Tim"},
    {"id": 56, "name": "Titus", "testament": "NT", "chapters": 3, "abbr": "Titus"},
    {"id": 57, "name": "Philemon", "testament": "NT", "chapters": 1, "abbr": "Phlm"},
    {"id": 58, "name": "Hebrews", "testament": "NT", "chapters": 13, "abbr": "Heb"},
    {"id": 59, "name": "James", "testament": "NT", "chapters": 5, "abbr": "Jas"},
    {"id": 60, "name": "1 Peter", "testament": "NT", "chapters": 5, "abbr": "1Pet"},
    {"id": 61, "name": "2 Peter", "testament": "NT", "chapters": 3, "abbr": "2Pet"},
    {"id": 62, "name": "1 John", "testament": "NT", "chapters": 5, "abbr": "1Jn"},
    {"id": 63, "name": "2 John", "testament": "NT", "chapters": 1, "abbr": "2Jn"},
    {"id": 64, "name": "3 John", "testament": "NT", "chapters": 1, "abbr": "3Jn"},
    {"id": 65, "name": "Jude", "testament": "NT", "chapters": 1, "abbr": "Jude"},
    {"id": 66, "name": "Revelation", "testament": "NT", "chapters": 22, "abbr": "Rev"},
]

BOOK_MAP = {b["name"].lower(): b["name"] for b in BOOKS}
# Add common aliases
ALIASES = {
    "psalm": "Psalms",
    "song of songs": "Song of Solomon",
    "canticles": "Song of Solomon",
    "revelations": "Revelation",
    "1 sam": "1 Samuel",
    "2 sam": "2 Samuel",
    "1 kgs": "1 Kings",
    "2 kgs": "2 Kings",
    "1 chr": "1 Chronicles",
    "2 chr": "2 Chronicles",
    "1 cor": "1 Corinthians",
    "2 cor": "2 Corinthians",
    "1 thess": "1 Thessalonians",
    "2 thess": "2 Thessalonians",
    "1 tim": "1 Timothy",
    "2 tim": "2 Timothy",
    "1 pet": "1 Peter",
    "2 pet": "2 Peter",
    "1 jn": "1 John",
    "2 jn": "2 John",
    "3 jn": "3 John",
}
for k, v in ALIASES.items():
    BOOK_MAP[k] = v

TRANSLATIONS = [
    {"id": "KJV", "name": "King James Version (KJV)", "source": "en_kjv.json", "license": "Public Domain"},
    {"id": "NKJV", "name": "New King James Version (NKJV)", "source": "en_nkjv.json", "license": "Used by permission / Church study"},
    {"id": "NIV", "name": "New International Version (NIV)", "source": "en_niv.json", "license": "Used for study and ministry"},
    {"id": "ESV", "name": "English Standard Version (ESV)", "source": "en_esv.json", "license": "Good News Publishers / Crossway"},
    {"id": "NASB", "name": "New American Standard Bible (NASB)", "source": "en_nasb.json", "license": "The Lockman Foundation"},
    {"id": "AMP", "name": "Amplified Bible (AMP)", "source": "en_amp.json", "license": "The Lockman Foundation"},
    {"id": "NLT", "name": "New Living Translation (NLT)", "source": "en_nlt.json", "license": "Tyndale House Publishers"},
    {"id": "WEB", "name": "World English Bible (WEB)", "source": "en_web.json", "license": "Public Domain"},
    {"id": "BBE", "name": "Bible in Basic English (BBE)", "source": "en_bbe.json", "license": "Public Domain"},
]

TRANSLATION_MAP = {t["id"]: t for t in TRANSLATIONS}


def get_db():
    Path(BIBLE_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(BIBLE_DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    return con


def init_bible_db():
    with get_db() as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("""
        CREATE TABLE IF NOT EXISTS bible_verses (
            translation TEXT NOT NULL,
            book TEXT NOT NULL,
            book_order INTEGER NOT NULL,
            testament TEXT NOT NULL,
            chapter INTEGER NOT NULL,
            verse INTEGER NOT NULL,
            text TEXT NOT NULL,
            PRIMARY KEY (translation, book, chapter, verse)
        )
        """)
        con.execute("CREATE INDEX IF NOT EXISTS idx_bible_lookup ON bible_verses(translation, book, chapter)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_bible_book_order ON bible_verses(book_order, chapter, verse)")
        
        # Check FTS5 table
        fts_exists = con.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='bible_fts'").fetchone()[0]
        if not fts_exists:
            con.execute("CREATE VIRTUAL TABLE bible_fts USING fts5(translation, book, chapter UNINDEXED, verse UNINDEXED, text)")
        con.commit()


def normalize_book(name):
    if not name:
        return None
    cleaned = re.sub(r"[^a-zA-Z0-9 ]", "", name.strip().lower())
    if cleaned in BOOK_MAP:
        return BOOK_MAP[cleaned]
    # Try starts with
    for k, v in BOOK_MAP.items():
        if k.startswith(cleaned):
            return v
    return None


def is_translation_installed(translation_id):
    with get_db() as con:
        count = con.execute("SELECT count(*) FROM bible_verses WHERE translation=?", (translation_id.upper(),)).fetchone()[0]
        return count > 0


def install_translation(translation_id):
    tr = TRANSLATION_MAP.get(translation_id.upper())
    if not tr:
        raise ValueError(f"Unknown translation: {translation_id}")
    
    source_file = tr["source"]
    url = f"https://raw.githubusercontent.com/thiagobodruk/bible/master/json/{source_file}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        raw_bytes = r.read()
        data = json.loads(raw_bytes.decode("utf-8-sig"))
    
    rows = []
    fts_rows = []
    for b_idx, book_obj in enumerate(data, 1):
        bname = BOOKS[b_idx - 1]["name"] if b_idx - 1 < len(BOOKS) else book_obj.get("name")
        testament = "OT" if b_idx <= 39 else "NT"
        for c_idx, ch_verses in enumerate(book_obj.get("chapters", []), 1):
            for v_idx, txt in enumerate(ch_verses, 1):
                clean_text = txt.strip()
                rows.append((tr["id"], bname, b_idx, testament, c_idx, v_idx, clean_text))
                fts_rows.append((tr["id"], bname, c_idx, v_idx, clean_text))
    
    with get_db() as con:
        con.execute("DELETE FROM bible_verses WHERE translation=?", (tr["id"],))
        con.execute("DELETE FROM bible_fts WHERE translation=?", (tr["id"],))
        con.executemany("INSERT INTO bible_verses VALUES (?,?,?,?,?,?,?)", rows)
        con.executemany("INSERT INTO bible_fts VALUES (?,?,?,?,?)", fts_rows)
        con.commit()
    
    return len(rows)


def get_available_translations():
    with get_db() as con:
        rows = con.execute("SELECT DISTINCT translation FROM bible_verses").fetchall()
        installed = {r["translation"] for r in rows}
    
    res = []
    for t in TRANSLATIONS:
        res.append({
            **t,
            "installed": t["id"] in installed
        })
    return res


def get_chapter(translation, book, chapter):
    tr = translation.upper()
    bname = normalize_book(book)
    if not bname:
        return None
    
    with get_db() as con:
        rows = con.execute("""
            SELECT verse, text FROM bible_verses 
            WHERE translation=? AND book=? AND chapter=?
            ORDER BY verse ASC
        """, (tr, bname, int(chapter))).fetchall()
        
        if not rows:
            # Check if translation is installed; if not, try to install it on-demand
            if not is_translation_installed(tr) and tr in TRANSLATION_MAP:
                try:
                    install_translation(tr)
                    return get_chapter(tr, bname, chapter)
                except Exception:
                    pass
            return None
        
        return {
            "translation": tr,
            "book": bname,
            "chapter": int(chapter),
            "verses": [{"verse": r["verse"], "text": r["text"]} for r in rows]
        }


def get_verses_text(translation, book, chapter, verse_list):
    """
    verse_list: list of integers [1, 2, 3] or single int
    returns formatted text and structured verse objects
    """
    tr = translation.upper()
    bname = normalize_book(book)
    if not bname or not verse_list:
        return {"text": "", "verses": []}
    
    if isinstance(verse_list, int):
        verse_list = [verse_list]
    
    with get_db() as con:
        placeholders = ",".join("?" for _ in verse_list)
        rows = con.execute(f"""
            SELECT verse, text FROM bible_verses
            WHERE translation=? AND book=? AND chapter=? AND verse IN ({placeholders})
            ORDER BY verse ASC
        """, [tr, bname, int(chapter)] + [int(v) for v in verse_list]).fetchall()
        
        verses = [{"verse": r["verse"], "text": r["text"]} for r in rows]
        full_text = " ".join(f"[{r['verse']}] {r['text']}" for r in rows)
        return {
            "translation": tr,
            "book": bname,
            "chapter": int(chapter),
            "verses": verses,
            "text": full_text
        }


def search_bible(query, translation="KJV", testament=None, book=None, limit=50):
    tr = translation.upper()
    if not is_translation_installed(tr) and tr in TRANSLATION_MAP:
        try:
            install_translation(tr)
        except Exception:
            pass
    
    clean_q = query.strip()
    if not clean_q:
        return []
    
    # Check if query is a reference like "John 3:16" or "Romans 8:28"
    ref_match = re.match(r"^((?:[123]\s*)?[A-Za-z][A-Za-z ]*?)\s*(\d+)(?:\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$", clean_q)
    if ref_match:
        b_candidate = normalize_book(ref_match.group(1))
        if b_candidate:
            c_num = int(ref_match.group(2))
            v_start = int(ref_match.group(3)) if ref_match.group(3) else None
            v_end = int(ref_match.group(4)) if ref_match.group(4) else v_start
            
            with get_db() as con:
                if v_start and v_end:
                    rows = con.execute("""
                        SELECT book, chapter, verse, text FROM bible_verses
                        WHERE translation=? AND book=? AND chapter=? AND verse BETWEEN ? AND ?
                        ORDER BY verse ASC
                    """, (tr, b_candidate, c_num, v_start, v_end)).fetchall()
                elif v_start:
                    rows = con.execute("""
                        SELECT book, chapter, verse, text FROM bible_verses
                        WHERE translation=? AND book=? AND chapter=? AND verse=?
                    """, (tr, b_candidate, c_num, v_start)).fetchall()
                else:
                    rows = con.execute("""
                        SELECT book, chapter, verse, text FROM bible_verses
                        WHERE translation=? AND book=? AND chapter=?
                        ORDER BY verse ASC LIMIT 10
                    """, (tr, b_candidate, c_num)).fetchall()
                
                return [{
                    "book": r["book"],
                    "chapter": r["chapter"],
                    "verse": r["verse"],
                    "reference": f"{r['book']} {r['chapter']}:{r['verse']}",
                    "text": r["text"],
                    "snippet": f"<b>{r['text']}</b>"
                } for r in rows]
    
    # Prepare FTS query
    # If phrase search with quotes or multiple words
    tokens = [re.sub(r"[^a-zA-Z0-9]", "", w) for w in clean_q.split()]
    tokens = [t for t in tokens if t]
    if not tokens:
        return []
    
    fts_match_expr = " AND ".join(tokens)
    
    sql = """
        SELECT v.book, v.chapter, v.verse, v.text, v.testament,
               snippet(bible_fts, 4, '<mark>', '</mark>', '...', 12) as snippet
        FROM bible_fts f
        JOIN bible_verses v ON v.translation=f.translation AND v.book=f.book AND v.chapter=f.chapter AND v.verse=f.verse
        WHERE f.translation=? AND f.text MATCH ?
    """
    params = [tr, fts_match_expr]
    
    if testament in ("OT", "NT"):
        sql += " AND v.testament=?"
        params.append(testament)
        
    if book:
        bname = normalize_book(book)
        if bname:
            sql += " AND v.book=?"
            params.append(bname)
            
    sql += f" ORDER BY v.book_order ASC, v.chapter ASC, v.verse ASC LIMIT {int(limit)}"
    
    with get_db() as con:
        try:
            rows = con.execute(sql, params).fetchall()
            return [{
                "book": r["book"],
                "chapter": r["chapter"],
                "verse": r["verse"],
                "testament": r["testament"],
                "reference": f"{r['book']} {r['chapter']}:{r['verse']}",
                "text": r["text"],
                "snippet": r["snippet"] or r["text"]
            } for r in rows]
        except Exception:
            # Fallback to LIKE if FTS fails for special syntax
            like_sql = """
                SELECT book, chapter, verse, text, testament
                FROM bible_verses
                WHERE translation=? AND text LIKE ?
            """
            like_params = [tr, f"%{clean_q}%"]
            if testament in ("OT", "NT"):
                like_sql += " AND testament=?"
                like_params.append(testament)
            if book:
                bname = normalize_book(book)
                if bname:
                    like_sql += " AND book=?"
                    like_params.append(bname)
            like_sql += f" ORDER BY book_order ASC, chapter ASC, verse ASC LIMIT {int(limit)}"
            rows = con.execute(like_sql, like_params).fetchall()
            return [{
                "book": r["book"],
                "chapter": r["chapter"],
                "verse": r["verse"],
                "testament": r["testament"],
                "reference": f"{r['book']} {r['chapter']}:{r['verse']}",
                "text": r["text"],
                "snippet": r["text"]
            } for r in rows]
