# Zahlungserfassung

Moderne mandantenfähige Zahlungsverwaltungs-App als installierbare Progressive Web App. Die App ist bewusst dependency-light aufgebaut: Node.js 24, `node:sqlite`, Vanilla-JS-Frontend, sichere HTTP-only Session-Cookies und statische PWA-Assets.

## Funktionen

- Login vor der App mit geschützten Routen
- Rollen: Benutzer und Administrator
- Mandantenrechte: Benutzer sehen nur zugewiesene Mandanten, Admins verwalten alle
- Mandantenverwaltung mit Kategorien, Benutzerzuweisungen und Löschschutz
- Benutzerverwaltung mit Rollen, Aktivstatus und Löschfunktion
- Zahlungs-Dashboard mit mandantenbezogenen Diagrammen
- Zahlungsliste, Archiv, globale Suche und Detail-/Formularseiten ohne Inline-Bearbeitung
- Automatisches Bezahlt-Datum, sobald eine Zahlung auf `Bezahlt` gesetzt wird
- PDF-Upload pro Zahlung, PDF-Anzeige und Entfernen
- EPC-QR-Code erst bei Empfängername, gültiger IBAN, Verwendungszweck und Betrag
- PWA-Manifest, App-Icons, Theme-Color, Service Worker, Offline-Fallback und API-Cache für lesende Daten

## Entwicklungsstart

Voraussetzung: Node.js `>= 24`, weil die App `node:sqlite` nutzt.

```bash
cp .env.example .env
npm install
npm start
```

Danach im Browser öffnen:

```text
http://127.0.0.1:4173
```

Im Entwicklungsmodus werden standardmäßig Demo-Daten angelegt. Das steuert `SEED_MODE=demo`.

## Erster Admin per Konsole

Für eine frische Installation ohne Demo-Daten kann der erste Administrator direkt auf dem Server per SSH angelegt werden:

```bash
npm run create-admin
```

Alternativ mit vorgegebenen Werten:

```bash
node scripts/create-admin.js --email admin@example.com --name "Server Admin"
```

Das Skript legt einen aktiven Administrator an, fragt interaktiv nach dem Passwort und schreibt keine Demo-Daten in die Datenbank.

## Produktion ohne Demo-Daten

In Produktion werden standardmäßig keine Demo-Daten angelegt. Das passiert automatisch, sobald `NODE_ENV=production` gesetzt ist. Zusätzlich empfehle ich, `SEED_MODE=none` explizit zu setzen.

Empfohlene Produktions-Umgebung:

```text
HOST=0.0.0.0
PORT=4173
NODE_ENV=production
SEED_MODE=none
JWT_SECRET=<langer-zufälliger-wert>
DB_PATH=/opt/zahlungserfassung/data/zahlungserfassung.sqlite
MAX_PDF_BYTES=10485760
SESSION_DAYS=1
REMEMBER_DAYS=30
```

## Deployment auf Node-Server

Für einen Server hinter Nginx Proxy Manager mit URL und Let's Encrypt ist der einfachste Weg:

1. Code auf den Server legen, zum Beispiel nach `/opt/zahlungserfassung`.
2. Node.js 24 installieren.
3. `.env` für Produktion anlegen.
4. Ersten Admin per SSH-Konsole anlegen.
5. App per `systemd` oder `pm2` dauerhaft starten.
6. In Nginx Proxy Manager die Domain auf `127.0.0.1:4173` weiterleiten und das Zertifikat ausstellen.

Beispiel für das Verzeichnis:

```text
/opt/zahlungserfassung
  public/
  scripts/
  src/
  data/
  uploads/
  package.json
  .env
```

### 1. Anwendung vorbereiten

```bash
cd /opt/zahlungserfassung
npm install --omit=dev
mkdir -p data uploads
```

### 2. `.env` für Produktion anlegen

```bash
cp .env.example .env
```

Dann die Werte anpassen:

```text
HOST=127.0.0.1
PORT=4173
NODE_ENV=production
SEED_MODE=none
JWT_SECRET=<langer-zufälliger-wert>
DB_PATH=/opt/zahlungserfassung/data/zahlungserfassung.sqlite
MAX_PDF_BYTES=10485760
SESSION_DAYS=1
REMEMBER_DAYS=30
```

`JWT_SECRET` sollte ein langer, zufälliger Geheimwert sein, zum Beispiel 64+ Zeichen.

### 3. Ersten Admin per SSH anlegen

Das geht vor dem ersten Live-Login direkt auf dem Server:

```bash
cd /opt/zahlungserfassung
npm run create-admin
```

Danach E-Mail, Name und Passwort eingeben. Der Login in der App funktioniert anschließend sofort mit diesem Admin.

### 4. App als `systemd`-Service starten

