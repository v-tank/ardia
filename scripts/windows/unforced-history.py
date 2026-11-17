import os
import sqlite3
import sys
import time


def webkit(unix_seconds):
    return int((unix_seconds + 11644473600) * 1_000_000)


def main():
    path = sys.argv[1]
    count = int(sys.argv[2])
    days = int(sys.argv[3])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
        CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT,url LONGVARCHAR,title LONGVARCHAR,
          visit_count INTEGER DEFAULT 0 NOT NULL,typed_count INTEGER DEFAULT 0 NOT NULL,
          last_visit_time INTEGER NOT NULL,hidden INTEGER DEFAULT 0 NOT NULL);
        CREATE TABLE visits(id INTEGER PRIMARY KEY AUTOINCREMENT,url INTEGER NOT NULL,visit_time INTEGER NOT NULL,
          from_visit INTEGER,external_referrer_url TEXT,transition INTEGER DEFAULT 0 NOT NULL,segment_id INTEGER,
          visit_duration INTEGER DEFAULT 0 NOT NULL,incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
          opener_visit INTEGER,originator_cache_guid TEXT,originator_visit_id INTEGER,originator_from_visit INTEGER,
          originator_opener_visit INTEGER,is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,
          consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,visited_link_id INTEGER DEFAULT 0 NOT NULL,
          app_id TEXT);
        CREATE INDEX urls_url_index ON urls (url);
        INSERT INTO meta VALUES ('version', '70');
    """)
    now = time.time()
    span = days * 86400
    for index in range(count):
        when = webkit(now - 60 - span * index / count)
        site = index % 4000
        cursor = db.execute(
            "INSERT INTO urls(url,title,visit_count,typed_count,last_visit_time,hidden) VALUES (?,?,?,?,?,0)",
            (f"https://site{site}.example/articles/{index}", f"Article {index} on site {site}", 1 + index % 7, 1 if index % 3 == 0 else 0, when),
        )
        db.execute("INSERT INTO visits(url,visit_time,transition) VALUES (?,?,1)", (cursor.lastrowid, when))
    db.commit()
    db.close()
    print(f"{count} history pages over {days} days in {path} ({os.path.getsize(path)} bytes)")


main()
