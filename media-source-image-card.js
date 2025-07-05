class MediaSourceImageCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
  }

  _render() {
    if (!this._hass || !this.shadowRoot) {
      return;
    }

    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.data = this._config;
    form.schema = [
      {
        name: "image",
        required: true,
        selector: {
          media: {
            accept: ["image/jpeg", "image/png", "image/gif"]
          },
        },
      },
      {
        name: "entity_id",
        selector: {
          entity: {},
        },
      },
      {
        name: "apply_grayscale",
        selector: {
          boolean: {},
        },
      },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "aspect_ratio", selector: { text: {} } },
          {
            name: "object_fit",
            selector: {
              select: {
                options: ["contain", "cover", "fill", "scale-down", "none"],
              },
            },
          },
        ],
      },
      { name: "object_position", selector: { text: {} } },
      { name: "tap_action", selector: { "ui-action": {} } },
      {
        name: "forced_refresh_interval",
        selector: { number: { min: 0, step: 1, mode: "box" } },
      },
    ];
    form.computeLabel = this._computeLabel;
    form.computeHelper = this._computeHelper;

    form.addEventListener("value-changed", (ev) => {
      const config = ev.detail.value;
      const event = new CustomEvent("config-changed", {
        detail: { config: config },
        bubbles: true,
        composed: true,
      });
      this.dispatchEvent(event);
    });

    this.shadowRoot.innerHTML = "";
    this.shadowRoot.appendChild(form);
  }

  _computeLabel(schema) {
    const labels = {
      image: "Image",
      entity_id: "Entity",
      apply_grayscale: "Apply Grayscale on 'off' state",
      aspect_ratio: "Aspect Ratio",
      object_fit: "Object Fit",
      object_position: "Object Position",
      tap_action: "Tap Action",
      forced_refresh_interval: "Forced Refresh Interval",
    };
    return labels[schema.name] || schema.name;
  }

  _computeHelper(schema) {
    if (schema.name === "forced_refresh_interval") {
      return "In seconds. Useful for images that are dynamically generated.";
    }
    return undefined;
  }
}

customElements.define(
  "media-source-image-card-editor",
  MediaSourceImageCardEditor
);
class MediaSourceImageCard extends HTMLElement {
  static get properties() {
    return {
      hass: {},
      config: {}
    }
  }

  static async getConfigElement() {
    return document.createElement("media-source-image-card-editor");
  }

  static getStubConfig() {
    return { image: "media-source://" };
  }

  renderBase() {
    if (!this.content) {
      this.innerHTML = `
        <style>
            ha-card {
              overflow: hidden;
              height: 100%;
              aspect-ratio: ${this.config.aspect_ratio ? this.config.aspect_ratio : 'auto'};
              display: flex;
              align-content: center;
              justify-content: center;
            }

            ha-card.clickable {
              cursor: pointer;
            }

            img {
              display: block;
              width: 100%;
              object-fit: ${this.config.object_fit ? this.config.object_fit : 'contain'} ;
              object-position: ${this.config.object_position ? this.config.object_position : '50% 50%'} ;
            }

            img.off {
              -webkit-filter: grayscale();
            }

            .error {
              font-size: large;
              color: red;
            }

        </style>
        <ha-card>
          <img src="">
        </ha-card>
      `;
      this.content = this.querySelector("ha-card");
      this.content.addEventListener('click', () => this.handleClick())
    }
  }

  renderTemplate(template) {
    return new Promise(
      resolve => {
        this._hass.connection.subscribeMessage(
          output => {
            return resolve(output.result);
          },
          {
            type: 'render_template',
            template
          }
        );
      }
    );
  }

  renderJsTemplate(template) {
    let _template = template.replace('[[[', '').replace(']]]', '');
    return new Function('hass', 'states', 'user', 'config', `'use strict'; ${_template}`).call(this, this._hass, this._hass.states, this._hass.user, this.config);
  }

  getMediaUrl(url) {
    return new Promise(
      resolve => {
        if (url.indexOf('media-source://') == -1) return resolve({url});
        return resolve(this._hass.callWS({
          type: "media_source/resolve_media",
          media_content_id: url
        }));
      }
    );
  }

