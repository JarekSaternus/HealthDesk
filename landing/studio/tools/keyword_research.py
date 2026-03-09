#!/usr/bin/env python3
"""
HealthDesk Keyword Research Pipeline
Google Suggest API scraper with multi-language support, scoring, and CSV/JSON export.

Usage:
  python keyword_research.py --lang PL --output csv
  python keyword_research.py --lang ALL --output json
  python keyword_research.py --lang EN,DE,PL --min-score 3
  python keyword_research.py --lang ALL --cluster back-pain --output both
"""

import argparse
import asyncio
import csv
import json
import logging
import random
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

try:
    import httpx
except ImportError:
    print("ERROR: httpx required. Install: pip install httpx")
    sys.exit(1)

# ─── Logging ───

LOG_FILE = Path(__file__).parent / "keyword_research.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("kw-research")

# ─── User-Agent rotation ───

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
]

# ─── Language config ───

LANGUAGE_CONFIG = {
    "PL": {
        "lang_code": "pl",
        "country_code": "pl",
        "question_prefixes": ["jak", "co", "dlaczego", "ile", "kiedy", "czy", "co robić", "jak uniknąć"],
        "high_intent_words": ["aplikacja", "app", "ćwiczenia", "jak", "co robić", "przerwa", "przypomnienie", "poradnik", "leczenie", "sposób"],
        "seed_keywords": {
            "back-pain": ["ból pleców praca", "kark biurko", "kręgosłup siedzenie", "przerwa komputer", "ból pleców od siedzenia"],
            "eye-strain": ["zmęczone oczy komputer", "suche oczy ekran", "ćwiczenia oczu praca"],
            "ergonomics": ["ergonomia biurka", "prawidłowa pozycja przy biurku", "ergonomiczne stanowisko pracy"],
        },
    },
    "EN": {
        "lang_code": "en",
        "country_code": "us",
        "question_prefixes": ["how", "what", "why", "when", "can", "does", "how to", "best way to"],
        "high_intent_words": ["app", "exercise", "how", "what to do", "break", "reminder", "guide", "tips", "fix", "prevent"],
        "seed_keywords": {
            "back-pain": ["back pain desk job", "neck pain computer", "sitting all day back", "desk break reminder", "lower back pain office"],
            "eye-strain": ["eye strain computer screen", "dry eyes office work", "20-20-20 rule eyes"],
            "ergonomics": ["ergonomic desk setup", "correct posture at desk", "standing desk benefits"],
        },
    },
    "DE": {
        "lang_code": "de",
        "country_code": "de",
        "question_prefixes": ["wie", "was", "warum", "wann", "kann", "wie kann man", "was hilft gegen"],
        "high_intent_words": ["App", "Übungen", "wie", "was tun", "Pause", "Erinnerung", "Tipps", "Anleitung", "Hilfe"],
        "seed_keywords": {
            "back-pain": ["Rückenschmerzen Homeoffice", "Nackenschmerzen Computer", "Pause Erinnerung App", "Rücken Büro Übungen"],
            "eye-strain": ["Augen Bildschirmarbeit", "trockene Augen Computer", "Augenübungen Büro"],
            "ergonomics": ["ergonomischer Arbeitsplatz", "richtige Sitzhaltung Büro", "Stehschreibtisch Vorteile"],
        },
    },
    "ES": {
        "lang_code": "es",
        "country_code": "es",
        "question_prefixes": ["cómo", "qué", "por qué", "cuándo", "puede", "cómo evitar", "qué hacer"],
        "high_intent_words": ["aplicación", "app", "ejercicios", "cómo", "qué hacer", "descanso", "recordatorio", "guía", "consejos"],
        "seed_keywords": {
            "back-pain": ["dolor espalda oficina", "dolor cuello ordenador", "descanso trabajo sedentario", "ejercicios espalda oficina"],
            "eye-strain": ["fatiga visual pantalla", "ojos secos ordenador", "ejercicios ojos trabajo"],
            "ergonomics": ["ergonomía escritorio", "postura correcta oficina", "escritorio de pie beneficios"],
        },
    },
    "FR": {
        "lang_code": "fr",
        "country_code": "fr",
        "question_prefixes": ["comment", "quoi", "pourquoi", "quand", "est-ce que", "comment éviter", "que faire"],
        "high_intent_words": ["application", "app", "exercices", "comment", "que faire", "pause", "rappel", "guide", "conseils"],
        "seed_keywords": {
            "back-pain": ["mal de dos bureau", "douleur nuque ordinateur", "pause travail sédentaire", "exercices dos bureau"],
            "eye-strain": ["fatigue oculaire écran", "yeux secs ordinateur", "exercices yeux travail"],
            "ergonomics": ["ergonomie bureau", "bonne posture bureau", "bureau debout avantages"],
        },
    },
    "IT": {
        "lang_code": "it",
        "country_code": "it",
        "question_prefixes": ["come", "cosa", "perché", "quando", "si può", "come evitare", "cosa fare"],
        "high_intent_words": ["applicazione", "app", "esercizi", "come", "cosa fare", "pausa", "promemoria", "guida", "consigli"],
        "seed_keywords": {
            "back-pain": ["mal di schiena ufficio", "dolore collo computer", "pausa lavoro sedentario", "esercizi schiena ufficio"],
            "eye-strain": ["affaticamento occhi schermo", "occhi secchi computer", "esercizi occhi lavoro"],
            "ergonomics": ["ergonomia scrivania", "postura corretta ufficio", "scrivania in piedi vantaggi"],
        },
    },
    "PT-BR": {
        "lang_code": "pt",
        "country_code": "br",
        "question_prefixes": ["como", "o que", "por que", "quando", "pode", "como evitar", "o que fazer"],
        "high_intent_words": ["aplicativo", "app", "exercícios", "como", "o que fazer", "pausa", "lembrete", "guia", "dicas"],
        "seed_keywords": {
            "back-pain": ["dor nas costas escritório", "dor no pescoço computador", "pausa trabalho sedentário", "exercícios costas escritório"],
            "eye-strain": ["cansaço visual tela", "olhos secos computador", "exercícios olhos trabalho"],
            "ergonomics": ["ergonomia mesa trabalho", "postura correta escritório", "mesa em pé benefícios"],
        },
    },
    "RU": {
        "lang_code": "ru",
        "country_code": "ru",
        "question_prefixes": ["как", "что", "почему", "когда", "можно ли", "как избежать", "что делать"],
        "high_intent_words": ["приложение", "упражнения", "как", "что делать", "перерыв", "напоминание", "советы", "гимнастика"],
        "seed_keywords": {
            "back-pain": ["боль в спине офис", "боль в шее компьютер", "перерыв сидячая работа", "упражнения спина офис"],
            "eye-strain": ["усталость глаз экран", "сухость глаз компьютер", "гимнастика для глаз работа"],
            "ergonomics": ["эргономика рабочего места", "правильная осанка за столом", "стоячий стол преимущества"],
        },
    },
    "TR": {
        "lang_code": "tr",
        "country_code": "tr",
        "question_prefixes": ["nasıl", "ne", "neden", "ne zaman", "yapılabilir mi", "nasıl önlenir", "ne yapmalı"],
        "high_intent_words": ["uygulama", "app", "egzersiz", "nasıl", "ne yapmalı", "mola", "hatırlatıcı", "ipuçları", "rehber"],
        "seed_keywords": {
            "back-pain": ["sırt ağrısı ofis", "boyun ağrısı bilgisayar", "masa başı mola", "sırt egzersizleri ofis"],
            "eye-strain": ["göz yorgunluğu ekran", "kuru göz bilgisayar", "göz egzersizleri iş"],
            "ergonomics": ["ergonomik çalışma alanı", "doğru oturma pozisyonu", "ayakta masa avantajları"],
        },
    },
    "JA": {
        "lang_code": "ja",
        "country_code": "jp",
        "question_prefixes": ["どうやって", "なぜ", "いつ", "方法", "対策", "予防"],
        "high_intent_words": ["アプリ", "体操", "方法", "対策", "休憩", "リマインダー", "ガイド", "コツ", "ストレッチ"],
        "seed_keywords": {
            "back-pain": ["デスクワーク 腰痛", "パソコン 首の痛み", "座りっぱなし 腰", "オフィス ストレッチ"],
            "eye-strain": ["パソコン 目の疲れ", "ドライアイ パソコン", "目の体操 仕事"],
            "ergonomics": ["デスク 正しい姿勢", "テレワーク 椅子", "スタンディングデスク 効果"],
        },
    },
    "ZH": {
        "lang_code": "zh-CN",
        "country_code": "cn",
        "question_prefixes": ["如何", "什么", "为什么", "怎么", "怎样", "怎么办"],
        "high_intent_words": ["应用", "app", "锻炼", "如何", "怎么办", "休息", "提醒", "指南", "技巧"],
        "seed_keywords": {
            "back-pain": ["办公室 腰痛", "电脑 颈椎痛", "久坐 腰酸", "办公室 拉伸运动"],
            "eye-strain": ["电脑 眼睛疲劳", "干眼症 电脑", "眼保健操 工作"],
            "ergonomics": ["办公桌 正确坐姿", "人体工学 办公", "站立办公桌 好处"],
        },
    },
    "KO": {
        "lang_code": "ko",
        "country_code": "kr",
        "question_prefixes": ["어떻게", "무엇", "왜", "언제", "할 수 있나", "방법", "예방"],
        "high_intent_words": ["앱", "운동", "어떻게", "방법", "휴식", "알림", "가이드", "팁", "스트레칭"],
        "seed_keywords": {
            "back-pain": ["사무실 허리 통증", "컴퓨터 목 통증", "장시간 앉아 허리", "사무실 스트레칭"],
            "eye-strain": ["컴퓨터 눈 피로", "안구건조증 컴퓨터", "눈 운동 직장"],
            "ergonomics": ["책상 바른 자세", "재택근무 의자", "스탠딩 데스크 효과"],
        },
    },
}

