# Pollenflug Card für Home Assistant

Zeigt die Pollenflugvorhersage des Deutschen Wetterdienstes (DWD) für **heute, morgen und übermorgen**:
pro Pollenart ein farbiger Balken (0 = keine … 3 = hoch, in halben Stufen), oben ein Hinweis auf die
höchste Belastung des Tages. Ein Klick auf eine Zeile öffnet den Detail-Dialog des Sensors.

## Voraussetzung: Daten

Die Card zeigt nur an. Die Daten liefert die HACS-Integration
**[DWD Pollenflug](https://github.com/mampfes/hacs_dwd_pollenflug)**:

1. In HACS → *Integrationen* → „DWD Pollenflug“ installieren und Home Assistant neu starten.
2. *Einstellungen → Geräte & Dienste → Integration hinzufügen → DWD Pollenflug*, dann deine Region wählen.

Danach gibt es Sensoren wie `sensor.pollenflug_birke_31` (die Zahl am Ende ist die Region-ID).

## Installation der Card

1. `pollenflug-card.js` nach `/config/www/pollenflug-card.js` kopieren (Ordner `www` ggf. anlegen).
2. *Einstellungen → Dashboards → ⋮ → Ressourcen → Ressource hinzufügen*
   - URL: `/local/pollenflug-card.js`
   - Typ: **JavaScript-Modul**
3. Browser neu laden (ggf. Cache leeren).
4. Im Dashboard *Karte hinzufügen* → „Pollenflug“ suchen. Die Card lässt sich im visuellen Editor einstellen.

## Konfiguration (YAML)

Minimal – alle `sensor.pollenflug_*` werden automatisch gefunden:

```yaml
type: custom:pollenflug-card
```

Nur deine Allergene, nur Pollen mit Belastung, mit Legende:

```yaml
type: custom:pollenflug-card
title: Meine Allergene
hide_inactive: true
show_legend: true
entities:
  - sensor.pollenflug_birke_31
  - sensor.pollenflug_graeser_31
  - entity: sensor.pollenflug_hasel_31
    name: Haselnuss
    icon: mdi:nature
```

| Option | Standard | Beschreibung |
| --- | --- | --- |
| `title` | `Pollenflug` | Überschrift (leer = keine) |
| `entities` | automatisch | Liste von Sensoren, als Text oder `{entity, name, icon}` |
| `region` | – | Bei automatischer Erkennung nur Sensoren mit dieser Region-ID (z. B. `31`) |
| `entity_prefix` | `sensor.pollenflug_` | Präfix für die automatische Erkennung |
| `show_forecast` | `true` | Morgen und übermorgen anzeigen; `false` = nur heute, mit Text |
| `hide_inactive` | `false` | Pollen ausblenden, die an keinem Tag Belastung haben |
| `sort` | `level` | `level` (stärkste zuerst), `name` oder `none` (Reihenfolge wie konfiguriert) |
| `show_legend` | `false` | Farblegende unten anzeigen |
| `show_last_update` | `true` | „Stand“ der DWD-Daten anzeigen |
| `attributes.tomorrow` | `state_tomorrow` | Attribut für morgen (für andere Integrationen) |
| `attributes.day_after` | `state_in_2_days` | Attribut für übermorgen |

Andere Datenquellen funktionieren auch, solange der Sensor-Zustand die heutige Belastung als Zahl
(0–3) oder als DWD-Text wie `1-2` enthält. Die Attributnamen für die Vorhersage lassen sich über
`attributes` anpassen.

## Demo ohne Home Assistant

`demo.html` zeigt die Card mit Beispieldaten. Sie braucht einen lokalen Webserver, z. B.
`python3 -m http.server` im Ordner der Dateien, dann `http://localhost:8000/demo.html` öffnen.
