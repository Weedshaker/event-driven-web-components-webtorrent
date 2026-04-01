// @ts-check

/**
 * Webtorrent
 *
 * @export
 * @param {CustomElementConstructor} [ChosenHTMLElement = HTMLElement]
 * @return {CustomElementConstructor | *}
 */
export default class Webtorrent extends HTMLElement {
  constructor() {
    super()
    
    this.root = this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    if (this.isConnected) this.connectedCallbackOnce()
  }

  connectedCallbackOnce () {
    this.hidden = true
    this.root.appendChild(this.section)
    new Promise(resolve => this.dispatchEvent(new CustomEvent('webtorrent-add', {
      detail: {
        torrentId: this.getAttribute('torrent-id') || Array.from((new URL(location.href)).searchParams).reduce((acc, curr) => curr[0] === 'torrent-id'
          ? `${curr[1]}`
          : `${acc}&${curr[0]}=${curr[1]}`, ''),
        resolve
      },
      bubbles: true,
      cancelable: true,
      composed: true
    }))).then(({torrent}) => {
      const files = []
      let file
      if ((file = torrent.files.find(file => file.name === this.getAttribute('file-name')))) {
        Webtorrent.renderFileTo(file, this, this.section)
      } else {
        Webtorrent.renderFilesTo(torrent, this, this.section)
      }
      this.hidden = false
    })
    // @ts-ignore
    this.connectedCallbackOnce = () => {}
  }

  static renderFilesTo (torrent, webComponent, targetContainer) {
    const results = torrent.files.map((file, i) => Webtorrent.renderFileTo(file, webComponent, targetContainer, i, false))
    const videoResults = results.filter(result => result.tagName === 'video')
    if (videoResults.length === 1) {
      targetContainer.appendChild(videoResults[0].appendTarget)
      results.forEach(({renderTarget, tagName, file}) => {
        if (tagName === 'track') {
          videoResults[0].renderTarget.appendChild(renderTarget)
        } else if (tagName === 'img') {
          videoResults[0].renderTarget.setAttribute('poster', file.streamURL)
        }
      })
    } else {
      results.forEach(({appendTarget, tagName}) => {
        if (tagName === 'track') {
          const videoOrAudio = results.find(result => ['audio', 'video'].includes(result.tagName))
          videoOrAudio.renderTarget.appendChild(appendTarget)
        } else {
          targetContainer.appendChild(appendTarget)
        }
      })
    }
  }

  static renderFileTo (file, webComponent, targetContainer, fileCount, append = true) {
    const tagName = Webtorrent.getTagNameByMimeType(file.type)[0]
    const {renderTarget, appendTarget} = Webtorrent.getElement(webComponent, tagName, file.name, fileCount)
    if (append) targetContainer.appendChild(appendTarget)
    if (tagName === 'a') {
      renderTarget.setAttribute('target', '_blank')
      renderTarget.setAttribute('href', file.streamURL)
      renderTarget.setAttribute('download', file.name)
      renderTarget.textContent = file.name
    } else if (tagName === 'track') {
      renderTarget.setAttribute('src', file.streamURL)
    } else {
      const a = document.createElement('a')
      a.setAttribute('target', '_blank')
      a.setAttribute('href', file.streamURL)
      a.setAttribute('download', file.name)
      a.textContent = file.name
      renderTarget.appendChild(a)
      file.streamTo(renderTarget)
    }
    return {renderTarget, appendTarget, file, tagName}
  }

  static getElement (webComponent, tagName, fileName, fileCount) {
    const {slot, target} = Webtorrent.getSlotAndTarget(tagName, webComponent, fileCount)
    let appendTarget = slot || target
    // figcaption
    if (tagName !== 'a' && tagName !== 'track') {
      const {slot: figcaptionSlot, target: figcaptionTarget} = Webtorrent.getSlotAndTarget('figure', webComponent, fileCount)
      appendTarget = figcaptionSlot || figcaptionTarget
      figcaptionTarget.appendChild(target)
      const figcaption = document.createElement('figcaption')
      figcaption.textContent = fileName
      figcaptionTarget.appendChild(figcaption)
    }
    return {renderTarget: target, appendTarget}
  }

  static getSlotAndTarget (tagName, webComponent, count = 0) {
    let slot, target
    if ((target = webComponent.querySelector(`[slot="${tagName}"]`))) {
      target = target.cloneNode()
      target.hidden = false
      const name = `${tagName}-${count}`
      target.setAttribute('slot', name)
      webComponent.appendChild(target)
      slot = document.createElement('slot')
      slot.setAttribute('name', name)
    } else {
      target = document.createElement(tagName)
    }
    return {slot, target}
  }

  static getTagNameByMimeType (type) {
    return type.includes('image')
      ? ['img', 'src']
      : type.includes('video')
        ? ['video', 'src']
        : type.includes('audio')
          ? ['audio', 'src']
          : type.includes('pdf')
            ? ['embed', 'src']
            : type.includes('stream')
              ? ['track', 'src']
              : ['a', 'href']
  }

  get section () {
    return this._section || (this._section = this.root.querySelector('section')) || (this._section = document.createElement('section'))
  }

  // display trumps hidden property, which we resolve here as well as we allow an animation on show
  set hidden (value) {
    if (!this._cssHidden) {
      /** @type {HTMLStyleElement} */
      this._cssHidden = document.createElement('style')
      this._cssHidden.setAttribute('_cssHidden', '')
      this._cssHidden.setAttribute('protected', 'true') // this will avoid deletion by html=''
      this.root.appendChild(this._cssHidden)
    }
    this._cssHidden.textContent = ''
    value ? this.setAttribute('aria-hidden', 'true') : this.removeAttribute('aria-hidden')
    this._cssHidden.textContent = value
      ? /* css */`
        :host {
          display: block;
          visibility: hidden !important;
        }
      `
      : /* css */`
        :host, :host > *, :host > * > * {
          animation: var(--show, show .3s ease-out);
        }
        @keyframes show {
          0%{opacity: 0}
          100%{opacity: 1}
        }
      `
    super.hidden = value
  }

  get hidden () {
    return super.hidden
  }
}
