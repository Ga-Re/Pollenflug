/*
 * Pollenflug Card für Home Assistant
 * Zeigt die Pollenflugvorhersage des DWD (heute, morgen, übermorgen) an.
 *
 * Standardmäßig passend zur HACS-Integration "DWD Pollenflug" (mampfes/hacs_dwd_pollenflug):
 *   state            -> Belastung heute (0 … 3 in 0,5er-Schritten)
 *   state_tomorrow   -> Belastung morgen
 *   state_in_2_days  -> Belastung übermorgen
 */

const VERSION = "1.0.0";

const POLLEN = [
  { keys: ["ambrosia"], name: "Ambrosia", icon: "mdi:flower-pollen" },
  { keys: ["beifuss", "beifus"], name: "Beifuß", icon: "mdi:flower-pollen-outline" },
  { keys: ["birke"], name: "Birke", icon: "mdi:tree" },
  { keys: ["erle"], name: "Erle", icon: "mdi:tree-outline" },
  { keys: ["esche"], name: "Esche", icon: "mdi:pine-tree" },
  { keys: ["graeser", "graser", "gras"], name: "Gräser", icon: "mdi:grass" },
  { keys: ["hasel"], name: "Hasel", icon: "mdi:nature" },
  { keys: ["roggen"], name: "Roggen", icon: "mdi:barley" },
];

// Index = Belastung * 2 (0, 0.5, 1, … 3)
const LEVELS = [
  { label: "keine", color: "#43a047" },
  { label: "keine bis gering", color: "#9ccc65" },
  { label: "gering", color: "#fdd835" },
  { label: "gering bis mittel", color: "#ffb300" },
  { label: "mittel", color: "#fb8c00" },
  { label: "mittel bis hoch", color: "#f4511e" },
  { label: "hoch", color: "#d32f2f" },
];

const DEFAULT_ATTRIBUTES = {
  tomorrow: ["state_tomorrow", "tomorrow", "forecast_tomorrow"],
  day_after: ["state_in_2_days", "state_day_after_tomorrow", "day_after_tomorrow", "forecast_day_after_tomorrow"],
};

const SORT_OPTIONS = {
  level: "Nach Belastung",
  name: "Alphabetisch",
  none: "Wie konfiguriert",
};

const FORM_LABELS = {
  title: "Titel",
  entities: "Sensoren (leer = automatisch erkennen)",
  region: "Region-ID (nur bei automatischer Erkennung)",
  show_forecast: "Vorhersage anzeigen",
  hide_inactive: "Pollen ohne Belastung ausblenden",
  show_legend: "Legende anzeigen",
  show_last_update: "Stand anzeigen",
  sort: "Sortierung",
};

const clampLevel = (n) => Math.min(3, Math.max(0, Math.round(n * 2) / 2));

function parseLevel(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? clampLevel(raw) : null;
  const s = String(raw).trim().replace(/,/g, ".");
  if (!s || s === "unknown" || s === "unavailable") return null;
  // DWD-Schreibweise "1-2" => 1,5
  const range = s.match(/^(\d(?:\.\d+)?)\s*-\s*(\d(?:\.\d+)?)$/);
  if (range) return clampLevel((parseFloat(range[1]) + parseFloat(range[2])) / 2);
  const n = parseFloat(s);
  return Number.isFinite(n) ? clampLevel(n) : null;
}

const levelInfo = (level) =>
  level === null ? { label: "keine Daten", color: "var(--disabled-text-color, #9e9e9e)" } : LEVELS[level * 2];

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function findPollen(text) {
  const t = text.toLowerCase().replace(/ä/g, "ae").replace(/ß/g, "ss");
  return POLLEN.find((p) => p.keys.some((k) => t.includes(k)));
}

class PollenflugCard extends HTMLElement {
  static getConfigForm() {
    return {
      schema: [
        { name: "title", selector: { text: {} } },
        { name: "entities", selector: { entity: { multiple: true, filter: { domain: "sensor" } } } },
        { name: "region", selector: { text: {} } },
        {
          type: "grid",
          name: "",
          schema: [
            { name: "show_forecast", selector: { boolean: {} } },
            { name: "hide_inactive", selector: { boolean: {} } },
            { name: "show_legend", selector: { boolean: {} } },
            { name: "show_last_update", selector: { boolean: {} } },
          ],
        },
        {
          name: "sort",
          selector: {
            select: {
              mode: "dropdown",
              options: Object.entries(SORT_OPTIONS).map(([value, label]) => ({ value, label })),
            },
          },
        },
      ],
      computeLabel: (schema) => FORM_LABELS[schema.name],
    };
  }

