/*
 * Pollenflug Card für Home Assistant
 * Zeigt die Pollenflugvorhersage des DWD (heute, morgen, übermorgen) an.
 *
 * Standardmäßig passend zur HACS-Integration "DWD Pollenflug" (mampfes/hacs_dwd_pollenflug):
 *   state            -> Belastung heute (0 … 3 in 0,5er-Schritten)
 *   state_tomorrow   -> Belastung morgen
 *   state_in_2_days  -> Belastung übermorgen
 */

const VERSION = "1.1.0";

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

const DEFAULTS = {
  title: "Pollenflug",
  show_forecast: true,
  hide_inactive: false,
  show_legend: false,
  show_last_update: true,
  sort: "level",
  entity_prefix: "sensor.pollenflug_",
};

const SORT_OPTIONS = {
  level: "Stärkste Belastung zuerst",
  name: "Alphabetisch",
  none: "Wie ausgewählt",
};

const clampLevel = (n) => Math.min(3, Math.max(0, Math.round(n * 2) / 2));

// null = keine Daten. Negative Werte (DWD: "-1") bedeuten "keine Vorhersage für diesen Tag".
function parseLevel(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? clampLevel(raw) : null;
  const s = String(raw).trim().replace(/,/g, ".");
  if (!s || s === "unknown" || s === "unavailable") return null;
  // DWD-Schreibweise "1-2" => 1,5
  const range = s.match(/^(\d(?:\.\d+)?)\s*-\s*(\d(?:\.\d+)?)$/);
  if (range) return clampLevel((parseFloat(range[1]) + parseFloat(range[2])) / 2);
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? clampLevel(n) : null;
}

const levelInfo = (level) =>
  level === null ? { label: "keine Daten", color: "var(--disabled-text-color, #9e9e9e)" } : LEVELS[level * 2];

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function findPollen(text) {
  const t = text.toLowerCase().replace(/ä/g, "ae").replace(/ß/g, "ss");
  return POLLEN.find((p) => p.keys.some((k) => t.includes(k)));
}

const regionOf = (entityId) => (entityId.match(/_(\d+)$/) || [])[1] || null;

// Alle Pollen-Sensoren mit passendem Präfix, optional nur aus einer Region
function discoverEntities(hass, prefix, region) {
  if (!hass) return [];
  const wanted = region ? String(region).trim() : null;
  return Object.keys(hass.states)
    .filter((id) => id.startsWith((prefix && prefix.trim()) || DEFAULTS.entity_prefix))
    .filter((id) => !wanted || regionOf(id) === wanted)
    .sort();
}

function pollenDisplay(hass, entityId) {
  const stateObj = hass && hass.states[entityId];
  const friendly = (stateObj && stateObj.attributes.friendly_name) || "";
  const pollen = findPollen(entityId) || findPollen(friendly);
  return {
    name: pollen ? pollen.name : friendly || entityId,
    icon: pollen ? pollen.icon : (stateObj && stateObj.attributes.icon) || "mdi:flower-pollen",
  };
}

class PollenflugCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("pollenflug-card-editor");
  }

  static getStubConfig() {
    return { title: DEFAULTS.title };
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
      ...DEFAULTS,
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
    return discoverEntities(this._hass, cfg.entity_prefix, cfg.region).map((entity) => ({ entity }));
  }

  _readAttribute(stateObj, day) {
    const configured = this._config.attributes[day];
    const keys = configured && configured.trim() ? [configured.trim()] : DEFAULT_ATTRIBUTES[day];
    for (const key of keys) {
      if (stateObj.attributes[key] !== undefined) return parseLevel(stateObj.attributes[key]);
    }
    return null;
  }

  _buildRows() {
    return this._entityConfigs().map((ec, index) => {
      const stateObj = this._hass.states[ec.entity];
      if (!stateObj) return { entity: ec.entity, missing: true, name: ec.name || ec.entity, index };
      const display = pollenDisplay(this._hass, ec.entity);
      const days = [parseLevel(stateObj.state)];
      if (this._config.show_forecast) {
        days.push(this._readAttribute(stateObj, "tomorrow"), this._readAttribute(stateObj, "day_after"));
      }
      return {
        entity: ec.entity,
        name: (ec.name && ec.name.trim()) || display.name,
        icon: ec.icon || display.icon,
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
    return ["Heute", "Morgen", weekday];
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
    const cells = this._dayIdx
      .map((i) => {
        const level = row.days[i];
        const info = levelInfo(level);
        const label = this._dayLabelsCache[i];
        return `<div class="cell" title="${escapeHtml(`${label}: ${info.label}`)}">
          ${this._renderBar(level)}
          ${this._forecast ? "" : `<span class="cell-label">${escapeHtml(info.label)}</span>`}
        </div>`;
      })
      .join("");
    return `<div class="row" data-entity="${escapeHtml(row.entity)}" role="button" tabindex="0">
      <div class="name-cell">
        <div class="icon" style="--c:${today.color}"><ha-icon icon="${escapeHtml(row.icon)}"></ha-icon></div>
        <div class="text">
          <div class="name">${escapeHtml(row.name)}</div>
          ${this._forecast ? `<div class="sub">${escapeHtml(desc)}</div>` : ""}
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

    // Vorhersagetage, für die kein Sensor Daten liefert (z. B. nur heute + morgen), ganz ausblenden
    this._dayIdx = [0];
    if (cfg.show_forecast) {
      for (const i of [1, 2]) {
        if (rows.some((r) => !r.missing && r.days[i] !== null)) this._dayIdx.push(i);
      }
    }
    this._forecast = this._dayIdx.length > 1;

    const maxToday = rows.reduce((max, r) => (r.missing || r.days[0] === null ? max : Math.max(max, r.days[0])), -1);
    const chip =
      maxToday >= 0
        ? `<span class="chip" style="--c:${levelInfo(maxToday).color}">${maxToday > 0 ? `Heute ${escapeHtml(levelInfo(maxToday).label)}` : "Heute keine Belastung"}</span>`
        : "";

    let body;
    if (totalRows === 0) {
      body = `<div class="empty">Keine Pollenflug-Sensoren gefunden.<br>Installiere die Integration „DWD Pollenflug“ oder wähle die Sensoren im Karten-Editor aus.</div>`;
    } else if (rows.length === 0) {
      body = `<div class="empty calm"><ha-icon icon="mdi:emoticon-happy-outline"></ha-icon><span>Aktuell kein Pollenflug – durchatmen!</span></div>`;
    } else {
      const heads = this._dayIdx.map((i) => `<div class="dayhead">${escapeHtml(this._dayLabelsCache[i])}</div>`).join("");
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
        <div class="card ${this._forecast ? "forecast" : "today-only"}" style="--days:${this._dayIdx.length}">
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
      .card { padding: 16px 12px 12px; --cols: minmax(96px, 1fr) repeat(var(--days, 3), minmax(30px, 56px)); }
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

/* ---------------------------------------------------------------------------
 * Visueller Editor: alles per UI einstellbar, kein YAML nötig
 * ------------------------------------------------------------------------- */

const EDITOR_LABELS = {
  title: "Titel",
  mode: "Welche Pollen sollen angezeigt werden?",
  region: "Region",
  entity: "Sensor",
  name: "Eigener Name (optional)",
  icon: "Eigenes Symbol (optional)",
  add_entity: "Pollen-Sensor hinzufügen",
  show_forecast: "Vorhersage für morgen und übermorgen",
  hide_inactive: "Pollen ohne Belastung ausblenden",
  show_legend: "Farblegende anzeigen",
  show_last_update: "Datenstand anzeigen",
  sort: "Reihenfolge",
  entity_prefix: "Anfang der Sensor-IDs (automatische Suche)",
  tomorrow_attribute: "Attribut für morgen",
  day_after_attribute: "Attribut für übermorgen",
};

const EDITOR_HELPERS = {
  show_forecast: "Tage, für die der Sensor keine Vorhersage liefert, werden automatisch ausgeblendet",
  entity_prefix: `Standard: ${DEFAULTS.entity_prefix}`,
  tomorrow_attribute: "Leer lassen für DWD Pollenflug (state_tomorrow)",
  day_after_attribute: "Leer lassen für DWD Pollenflug (state_in_2_days)",
};

function regionLabel(hass, entityId, region) {
  const deviceId = hass.entities && hass.entities[entityId] && hass.entities[entityId].device_id;
  const device = deviceId && hass.devices && hass.devices[deviceId];
  const name = device && (device.name_by_user || device.name);
  return name ? `${name} (${region})` : `Region ${region}`;
}

class PollenflugCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    this._config = { ...config };
    if (!this._mode) this._mode = Array.isArray(config.entities) && config.entities.length ? "manual" : "auto";
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  _entities() {
    return (this._config.entities || [])
      .map((e) => (typeof e === "string" ? { entity: e } : { ...e }))
      .filter((e) => e.entity);
  }

  _set(changes) {
    const config = { ...this._config, ...changes };
    for (const [key, value] of Object.entries(changes)) {
      const isDefault = key !== "title" && key in DEFAULTS && value === DEFAULTS[key];
      if (value === undefined || isDefault || (value === "" && key !== "title")) delete config[key];
    }
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
    this._update();
  }

  _setEntities(list) {
    this._set({
      entities: list.map((e) => (e.name || e.icon ? Object.fromEntries(Object.entries(e).filter(([, v]) => v)) : e.entity)),
    });
  }

  _switchMode(mode) {
    this._mode = mode;
    if (mode === "manual") {
      // Mit den aktuell angezeigten Sensoren starten, dann kann man einfach Unpassendes entfernen
      const found = discoverEntities(this._hass, this._config.entity_prefix, this._config.region);
      this._set({ entities: found, region: undefined });
    } else {
      this._set({ entities: undefined });
    }
  }

  _regionOptions() {
    const regions = new Map();
    for (const id of discoverEntities(this._hass, this._config.entity_prefix)) {
      const region = regionOf(id);
      if (region && !regions.has(region)) regions.set(region, regionLabel(this._hass, id, region));
    }
    const current = this._config.region !== undefined ? String(this._config.region) : null;
    if (current && !regions.has(current)) regions.set(current, `Region ${current}`);
    return [
      { value: "all", label: "Alle Regionen" },
      ...[...regions.entries()].sort((a, b) => a[1].localeCompare(b[1], "de")).map(([value, label]) => ({ value, label })),
    ];
  }

  _generalSchema() {
    const schema = [
      { name: "title", selector: { text: {} } },
      {
        name: "mode",
        selector: {
          select: {
            mode: "list",
            options: [
              { value: "auto", label: "Alle gefundenen Pollen-Sensoren" },
              { value: "manual", label: "Nur ausgewählte Sensoren (z. B. deine Allergene)" },
            ],
          },
        },
      },
    ];
    if (this._mode === "auto") {
      schema.push({ name: "region", selector: { select: { mode: "dropdown", options: this._regionOptions() } } });
    }
    return schema;
  }

  _displaySchema() {
    return [
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
          select: { mode: "dropdown", options: Object.entries(SORT_OPTIONS).map(([value, label]) => ({ value, label })) },
        },
      },
      {
        type: "expandable",
        name: "",
        flatten: true,
        title: "Erweitert (nur für andere Datenquellen nötig)",
        schema: [
          { name: "entity_prefix", selector: { text: {} } },
          { name: "tomorrow_attribute", selector: { text: {} } },
          { name: "day_after_attribute", selector: { text: {} } },
        ],
      },
    ];
  }

  // Schema nur bei echten Änderungen neu setzen, damit ha-form nicht unnötig neu aufbaut
  _assignSchema(form, schema) {
    const key = JSON.stringify(schema);
    if (form._schemaKey === key) return;
    form._schemaKey = key;
    form.schema = schema;
  }

  _createForm(onChange) {
    const form = document.createElement("ha-form");
    form.computeLabel = (schema) => EDITOR_LABELS[schema.name] || schema.name;
    form.computeHelper = (schema) => EDITOR_HELPERS[schema.name];
    form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      onChange(ev.detail.value || {});
    });
    return form;
  }

  _build() {
    this.shadowRoot.innerHTML = `
      <style>${PollenflugCardEditor.styles}</style>
      <div class="section" id="general"></div>
      <div class="section" id="manual">
        <div class="section-title">Ausgewählte Sensoren</div>
        <div class="hint" id="manual-hint"></div>
        <div id="rows"></div>
        <div id="add"></div>
      </div>
      <div class="section" id="display">
        <div class="section-title">Darstellung</div>
      </div>`;

    this._generalForm = this._createForm((v) => {
      if (v.mode && v.mode !== this._mode) return this._switchMode(v.mode);
      const changes = { title: v.title === undefined ? "" : v.title };
      if (this._mode === "auto") changes.region = v.region && v.region !== "all" ? v.region : undefined;
      this._set(changes);
    });
    this.shadowRoot.getElementById("general").appendChild(this._generalForm);

    this._addForm = this._createForm((v) => {
      if (!v.add_entity) return;
      this._addForm.data = {};
      this._setEntities([...this._entities(), { entity: v.add_entity }]);
    });
    this.shadowRoot.getElementById("add").appendChild(this._addForm);

    this._displayForm = this._createForm((v) => {
      const attributes = {};
      if (v.tomorrow_attribute) attributes.tomorrow = v.tomorrow_attribute;
      if (v.day_after_attribute) attributes.day_after = v.day_after_attribute;
      this._set({
        show_forecast: v.show_forecast,
        hide_inactive: v.hide_inactive,
        show_legend: v.show_legend,
        show_last_update: v.show_last_update,
        sort: v.sort,
        entity_prefix: v.entity_prefix || undefined,
        attributes: Object.keys(attributes).length ? attributes : undefined,
      });
    });
    this.shadowRoot.getElementById("display").appendChild(this._displayForm);
    this._built = true;
  }

  _update() {
    if (!this._config || !this._hass) return;
    if (!this._built) this._build();
    const cfg = this._config;
    const entities = this._entities();

    this._generalForm.hass = this._hass;
    this._assignSchema(this._generalForm, this._generalSchema());
    this._generalForm.data = {
      title: cfg.title !== undefined ? cfg.title : DEFAULTS.title,
      mode: this._mode,
      region: cfg.region !== undefined && cfg.region !== "" ? String(cfg.region) : "all",
    };

    const manual = this.shadowRoot.getElementById("manual");
    manual.hidden = this._mode !== "manual";
    this.shadowRoot.getElementById("manual-hint").textContent = entities.length
      ? "Mit den Pfeilen legst du die Reihenfolge fest (gilt bei „Wie ausgewählt“)."
      : "Noch keine Sensoren ausgewählt – bis dahin zeigt die Karte alle gefundenen an.";
    this._syncRows(entities);

    this._addForm.hass = this._hass;
    this._assignSchema(this._addForm, [
      {
        name: "add_entity",
        selector: { entity: { filter: { domain: "sensor" }, exclude_entities: entities.map((e) => e.entity) } },
      },
    ]);
    if (!this._addForm.data) this._addForm.data = {};

    const attributes = cfg.attributes || {};
    this._displayForm.hass = this._hass;
    this._assignSchema(this._displayForm, this._displaySchema());
    this._displayForm.data = {
      ...DEFAULTS,
      ...cfg,
      tomorrow_attribute: attributes.tomorrow || "",
      day_after_attribute: attributes.day_after || "",
    };
  }

  _syncRows(entities) {
    const rowsEl = this.shadowRoot.getElementById("rows");
    const key = entities.map((e) => e.entity).join("|");
    // Zeilen nur bei Struktur-Änderungen neu aufbauen, damit Eingabefelder den Fokus behalten
    if (key !== this._rowsKey) {
      this._rowsKey = key;
      rowsEl.innerHTML = "";
      entities.forEach((e, i) => rowsEl.appendChild(this._createRow(e, i, entities.length)));
    }
    [...rowsEl.children].forEach((row, i) => {
      const display = pollenDisplay(this._hass, entities[i].entity);
      row.querySelector(".row-title").textContent = entities[i].name || display.name;
      row.querySelector(".row-icon").setAttribute("icon", entities[i].icon || display.icon);
      row.form.hass = this._hass;
      row.form.data = { entity: entities[i].entity, name: entities[i].name || "", icon: entities[i].icon || "" };
    });
  }

  _createRow(entry, index, count) {
    const display = pollenDisplay(this._hass, entry.entity);
    const row = document.createElement("div");
    row.className = "entity-row";
    row.innerHTML = `
      <div class="row-head">
        <ha-icon class="row-icon" icon="${escapeHtml(entry.icon || display.icon)}"></ha-icon>
        <span class="row-title">${escapeHtml(entry.name || display.name)}</span>
        <button class="icon-btn" data-act="up" title="Nach oben" ${index === 0 ? "disabled" : ""}><ha-icon icon="mdi:arrow-up"></ha-icon></button>
        <button class="icon-btn" data-act="down" title="Nach unten" ${index === count - 1 ? "disabled" : ""}><ha-icon icon="mdi:arrow-down"></ha-icon></button>
        <button class="icon-btn" data-act="remove" title="Entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
      </div>`;
    row.form = this._createForm((v) => {
      const list = this._entities();
      if (!v.entity) list.splice(index, 1);
      else list[index] = { entity: v.entity, name: v.name || "", icon: v.icon || "" };
      this._setEntities(list);
    });
    row.form.schema = [
      { name: "entity", selector: { entity: { filter: { domain: "sensor" } } } },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "name", selector: { text: {} } },
          { name: "icon", selector: { icon: { placeholder: display.icon } } },
        ],
      },
    ];
    row.appendChild(row.form);
    row.querySelectorAll("button").forEach((btn) =>
      btn.addEventListener("click", () => {
        const list = this._entities();
        const target = btn.dataset.act === "up" ? index - 1 : index + 1;
        if (btn.dataset.act === "remove") list.splice(index, 1);
        else [list[index], list[target]] = [list[target], list[index]];
        this._setEntities(list);
      })
    );
    return row;
  }

  static get styles() {
    return `
      :host { display: block; }
      .section { margin-bottom: 24px; }
      .section[hidden] { display: none; }
      .section-title { font-weight: 500; font-size: 1rem; color: var(--primary-text-color); margin: 0 0 8px; }
      .hint { font-size: 0.875rem; color: var(--secondary-text-color); margin-bottom: 12px; }
      .entity-row {
        border: 1px solid var(--divider-color, rgba(127,127,127,0.25)); border-radius: 12px;
        padding: 6px 12px 12px; margin-bottom: 10px;
      }
      .row-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
      .row-icon { color: var(--secondary-text-color); --mdc-icon-size: 20px; margin-right: 4px; }
      .row-title { flex: 1; font-weight: 500; color: var(--primary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .icon-btn {
        display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0;
        border: none; border-radius: 50%; background: none; cursor: pointer;
        color: var(--secondary-text-color); --mdc-icon-size: 20px;
      }
      .icon-btn:hover:not(:disabled) { background: var(--secondary-background-color, rgba(127,127,127,0.1)); color: var(--primary-text-color); }
      .icon-btn:disabled { opacity: 0.3; cursor: default; }
    `;
  }
}

customElements.define("pollenflug-card", PollenflugCard);
customElements.define("pollenflug-card-editor", PollenflugCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "pollenflug-card",
  name: "Pollenflug",
  description: "Pollenflugvorhersage des DWD für heute, morgen und übermorgen",
  preview: true,
  documentationURL: "https://github.com/Ga-Re/Pollenflug",
});

console.info(`%c POLLENFLUG-CARD %c v${VERSION} `, "color:#fff;background:#fb8c00;font-weight:700", "color:#fb8c00");