# ─── Data model ───


@dataclass
class KeywordResult:
    keyword: str
    lang: str
    country: str
    source: str  # "suggest" | "suggest+prefix"
    seed: str
    score: float = 0.0
    intent_type: str = "informational"
    word_count: int = 0


# ─── Google Suggest scraper ───


async def fetch_suggestions(
    client: httpx.AsyncClient,
    query: str,
    lang_code: str,
    country_code: str,
    retries: int = 3,
) -> list[str]:
    """Fetch Google Suggest completions for a query."""
    url = "https://suggestqueries.google.com/complete/search"
    params = {
        "q": query,
        "hl": lang_code,
        "gl": country_code,
        "client": "firefox",
    }
    headers = {"User-Agent": random.choice(USER_AGENTS)}

    for attempt in range(1, retries + 1):
        try:
            resp = await client.get(url, params=params, headers=headers, timeout=10)
            if resp.status_code == 429:
                wait = 2 ** attempt + random.uniform(0, 1)
                log.warning(f"Rate limited, waiting {wait:.1f}s (attempt {attempt})")
                await asyncio.sleep(wait)
                continue
            resp.raise_for_status()
            data = resp.json()
            # Response format: [query, [suggestions], ...]
            if isinstance(data, list) and len(data) >= 2:
                return [s for s in data[1] if isinstance(s, str) and s.strip()]
            return []
        except (httpx.HTTPError, json.JSONDecodeError) as e:
            if attempt < retries:
                wait = 2 ** attempt + random.uniform(0, 1)
                log.warning(f"Error fetching '{query}': {e}, retry in {wait:.1f}s")
                await asyncio.sleep(wait)
            else:
                log.error(f"Failed after {retries} attempts: '{query}': {e}")
                return []

    return []


