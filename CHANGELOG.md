# Changelog

Alle nennenswerten Änderungen an der Pollenflug Card. Versionen folgen [Semantic Versioning](https://semver.org/lang/de/).

## [1.1.1] - 2026-10-30

### Verbessert
- Liefert ein Sensor nur Werte für heute und morgen, zeigt die Karte nur diese beiden Spalten statt einer leeren Übermorgen-Spalte.

### Behoben
- Der DWD-Wert „-1“ (keine Vorhersage für diesen Tag) wurde fälschlich als „keine Belastung“ angezeigt.

## [1.1.0] - 2026-10-30

### Neu
- Visueller Editor: Die Card lässt sich komplett über die Oberfläche einrichten, YAML ist nicht mehr nötig.
- Auswahl zwischen allen gefundenen Pollen-Sensoren (optional nach Region) und einer eigenen Auswahl.
- Ausgewählte Sensoren lassen sich hinzufügen, entfernen, sortieren, umbenennen und mit eigenem Symbol versehen.
- Installation über HACS als benutzerdefiniertes Repository (Typ „Dashboard“).

## [1.0.0] - 2026-10-30

### Neu
- Erste Version: Pollenflugvorhersage des DWD für heute, morgen und übermorgen mit farbigen Balken.
- Automatische Erkennung der Sensoren der Integration „DWD Pollenflug“.
- Optionen für Vorhersage, Ausblenden ohne Belastung, Sortierung, Legende und Datenstand.