  static getStubConfig() {
    return { title: "Pollenflug", show_forecast: true, hide_inactive: false, sort: "level" };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._lastStates = null;
  }

  setConfig(config) {
    if (!config) throw new Error("Ungültige Konfiguration");
    if (config.entities !== undefined && !Array.isArray(config.entities)) {
      throw new Error("'entities' muss eine Liste sein");
    }
    this._config = {
      title: "Pollenflug",
      show_forecast: true,
      hide_inactive: false,
      show_legend: false,
      show_last_update: true,
      sort: "level",
      entity_prefix: "sensor.pollenflug_",
      ...config,
      attributes: { ...config.attributes },
    };
    this._lastStates = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const ids = this._entityConfigs().map((e) => e.entity);
    const states = ids.map((id) => hass.states[id]);
    // Nur neu zeichnen, wenn sich eine der relevanten Entitäten geändert hat
    if (
      this._lastStates &&
      this._lastStates.length === states.length &&
      this._lastStates.every((s, i) => s === states[i])
    ) {
      return;
    }
    this._lastStates = states;
    this._render();
  }

  getCardSize() {
    return 2 + (this._rowCount || 4);
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  _entityConfigs() {
    const cfg = this._config;
    if (cfg.entities && cfg.entities.length) {
      return cfg.entities.map((e) => (typeof e === "string" ? { entity: e } : e)).filter((e) => e && e.entity);
    }
    if (!this._hass) return [];
    const suffix = cfg.region ? `_${String(cfg.region).trim()}` : null;
    return Object.keys(this._hass.states)
      .filter((id) => id.startsWith(cfg.entity_prefix))
      .filter((id) => !suffix || id.endsWith(suffix))
      .sort()
      .map((entity) => ({ entity }));
  }

  _readAttribute(stateObj, day) {
    const configured = this._config.attributes[day];
    const keys = configured ? [configured] : DEFAULT_ATTRIBUTES[day];
    for (const key of keys) {
      if (stateObj.attributes[key] !== undefined) return parseLevel(stateObj.attributes[key]);
    }
    return null;
  }

  _buildRows() {
    return this._entityConfigs().map((ec, index) => {
      const stateObj = this._hass.states[ec.entity];
      if (!stateObj) return { entity: ec.entity, missing: true, name: ec.name || ec.entity, index };
      const friendly = stateObj.attributes.friendly_name || "";
      const pollen = findPollen(ec.entity) || findPollen(friendly);
      const days = [parseLevel(stateObj.state)];
      if (this._config.show_forecast) {
        days.push(this._readAttribute(stateObj, "tomorrow"), this._readAttribute(stateObj, "day_after"));
      }
      return {
        entity: ec.entity,
        name: ec.name || (pollen ? pollen.name : friendly || ec.entity),
        icon: ec.icon || (pollen ? pollen.icon : stateObj.attributes.icon || "mdi:flower-pollen"),
        description: stateObj.attributes.state_today_desc,
        lastUpdate: stateObj.attributes.last_update,
        days,
        index,
      };
    });
  }

  _sortRows(rows) {
    const sort = this._config.sort;
    if (sort === "name") return rows.sort((a, b) => a.name.localeCompare(b.name, "de"));
    if (sort === "level") {
      const score = (r) => (r.missing ? -1 : r.days.reduce((acc, d, i) => acc + (d ?? 0) * Math.pow(10, 2 - i), 0));
      return rows.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, "de"));
    }
    return rows;
  }

  _dayLabels() {
    const lang = (this._hass.locale && this._hass.locale.language) || this._hass.language || "de";
    const inTwoDays = new Date();
    inTwoDays.setDate(inTwoDays.getDate() + 2);
    let weekday;
    try {
      weekday = inTwoDays.toLocaleDateString(lang, { weekday: "short" });
    } catch (e) {
      weekday = "Übermorgen";
    }
    return this._config.show_forecast ? ["Heute", "Morgen", weekday] : ["Heute"];
  }

  _formatLastUpdate(rows) {
    const raw = rows.find((r) => r.lastUpdate)?.lastUpdate;
    if (!raw) return null;
    const date = new Date(raw);
    if (isNaN(date)) return null;
    return date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  _renderBar(level) {
    const info = levelInfo(level);
    const segments = [0, 1, 2]
      .map((i) => {
        const fill = level === null ? 0 : Math.min(1, Math.max(0, level - i)) * 100;
        return `<span class="seg" style="--fill:${fill}%"></span>`;
      })
      .join("");
    return `<div class="bar ${level === 0 ? "none" : ""}" style="--c:${info.color}">${segments}</div>`;
  }

  _renderRow(row) {
    if (row.missing) {
      return `<div class="row missing"><div class="name-cell"><div class="text"><div class="name">${escapeHtml(row.name)}</div><div class="sub">Entität nicht gefunden</div></div></div></div>`;
    }
    const today = levelInfo(row.days[0]);
    const desc = row.description || today.label;
    const cells = row.days
      .map((level, i) => {
        const info = levelInfo(level);
        const label = this._dayLabelsCache[i];
        return `<div class="cell" title="${escapeHtml(`${label}: ${info.label}`)}">
          ${this._renderBar(level)}
          ${this._config.show_forecast ? "" : `<span class="cell-label">${escapeHtml(info.label)}</span>`}
        </div>`;
      })
      .join("");
    return `<div class="row" data-entity="${escapeHtml(row.entity)}" role="button" tabindex="0">
      <div class="name-cell">
        <div class="icon" style="--c:${today.color}"><ha-icon icon="${escapeHtml(row.icon)}"></ha-icon></div>
        <div class="text">
          <div class="name">${escapeHtml(row.name)}</div>
          ${this._config.show_forecast ? `<div class="sub">${escapeHtml(desc)}</div>` : ""}
        </div>
      </div>
      ${cells}
    </div>`;
  }

  _render() {
    if (!this._config || !this._hass) return;
    const cfg = this._config;
    let rows = this._buildRows();
    const totalRows = rows.length;
    if (cfg.hide_inactive) rows = rows.filter((r) => r.missing || r.days.some((d) => d !== null && d > 0));
    rows = this._sortRows(rows);
    this._rowCount = rows.length;
    this._dayLabelsCache = this._dayLabels();

    const maxToday = rows.reduce((max, r) => (r.missing || r.days[0] === null ? max : Math.max(max, r.days[0])), -1);
    const chip =
      maxToday >= 0
        ? `<span class="chip" style="--c:${levelInfo(maxToday).color}">${maxToday > 0 ? `Heute ${escapeHtml(levelInfo(maxToday).label)}` : "Heute keine Belastung"}</span>`
        : "";

    let body;
    if (totalRows === 0) {
      body = `<div class="empty">Keine Pollenflug-Sensoren gefunden.<br>Installiere die Integration „DWD Pollenflug“ oder trage die Sensoren unter <code>entities</code> ein.</div>`;
    } else if (rows.length === 0) {
      body = `<div class="empty calm"><ha-icon icon="mdi:emoticon-happy-outline"></ha-icon><span>Aktuell kein Pollenflug – durchatmen!</span></div>`;
    } else {
      const heads = this._dayLabelsCache.map((l) => `<div class="dayhead">${escapeHtml(l)}</div>`).join("");
      body = `<div class="row head"><div></div>${heads}</div>${rows.map((r) => this._renderRow(r)).join("")}`;
    }

    const lastUpdate = cfg.show_last_update ? this._formatLastUpdate(rows) : null;
    const legend = cfg.show_legend
      ? `<div class="legend">${[0, 1, 2, 3]
          .map((l) => `<span><i style="--c:${levelInfo(l).color}"></i>${levelInfo(l).label}</span>`)
          .join("")}</div>`
      : "";
    const footer = lastUpdate || legend ? `<div class="footer">${legend}${lastUpdate ? `<span class="updated">Stand: ${escapeHtml(lastUpdate)}</span>` : ""}</div>` : "";

    this.shadowRoot.innerHTML = `
      <style>${PollenflugCard.styles}</style>
      <ha-card>
        <div class="card ${cfg.show_forecast ? "forecast" : "today-only"}">
          ${cfg.title || chip ? `<div class="header"><div class="title">${escapeHtml(cfg.title || "")}</div>${chip}</div>` : ""}
          <div class="rows">${body}</div>
          ${footer}
        </div>
      </ha-card>`;

    this.shadowRoot.querySelectorAll(".row[data-entity]").forEach((el) => {
      const open = () =>
        this.dispatchEvent(
          new CustomEvent("hass-more-info", { detail: { entityId: el.dataset.entity }, bubbles: true, composed: true })
        );
      el.addEventListener("click", open);
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          open();
        }
      });
    });
  }

  static get styles() {
    return `
      :host { display: block; }
      ha-card { height: 100%; overflow: hidden; }
      .card { padding: 16px 12px 12px; --cols: minmax(96px, 1fr) repeat(3, minmax(30px, 56px)); }
      .card.today-only { --cols: minmax(0, 1fr) minmax(110px, 40%); }
      .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 8px 10px; }
      .title { font-size: var(--ha-card-header-font-size, 1.25rem); font-weight: 500; color: var(--ha-card-header-color, var(--primary-text-color)); line-height: 1.3; }
      .chip {
        flex-shrink: 0; font-size: 0.75rem; font-weight: 600; padding: 4px 10px; border-radius: 999px; white-space: nowrap;
        color: var(--primary-text-color);
        background: color-mix(in srgb, var(--c) 22%, transparent);
        border: 1px solid color-mix(in srgb, var(--c) 55%, transparent);
      }
      .row {
        display: grid; grid-template-columns: var(--cols); column-gap: 8px; align-items: center;
        padding: 7px 8px; border-radius: 12px; outline: none;
      }
      .row[data-entity] { cursor: pointer; transition: background-color 0.15s; }
      .row[data-entity]:hover, .row[data-entity]:focus-visible { background: var(--secondary-background-color, rgba(127,127,127,0.1)); }
      .row.head { padding-top: 0; padding-bottom: 2px; }
      .dayhead { font-size: 0.7rem; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; color: var(--secondary-text-color); text-align: center; }
      .today-only .dayhead { text-align: left; }
      .name-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .icon {
        flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        background: color-mix(in srgb, var(--c) 20%, transparent); color: var(--c);
        --mdc-icon-size: 20px;
      }
      .text { min-width: 0; }
      .name { font-weight: 500; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sub { font-size: 0.8rem; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cell { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .cell-label { font-size: 0.8rem; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; height: 8px; }
      .seg {
        border-radius: 4px;
        background: linear-gradient(to right, var(--c) var(--fill), var(--divider-color, rgba(127,127,127,0.25)) var(--fill));
      }
      .bar.none .seg:first-child { background: linear-gradient(to right, var(--c) 18%, var(--divider-color, rgba(127,127,127,0.25)) 18%); }
      .missing .name { color: var(--error-color, #db4437); }
      .empty { padding: 12px 8px; color: var(--secondary-text-color); line-height: 1.5; }
      .empty.calm { display: flex; align-items: center; gap: 10px; color: var(--primary-text-color); }
      .empty.calm ha-icon { color: #43a047; }
      .footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; padding: 10px 8px 0; font-size: 0.75rem; color: var(--secondary-text-color); }
      .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; }
      .legend span { display: inline-flex; align-items: center; gap: 5px; }
      .legend i { width: 10px; height: 10px; border-radius: 3px; background: var(--c); }
      .updated { margin-left: auto; }
      code { font-family: var(--code-font-family, monospace); }
    `;
  }
}

customElements.define("pollenflug-card", PollenflugCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "pollenflug-card",
  name: "Pollenflug",
  description: "Pollenflugvorhersage des DWD für heute, morgen und übermorgen",
  preview: true,
  documentationURL: "https://github.com/mampfes/hacs_dwd_pollenflug",
});

console.info(`%c POLLENFLUG-CARD %c v${VERSION} `, "color:#fff;background:#fb8c00;font-weight:700", "color:#fb8c00");