  async getImageUrl(image) {
    let imageUrl = image;
    if (image && typeof image === "object") {
      imageUrl = image.media_content_id;
    }
    // if template, resolve rendered template:
    if (imageUrl && imageUrl.indexOf("{{") > -1) return this.getMediaUrl(await this.renderTemplate(imageUrl));
    if (imageUrl && imageUrl.indexOf("[[[") > -1) return this.getMediaUrl(await this.renderJsTemplate(imageUrl));
    // else, call HA service to get media source url:
    return this.getMediaUrl(imageUrl);
  }

  setConfig(config) {
    if (!config.image) {
      throw new Error('You have to provide an url for a media source image');
    }
    this.config = config;
  }

  watchEntities(input, hass) {
    if (!this.entitiesToWatch) this.entitiesToWatch = {};
    if (typeof input !== "string") {
        return false;
    }
    let entities = [...input.matchAll(/[0-9a-zA-z]*\.[0-9a-zA-z]*/g)];
    let hasChanged = false;
    for (const entity of entities.map(e => e[0])) {
      //const _entity = entity[0];
      if (hass.entities[entity]) {
        if (!this.entitiesToWatch[entity]) {
          // new entity found:
          hasChanged = true;
          this.entitiesToWatch[entity] = hass.states[entity].state;
        } else {
          if (this.entitiesToWatch[entity] !== hass.states[entity].state) {
            // existing entity state changed:
            hasChanged = true;
            this.entitiesToWatch[entity] = hass.states[entity].state;
            return true;
          }
        }
      }
    }
    // returns true if there's any new entity or state change:
    return hasChanged;
  }

  renderContent() {
    this.getImageUrl(this.config.image)
    .then(response => {
      if (this.image != response.url) {
        this.image = response.url;
        if (response.url.indexOf('mp4') != -1 || response.url.indexOf('ogg') != -1 || response.url.indexOf('webm') != -1) {
          this.content.innerHTML = `<video width="${this.config.video_options?.width || '320'}" height="${this.config.video_options?.height || '240'}" ${this.config.video_options?.show_controls ? 'controls' : ''} ${this.config.video_options?.loop ? 'loop' : ''} ${this.config.video_options?.autoplay ? 'autoplay' : ''} ${this.config.video_options?.muted ? 'muted' : ''} ${this.config.video_options?.type ? `type=${this.config.video_options?.type}`: ''}><source src="${response.url}" playsInLine></source></video>`;
        } else {
          this.content.innerHTML = `<img src=${response.url} class="${(this.config.entity_id && this.config.apply_grayscale) ? this._hass.states[this.config.entity_id].state : ''}">`;
        }
      }
      })
  }

  set hass(hass) {
    this._hass = hass;
    // render base html and initial content:
    if (!this.content) {
      this.renderBase();
      this.renderContent();
    }
    // when a related entity changes, refresh content:
    if (this.watchEntities(this.config.image, hass)) this.renderContent();
    // if forced_refresh_interval is set, register timeout to re-render content:
    if (this.config.forced_refresh_interval && !this.forced_refresh_interval) {
      this.forced_refresh_interval = setInterval(() => { this.renderContent() }, this.config.forced_refresh_interval * 1000);
    }
    // apply grayscale according to entity state:
    if (this.config.entity_id) {
      const newState = hass.states[this.config.entity_id].state;
      if (this.entity_state != newState) {
        this.entity_state = newState;
        this.onEntityStateChange(newState);
      }
    }
  }

  onEntityStateChange(state) {
    if (this.config.apply_grayscale) {
      if (state == 'off') {
        this.content.querySelector("img")?.setAttribute("class", "off");
      } else {
        this.content.querySelector("img")?.removeAttribute("class", "off");
      }
    }
  }

  handleClick() {
    const event = new Event('hass-action', {
      bubbles: true,
      composed: true
    });
    event.detail = {
      config: {
        entity: this.config.entity_id,
        tap_action: this.config.tap_action
      },
      action: 'tap'
    };
    this.dispatchEvent(event);
  }

  getCardSize() {
    return 1;
  }
}

customElements.define("media-source-image-card", MediaSourceImageCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "media-source-image-card",
  name: "Media Source Image Card",
  description: "A custom card that shows images stored in HA Media Source"
});

console.info(
  `%c  MEDIA SOURCE IMAGE CARD %c Version 0.5.1 `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);
