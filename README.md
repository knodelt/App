# FRAME

**Swipe your taste.**

FRAME ist ein Mobile-first-Prototyp für eine Film- und Serien-Discovery-App. Statt klassischer Sternebewertungen lernt die App den Geschmack über schnelle Entscheidungen zu Filmen, Serien, Schauspielern und Regisseuren.

## Aktueller Stand

- Mobile-first Swipe-Deck
- Links = **Super**
- Rechts = **Mist**
- Hoch = **Merken / Watchlist**
- Filter für Filme, Serien und People
- Poster, Profilbilder und Kurzinfos
- lokale Watchlist
- **Daily Frame** mit sieben täglichen Vorschlägen
- **Frame Match** mit serverseitig synchronisierten 10er-Runden für zwei Geräte
- nach Zustimmung beider Seiten: bis zu 90 Tage gespeicherte Filmpartner
- gemeinsame Filmliste aus enthüllten Matches und neue genregewichtete Vorschläge für beide
- eine separate **Just Pick One**-Soloentscheidung
- lokales Geschmacksprofil („Movie DNA“)
- einfache, nachvollziehbare Empfehlungen aus Tags und Swipe-Signalen
- installierbare PWA
- Offline App-Shell via Service Worker
- dynamischer TMDB-Feed über Cloudflare Worker
- automatische Pagination: neue Karten werden nachgeladen, bevor der Feed leer wird
- subtile Film-Easter-Eggs im Interface

## Technik

FRAME ist bewusst leichtgewichtig gebaut:

- HTML
- CSS
- Vanilla JavaScript
- localStorage
- PWA Manifest + Service Worker
- Cloudflare Workers Static Assets und Durable Objects für Frame Match
- Cloudflare Worker API unter `/api/feed`
- TMDB API als Film-/Serien-/People-Datenquelle

Der TMDB-Token bleibt ausschließlich als Cloudflare Secret auf dem Server und wird nie an den Browser ausgeliefert.

## Cloudflare Deployment

Das Repository ist als Cloudflare Worker verbunden. `wrangler.jsonc` ist die Source of Truth. Der Deploy-Befehl kann weiterhin sein:

```bash
npx wrangler deploy
```

Normale App-Dateien werden als Static Assets ausgeliefert. `/api/*` wird über `main-worker.js` verarbeitet; `/api/hidden-match/*` verwendet `HiddenMatchRoom` Durable Objects.

### Frame Match: Speichern und Privatsphäre

Rooms sind normalerweise 24 Stunden gültig. Bestätigen **beide** Seiten „Filmpartner speichern“, bleibt die Verbindung bei Aktivität bis zu 90 Tage erhalten. Beide Teilnehmer können danach in neuen Runden bewerten und enthüllte gemeinsame Titel in einer geteilten Filmliste speichern.

Jeder Participant besitzt einen separaten privaten Sitzungsschlüssel. Die Browser-App merkt sich auf demselben Gerät bis zu acht Partnerverbindungen. Diese Schlüssel gehören **nicht** in Einladungslinks; ohne Benutzerkonto kann ein Gerätewechsel den Zugriff verlieren. Beenden oder Verlassen einer gespeicherten Partnerschaft schließt den gemeinsamen Raum für beide. Swipes werden erst beim Reveal als Matches offengelegt.

## TMDB aktivieren

1. Bei TMDB anmelden und unter **Account Settings → API** eine Developer-API-Anwendung registrieren.
2. Den **API Read Access Token** kopieren.
3. In Cloudflare beim Worker `app` unter **Settings → Variables and Secrets** ein verschlüsseltes Secret anlegen:

```text
TMDB_API_TOKEN
```

Als Wert den TMDB **API Read Access Token** verwenden.

Alternativ über Wrangler:

```bash
npx wrangler secret put TMDB_API_TOKEN
```

Danach neu deployen. `/api/feed?page=1` liefert dann einen gemischten Feed aus Filmen, Serien und People in deutscher Sprache.

Ohne Secret bleibt die App funktionsfähig und verwendet die kuratierten Seed-Karten als Fallback.

## TMDB Attribution

FRAME zeigt die von TMDB geforderte Attribution in der Anwendung an:

> This product uses the TMDB API but is not endorsed or certified by TMDB.

Vor einer Veröffentlichung außerhalb des Prototyp-Stadiums sollten zusätzlich das aktuelle offizielle TMDB-Logo und die jeweils gültigen Branding-/Lizenzbedingungen geprüft werden.

## Lokal starten

Da ein Service Worker verwendet wird, sollte die App über einen lokalen Webserver statt direkt per `file://` geöffnet werden.

```bash
python3 -m http.server 8080
```

Ohne lokales Worker-Runtime-Setup läuft dabei nur der Seed-Katalog. Für das komplette Full-Stack-Verhalten eignet sich Wrangler Dev.

## Nächste sinnvolle Schritte

1. TMDB Secret aktivieren
2. echte TMDB-basierte Empfehlungen statt statischer Recommendation-Seeds
3. Detailansicht für Filme/Serien/People
4. Auth + Profile
5. Swipe-Daten serverseitig speichern
6. optional eigene Konten und sichere Wiederherstellung gespeicherter Filmpartner auf anderen Geräten ergänzen
7. Push/Reminder für neue Daily Drops und neue gemeinsame Matches
8. später optional Capacitor für native iOS-/Android-Builds

---

`FRAME / CUT 11.22 / 24 FPS`
