# FRAME

**Swipe your taste.**

FRAME ist ein Mobile-first-Prototyp für eine Film- und Serien-Discovery-App. Statt klassischer Sternebewertungen lernt die App den Geschmack über schnelle Entscheidungen zu Filmen, Serien, Schauspielern und Regisseuren.

## V0.1

- Mobile-first Swipe-Deck
- Links = **Super**
- Rechts = **Mist**
- Hoch = **Merken / Watchlist**
- Filter für Filme, Serien und People
- lokale Watchlist
- lokales Geschmacksprofil („Movie DNA“)
- einfache, nachvollziehbare Empfehlungen aus Tags und Swipe-Signalen
- installierbare PWA-Grundlage
- Offline App-Shell via Service Worker
- subtile Film-Easter-Eggs im Interface

## Technik

V0.1 ist absichtlich frameworkfrei gebaut:

- HTML
- CSS
- Vanilla JavaScript
- localStorage
- PWA Manifest + Service Worker

Damit kann die erste Version ohne Build-Prozess direkt über **Cloudflare Pages** ausgeliefert und auf Smartphones getestet werden.

## Cloudflare Pages

Repository mit Cloudflare Pages verbinden und folgende Einstellungen verwenden:

- Framework preset: `None`
- Build command: leer lassen
- Build output directory: `/`

Danach wird jeder Push auf `main` automatisch deployed.

## Lokal starten

Da ein Service Worker verwendet wird, sollte die App über einen lokalen Webserver statt direkt per `file://` geöffnet werden.

Beispiel:

```bash
python3 -m http.server 8080
```

Danach `http://localhost:8080` öffnen.

## Daten

Die aktuell enthaltenen Titel und Personen dienen nur als Seed-Daten für den Prototyp. Es werden bewusst keine fremden Posterbilder eingebunden. Für eine spätere Version sollte eine Filmdatenquelle wie TMDB integriert und deren Lizenz-/Attributionsbedingungen sauber umgesetzt werden.

## Nächste sinnvolle Schritte

1. Cloudflare Pages Deployment
2. echtes Film-/Serien-Daten-API anbinden
3. Auth + Profile
4. Swipe-Daten serverseitig speichern
5. gemeinsamer Taste-Match zwischen Freunden
6. Empfehlungsmodell ausbauen
7. später optional Capacitor für native iOS-/Android-Builds

---

`FRAME / CUT 11.22 / 24 FPS`
