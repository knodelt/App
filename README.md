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
- **FRAMELOG** als eigenständiger sechster Tab und zentrales persönliches Filmtagebuch
- Filter: Alle, Gesehen, Merkliste, SUPER und MIST – über einen eigenen FRAMELOG-Tab in der unteren Navigation
- getrennte Speicherung von Swipe-Interesse und echten Gesehen-Bewertungen
- realer Überblick über gesehene Titel, Gefallen und Merkliste, mit Datum/Notiz je gesehenem Titel
- lokale Merkliste (jetzt integriert in FRAMELOG)
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

### FRAMELOG: lokale Daten und ältere Swipes

FRAMELOG zeigt die bereits vorhandenen Einträge aus `frame-state` und – wo vorhanden – ältere Empfehlungseinträge. Die ursprünglichen Entscheidungen und die späteren Gesehen-Urteile bleiben voneinander getrennt. Neue Einträge erhalten einen kleinen Filmdaten-Schnappschuss; zuvor gespeicherte Titel werden nicht dupliziert. Bei alten, unvollständig gespeicherten Einträgen können Poster oder Datum fehlen.

Gesehen-Einträge unterstützen ein frei editierbares Filmabend-Datum und eine Notiz. Ohne Anmeldung bleiben die Daten lokal. Mit FRAME Cloud können angemeldete Nutzer persönliche Film- und Geschmacksdaten geräteübergreifend speichern. Frame-Match-Sitzungsschlüssel werden bewusst nicht übertragen.


## FRAME Cloud einrichten (framingapp.de)

Das Repository enthält die technische Implementierung für eine passwortlose Anmeldung
mit E-Mail-Code, Google und Apple sowie private Cloud-Speicherung über Cloudflare
Durable Objects. **Ohne Anbieter-Secrets ist die Anmeldung noch nicht freigeschaltet.**
Alle Schlüssel gehören ausschließlich in Cloudflare Workers & Pages → app →
Settings → Variables and Secrets, niemals in das öffentliche GitHub-Repository.

### 1. Cloud-Speicher und Basis-Secret

Die Wrangler-Konfiguration enthält eine zweite SQLite-Durable-Object-Klasse
**FrameAccount**, Binding **FRAME_ACCOUNTS** und Migration **frame_accounts_v1**.
Beim nächsten Cloudflare-Build muss die neue Klasse erfolgreich bereitgestellt werden.

Ein verschlüsseltes Worker-Secret **AUTH_SECRET** mit einem zufälligen
Schlüssel (mindestens 32 Zeichen, empfohlen 64 zufällige Hexzeichen) anlegen.
Optional kann die öffentliche Textvariable **FRAME_PUBLIC_ORIGIN** auf
https://framingapp.de gesetzt werden.

**AUTH_SECRET nicht verlieren und nicht verändern!** Der Schlüssel leitet die
Kontenzuordnung aus einer verifizierten E-Mail-Adresse ab. Ein neuer Schlüssel
kann die Wiederherstellung älterer Cloud-Konten verhindern.

### 2. E-Mail-Login aktivieren

Bei https://resend.com eine Absenderdomain **framingapp.de** verifizieren,
dazu die geforderten DNS-Einträge in Cloudflare hinzufügen und einen API-Key
erstellen. Dann diese beiden Worker-Secrets setzen:

- **RESEND_API_KEY:** privater API-Key
- **FRAME_EMAIL_FROM:** z. B. FRAME <login@framingapp.de> (muss zur verifizierten Absenderdomain passen)

Die sechsstelligen Codes gelten 10 Minuten und sind einmalig. Häufigkeit pro
E-Mail-Adresse und Client-IP ist begrenzt; nach fünf Fehlversuchen ist ein
Code ungültig. Der Versand ist ohne diese Konfiguration nicht verfügbar.

### 3. Google-Login aktivieren

In https://console.cloud.google.com/apis/credentials einen OAuth-2.0-Webclient
anlegen und den Einwilligungsbildschirm konfigurieren.

- Zugelassener Ursprung: **https://framingapp.de**
- Autorisierte Weiterleitung: **https://framingapp.de/api/account/oauth/google/callback**
- Worker-Secrets: **GOOGLE_CLIENT_ID** und **GOOGLE_CLIENT_SECRET**

FRAME verwendet OAuth Authorization Code mit PKCE und prüft signierte ID-Tokens,
Issuer, Audience, Nonce, Gültigkeit und die verifizierte E-Mail-Adresse.

### 4. Login mit Apple aktivieren

Im Apple Developer-Konto Sign in with Apple aktivieren, eine Services ID für
die Website einrichten und die Domain **framingapp.de** registrieren.

- Return-URL: **https://framingapp.de/api/account/oauth/apple/callback**
- **APPLE_CLIENT_ID:** die Services ID
- **APPLE_TEAM_ID:** Apple Team ID
- **APPLE_KEY_ID:** Kennung des Sign-in-with-Apple-Schlüssels
- **APPLE_PRIVATE_KEY:** vollständiger Inhalt des privaten .p8-Schlüssels

Die Werte sind als Worker-Secrets zu speichern. FRAME signiert den
Apple-Client-Secret-JWT selbst auf dem Server und prüft ID-Tokens gegen Apples
öffentliche JWK-Schlüssel. Mit Apples Funktion „E-Mail verbergen“ entsteht
gegebenenfalls ein separates Konto statt einer automatischen Verknüpfung.

### Daten und Konflikte

- Ohne Konto funktioniert FRAME weiterhin lokal.
- Bei der ersten Anmeldung wird vor dem Hochladen vorhandener Gerätedaten gefragt.
- Ein neues Gerät ohne Filmverlauf lädt die vorhandenen Cloud-Daten.
- Parallel bearbeitete Daten werden nicht automatisch überschrieben; FRAME
  verlangt eine bewusste Entscheidung zwischen Gerät und Cloud.
- Gespeichert werden FRAME-State (Swipes, Merkliste, Gesehen, FRAMELOG),
  Taste-DNA, Online-Lernen, Empfehlungshistorie, Daily Frame und Stimmungsfilter.
- Frame-Match-Raumcodes/Sitzungsschlüssel werden nicht mit Cloud synchronisiert.
- Abmelden entfernt die private lokale Kopie; die Cloud bleibt erhalten.
- Die Kontolöschung entfernt den privaten Cloud-Datensatz und alle Sessions.
- Eine JSON-Sicherung lässt sich über den Konto-Bereich herunterladen.

**Vor einem öffentlichen Start:** E-Mail-Zustellung, Google- und Apple-Login,
Zwei-Geräte-Synchronisierung, Konflikte und Löschung live prüfen, außerdem
Impressum, vollständige Datenschutzerklärung/DSGVO und genutzte Filmrechte.


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
4. FRAME Cloud-Secrets und OAuth-Anbieter im Cloudflare-Dashboard einrichten
5. Konten mit zwei Smartphones live testen und bei Bedarf verbessern
6. optional bestehende Frame-Match-Partnerschaften mit Accounts verknüpfen
7. Push/Reminder für neue Daily Drops und neue gemeinsame Matches
8. später optional Capacitor für native iOS-/Android-Builds

---

`FRAME / CUT 11.22 / 24 FPS`
