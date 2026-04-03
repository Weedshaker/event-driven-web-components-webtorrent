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
    /** @type {{renderTarget, appendTarget, figureTarget, file, tagName}[]} */
    this.webtorrentTargetElements = []

    let errorCounter = 0
    let errorTimeoutID
    this.errorEventListener = event => {
      if (event.target.tagName === 'TRACK') return
      console.warn('Webtorrent view error:', event)
      clearTimeout(errorTimeoutID)
      errorTimeoutID = setTimeout(() => {
        this.webtorrentTargetElements.forEach(({renderTarget, appendTarget, figureTarget}) => {
          renderTarget.remove()
          appendTarget.remove()
          figureTarget?.remove()
        })
        this.clonedElements.forEach(element => element.remove())
        this.section.innerHTML = ''
        this.init(errorCounter)
        errorCounter++
      }, 2000)
    }
  }

  init (errorCounter) {
    this.hidden = true
    // TODO: Loading while waiting for torrent to resolve
    // TODO: Check for navigator.onLine, since offline will prevent torrent to be issued
    new Promise(resolve => this.dispatchEvent(new CustomEvent('webtorrent-add', {
      detail: {
        torrentId: this.getAttribute('torrent-id') || Array.from((new URL(location.href)).searchParams).reduce((acc, curr) => curr[0] === 'torrent-id'
          ? `${curr[1]}`
          : `${acc}&${curr[0]}=${curr[1]}`, ''),
        destroy: errorCounter > 2,
        resolve
      },
      bubbles: true,
      cancelable: true,
      composed: true
    }))).then(({torrent, streamToServerReadyPromise}) => {
      const tagName = errorCounter > 3 ? 'a' : ''
      let file
      if ((file = torrent.files.find(file => file.name === this.getAttribute('file-name')))) {
        this.webtorrentTargetElements.push(Webtorrent.renderFileTo(file, this, this.section, streamToServerReadyPromise, undefined, tagName))
      } else {
        this.webtorrentTargetElements = this.webtorrentTargetElements.concat(Webtorrent.renderFilesTo(torrent, this, this.section, streamToServerReadyPromise, tagName))
      }
      this.webtorrentTargetElements.forEach(({renderTarget}) => renderTarget.addEventListener('error', this.errorEventListener))
      this.hidden = false
    })
  }

  connectedCallback() {
    this.webtorrentTargetElements.forEach(({renderTarget}) => renderTarget.addEventListener('error', this.errorEventListener))
    if (this.isConnected) this.connectedCallbackOnce()
  }

  connectedCallbackOnce () {
    this.root.appendChild(this.section)
    this.init()
    // @ts-ignore
    this.connectedCallbackOnce = () => {}
  }

  disconnectedCallback () {
    this.webtorrentTargetElements.forEach(({renderTarget}) => renderTarget.removeEventListener('error', this.errorEventListener))
  }

  static renderFilesTo (torrent, webComponent, targetContainer, streamToServerReadyPromise, tagName) {
    const results = torrent.files.map((file, i) => Webtorrent.renderFileTo(file, webComponent, targetContainer, streamToServerReadyPromise, i, tagName, false))
    const videoResults = results.filter(result => result.tagName === 'video')
    if (videoResults.length === 1) {
      targetContainer.appendChild(videoResults[0].appendTarget)
      results.forEach(({renderTarget, appendTarget, figureTarget, tagName, file}) => {
        if (tagName === 'track') {
          videoResults[0].renderTarget.appendChild(renderTarget)
        } else if (tagName === 'img') {
          renderTarget.remove()
          appendTarget.remove()
          figureTarget?.remove()
          if (streamToServerReadyPromise.done) {
            videoResults[0].renderTarget.setAttribute('poster', file.streamURL)
          } else {
            file.blob().then(blob => videoResults[0].renderTarget.setAttribute('poster', URL.createObjectURL(blob)))
          }
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
    return results
  }

  static renderFileTo (file, webComponent, targetContainer, streamToServerReadyPromise, fileCount, tagName = '', append = true) {
    // streamTo and streamURL only work when service worker is up and running
    const setHref = target => {
      if (streamToServerReadyPromise.done) {
        target.setAttribute('href', file.streamURL)
      } else {
        file.blob().then(blob => target.setAttribute('href', URL.createObjectURL(blob)))
      }
    }
    let targetAttribute
    if (!tagName) [tagName, targetAttribute] = Webtorrent.getTagNameByMimeType(file.type)
    const {renderTarget, appendTarget, figureTarget} = Webtorrent.getElement(webComponent, tagName, file.name, fileCount)
    if (append) targetContainer.appendChild(appendTarget)
    if (tagName === 'a') {
      renderTarget.setAttribute('target', '_blank')
      setHref(renderTarget)
      renderTarget.setAttribute('download', file.name)
      renderTarget.textContent = file.name
    } else if (tagName === 'track') {
      setHref(renderTarget)
    } else {
      const a = document.createElement('a')
      a.setAttribute('target', '_blank')
      setHref(a)
      a.setAttribute('download', file.name)
      a.textContent = file.name
      renderTarget.appendChild(a)
      if (streamToServerReadyPromise.done) {
        file.streamTo(renderTarget)
      } else {
        file.blob().then(blob => renderTarget.setAttribute(targetAttribute || 'src', URL.createObjectURL(blob)))
      }
    }
    return {renderTarget, appendTarget, figureTarget, file, tagName}
  }

  // create the element by tagname and wrap it into a figure when applicable
  static getElement (webComponent, tagName, fileName, fileCount) {
    const {slot, target} = Webtorrent.getSlotAndTarget(tagName, webComponent, fileCount)
    let appendTarget = slot || target
    let figureTarget
    // figcaption
    if (tagName !== 'a' && tagName !== 'track') {
      const {slot: figureSlot, target: figure} = Webtorrent.getSlotAndTarget('figure', webComponent, fileCount)
      figureTarget = figure
      appendTarget = figureSlot || figureTarget
      figureTarget.appendChild(target)
      const figcaption = document.createElement('figcaption')
      figcaption.textContent = fileName
      figureTarget.appendChild(figcaption)
    }
    return {renderTarget: target, appendTarget, figureTarget}
  }

  // check if there is a target element with attribute slot, and if so make a clone for this element
  static getSlotAndTarget (tagName, webComponent, count = 0) {
    let slot, target
    if ((target = webComponent.querySelector(`[slot="${tagName}"]`))) {
      target = target.cloneNode()
      target.setAttribute('is-clone', '')
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

  get clonedElements () {
    return Array.from(this.querySelectorAll('[is-clone]'))
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