async def scrape_language(
    client: httpx.AsyncClient,
    lang_key: str,
    config: dict,
    cluster: str,
    delay: float = 1.5,
) -> list[KeywordResult]:
    """Scrape all suggestions for one language."""
    seeds = config["seed_keywords"].get(cluster, [])
    if not seeds:
        log.warning(f"[{lang_key}] No seed keywords for cluster '{cluster}'")
        return []

    lang_code = config["lang_code"]
    country_code = config["country_code"]
    prefixes = config["question_prefixes"]
    results: list[KeywordResult] = []
    seen: set[str] = set()

    def add_result(kw: str, source: str, seed: str):
        key = kw.lower().strip()
        if key in seen or len(key) < 3:
            return
        seen.add(key)
        results.append(
            KeywordResult(
                keyword=kw.strip(),
                lang=lang_key,
                country=country_code,
                source=source,
                seed=seed,
                word_count=len(kw.split()),
            )
        )

    total_queries = len(seeds) + len(seeds) * len(prefixes)
    log.info(f"[{lang_key}] Starting: {len(seeds)} seeds × {len(prefixes)+1} variants = ~{total_queries} queries")

    for seed in seeds:
        # Direct seed query
        suggestions = await fetch_suggestions(client, seed, lang_code, country_code)
        for s in suggestions:
            add_result(s, "suggest", seed)
        await asyncio.sleep(delay + random.uniform(0, 0.5))

        # Prefix-expanded queries (question words)
        for prefix in prefixes:
            query = f"{prefix} {seed}"
            suggestions = await fetch_suggestions(client, query, lang_code, country_code)
            for s in suggestions:
                add_result(s, "suggest+prefix", seed)
            await asyncio.sleep(delay + random.uniform(0, 0.5))

    log.info(f"[{lang_key}] Collected {len(results)} unique keywords")
    return results


# ─── Scoring ───