Beispiel-Datei: `/etc/systemd/system/zahlungserfassung.service`

```ini
[Unit]
Description=Zahlungserfassung
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/zahlungserfassung
EnvironmentFile=/opt/zahlungserfassung/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Service aktivieren:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now zahlungserfassung
sudo systemctl status zahlungserfassung
```

Logs prüfen:

```bash
sudo journalctl -u zahlungserfassung -f
```

### 5. Nginx Proxy Manager

In Nginx Proxy Manager einen Proxy Host anlegen:

- Domain Names: deine URL, zum Beispiel `zahlungen.deinedomain.de`
- Scheme: `http`
- Forward Hostname / IP: `127.0.0.1`
- Forward Port: `4173`
- Block Common Exploits: aktiv
- Websockets Support: kann aktiv bleiben

Danach im SSL-Tab:

- `Request a new SSL Certificate`
- `Force SSL`
- `HTTP/2 Support`
- `HSTS Enabled` optional

Wenn Nginx Proxy Manager nicht auf demselben Host läuft, sondern in deinem LAN oder Docker-Netzwerk, muss die App auf einer erreichbaren Adresse lauschen. Dafür `HOST=0.0.0.0` setzen. Dann ist sie auf der Server-IP im Netzwerk erreichbar, zum Beispiel `192.168.x.x:4173`.

Für diesen Fall im Proxy Host:

- Forward Hostname / IP: die interne Server-IP der Node-App, zum Beispiel `192.168.1.50`
- Forward Port: `4173`

Wichtig für die Freigabe:

- Die App muss mit `HOST=0.0.0.0` oder alternativ direkt mit der LAN-IP gestartet werden.
- Die Firewall des Servers muss Verbindungen auf `4173` vom Proxy Manager erlauben.
- Wenn du `systemd` nutzt, danach `sudo systemctl restart zahlungserfassung` ausführen.
- Prüfen kannst du das auf dem Server mit `ss -ltnp | grep 4173` oder `sudo netstat -tulpn | grep 4173`. Dort sollte nicht nur `127.0.0.1:4173`, sondern `0.0.0.0:4173` oder die LAN-IP stehen.

Die Anwendung liest die `.env` jetzt selbst beim Start ein. Änderungen an `HOST`, `PORT` oder anderen Werten greifen nach einem Neustart des Node-Prozesses.

## Aktualisieren einer Live-Installation

```bash
cd /opt/zahlungserfassung
git pull
npm install --omit=dev
sudo systemctl restart zahlungserfassung
```

Wenn sich nur Frontend-Dateien geändert haben, leert der neue Service-Worker-Cache die alte App-Shell automatisch nach dem Update.

## Projektstruktur

```text
public/
  app.js                  PWA-Frontend, Routing, State, Komponenten
  styles.css              Dark Theme, responsive Layout, Animationen
  manifest.webmanifest    PWA-Manifest
  service-worker.js       Static Cache, Network-First API-Cache, Offline-Fallback
  icons/                  App-Icons
src/server/
  index.js                HTTP-Server, API-Routen, Rechteprüfung
  db.js                   SQLite-Schema und Migration
  auth.js                 Passwort-Hashing, JWT, Sessions, Cookies
  validation.js           Zahlungs-, IBAN- und Betragvalidierung
  multipart.js            PDF-Upload-Parser
  qr.js                   EPC-Payload und QR-SVG-Generator
  seed.js                 Demo-Seeds für Entwicklung
scripts/
  create-admin.js         Legt einen Admin per Konsole an
  generate_icons.py       Regeneriert PNG-App-Icons aus PIL-Zeichnung
data/                     SQLite-Datenbank, ignoriert
uploads/                  PDF-Uploads, ignoriert
```

## Sicherheit

- Passwörter werden mit PBKDF2-SHA256 und Salt gespeichert.
- Sessions liegen serverseitig in SQLite; der Browser erhält ein HTTP-only JWT-Cookie.
- Mutierende API-Requests benötigen zusätzlich ein CSRF-Token.
- Mandantenzugriffe werden serverseitig geprüft.
- Admin-Endpunkte sind rollenbasiert geschützt.
- Uploads erlauben nur PDFs, prüfen MIME/Dateiendung/PDF-Signatur und Größenlimit.
- IBANs werden serverseitig per Mod-97 validiert.
- Sicherheitsheader und eine restriktive Content Security Policy sind gesetzt.

## PWA

Der Service Worker cached die App-Shell und nutzt Network-First für ausgewählte GET-API-Endpunkte wie Dashboard, Zahlungen, Mandanten und Kategorien. Beim Login und Logout wird der Runtime-Cache geleert, damit keine Daten zwischen Sitzungen hängen bleiben.