def score_keyword(kw: KeywordResult, config: dict) -> float:
    """Score a keyword 0-10 based on relevance signals."""
    score = 0.0
    text = kw.keyword.lower()

    # Word count: prefer 4-8 words (long-tail sweet spot)
    wc = kw.word_count
    if 4 <= wc <= 8:
        score += 3.0
    elif 3 <= wc <= 10:
        score += 1.5
    elif wc < 3:
        score += 0.5

    # Question word bonus
    question_words = config["question_prefixes"]
    if any(text.startswith(q.lower()) for q in question_words):
        score += 2.0
        kw.intent_type = "question"
    elif any(q.lower() in text for q in question_words):
        score += 1.0

    # High-intent words
    high_intent = config["high_intent_words"]
    matches = sum(1 for w in high_intent if w.lower() in text)
    score += min(matches * 1.0, 3.0)

    # Bonus for longer, more specific phrases
    if wc >= 5:
        score += 0.5

    # Prefix-expanded source is slightly more targeted
    if kw.source == "suggest+prefix":
        score += 0.5

    return round(min(score, 10.0), 1)


def score_all(results: list[KeywordResult]) -> list[KeywordResult]:
    """Score and sort all keywords."""
    for kw in results:
        config = LANGUAGE_CONFIG.get(kw.lang, LANGUAGE_CONFIG["EN"])
        kw.score = score_keyword(kw, config)
    results.sort(key=lambda k: (-k.score, k.lang, k.keyword))
    return results


# ─── Output ───

OUTPUT_DIR = Path(__file__).parent


def write_json(results: list[KeywordResult], filename: str = "keywords_output.json"):
    path = OUTPUT_DIR / filename
    data = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "total_keywords": len(results),
        "languages": list(set(r.lang for r in results)),
        "keywords": [asdict(r) for r in results],
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info(f"JSON saved: {path} ({len(results)} keywords)")


def write_csv(results: list[KeywordResult], filename: str = "keywords_output.csv"):
    path = OUTPUT_DIR / filename
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["keyword", "lang", "country", "score", "intent_type", "word_count", "source", "seed"])
        for r in results:
            writer.writerow([r.keyword, r.lang, r.country, r.score, r.intent_type, r.word_count, r.source, r.seed])
    log.info(f"CSV saved: {path} ({len(results)} keywords)")


# ─── Main ───


async def run(langs: list[str], cluster: str, min_score: float, delay: float):
    all_results: list[KeywordResult] = []

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for lang_key in langs:
            config = LANGUAGE_CONFIG.get(lang_key)
            if not config:
                log.warning(f"Unknown language: {lang_key}, skipping")
                continue
            results = await scrape_language(client, lang_key, config, cluster, delay)
            all_results.extend(results)

    score_all(all_results)

    if min_score > 0:
        before = len(all_results)
        all_results = [r for r in all_results if r.score >= min_score]
        log.info(f"Filtered: {before} → {len(all_results)} (min_score={min_score})")

    return all_results


def main():
    parser = argparse.ArgumentParser(description="HealthDesk Keyword Research Pipeline")
    parser.add_argument("--lang", default="ALL", help="Languages: ALL, PL, EN,DE,PL etc.")
    parser.add_argument("--cluster", default="back-pain", help="Keyword cluster name")
    parser.add_argument("--output", default="both", choices=["json", "csv", "both"], help="Output format")
    parser.add_argument("--min-score", type=float, default=0, help="Minimum score filter")
    parser.add_argument("--delay", type=float, default=1.5, help="Delay between requests (seconds)")
    args = parser.parse_args()

    # Parse languages
    if args.lang.upper() == "ALL":
        langs = list(LANGUAGE_CONFIG.keys())
    else:
        langs = [l.strip().upper() for l in args.lang.split(",")]

    log.info(f"Starting keyword research: langs={langs}, cluster={args.cluster}, min_score={args.min_score}")
    start = time.time()

    results = asyncio.run(run(langs, args.cluster, args.min_score, args.delay))

    elapsed = time.time() - start
    log.info(f"Done in {elapsed:.1f}s — {len(results)} keywords total")

    # Stats per language
    lang_counts = {}
    for r in results:
        lang_counts[r.lang] = lang_counts.get(r.lang, 0) + 1
    for lang, count in sorted(lang_counts.items()):
        log.info(f"  {lang}: {count} keywords")

    # Write output
    if args.output in ("json", "both"):
        write_json(results)
    if args.output in ("csv", "both"):
        write_csv(results)

    # Print top 20
    print(f"\n{'='*80}")
    print(f"Top 20 keywords (score >= {args.min_score}):")
    print(f"{'='*80}")
    print(f"{'Score':>5}  {'Lang':<5}  {'Intent':<13}  Keyword")
    print(f"{'-'*5}  {'-'*5}  {'-'*13}  {'-'*50}")
    for r in results[:20]:
        print(f"{r.score:>5.1f}  {r.lang:<5}  {r.intent_type:<13}  {r.keyword}")


if __name__ == "__main__":
    main()
