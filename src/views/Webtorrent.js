// @ts-check
import { Intersection } from '../event-driven-web-components-prototypes/src/Intersection.js'

/**
 * Webtorrent
 * TODO: rebuild all webTorrent desktop controls
 *
 * @export
 * @param {CustomElementConstructor} [ChosenHTMLElement = HTMLElement]
 * @return {CustomElementConstructor | *}
 */
export default class Webtorrent extends Intersection() {
  constructor(options = {}, ...args) {
    super({ importMetaUrl: import.meta.url, tabindex: 'no-tabindex', intersectionObserverInit: {}, ...options }, ...args)
    
    /** @type {{renderTarget, appendTarget, figureTarget, file, tagName}[]} */
    this.webtorrentTargetElements = []

    let errorCounter = 0
    let errorTimeoutID
    this.errorEventListener = event => {
      if (event.target?.tagName === 'TRACK') return
      console.warn('Webtorrent view error:', event, event.target, ':is webworker active?')
      clearTimeout(errorTimeoutID)
      errorTimeoutID = setTimeout(() => {
        // clear previous elements
        this.webtorrentTargetElements.forEach(({renderTarget, appendTarget, figureTarget}) => {
          renderTarget.remove()
          appendTarget.remove()
          figureTarget?.remove()
        })
        this.webtorrentTargetElements = []
        this.clonedElements.forEach(element => element.remove())
        this.summary.innerHTML = ''
        Array.from(this.progress.children).forEach(child => (child.innerHTML = ''))
        // reset counter after 5
        this.init(errorCounter % 6)
        errorCounter++
      }, 2000)
    }

    // Avoid DOM performance issues
    this.updateHeight = () => {
      clearTimeout(this._timeoutUpdateHeight)
      this._timeoutUpdateHeight = setTimeout(() => {
        this.removeAttribute('has-height')
        this.customStyleHeight.textContent = ''
        self.requestAnimationFrame(timeStamp => {
          this.customStyleHeight.textContent = /* css */`
          :host([has-height]:not([intersecting])) {
            min-height: ${this.offsetHeight}px;
          }
        `
          this.setAttribute('has-height', '')
        })
      }, 350)
    }

    this.detailsToggleEventListener = event => this.updateHeight()

    this.resetLinkEventListener = event => {
      event.preventDefault()
      event.stopPropagation()
      this.errorEventListener(event)
    }

    // this updates the min-height on resize, see updateHeight function for more info
    let resizeTimeout = null
    this.resizeEventListener = event => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(async () => this.updateHeight(), 200)
    }
  }

  // video/img/audio nodes can emit error's, so the first three errors we just reset those
  // errorCounter starts with 0-2 normal reload of html nodes, 3 reset torrent, 4 render to link instead of video/img/audio, 5 reset OPFS storage and then starts from 0 again.
  init (errorCounter) {
    const {appendTarget: progressTarget, renderTarget: progressElement} = Webtorrent.getElement(this, 'progress', 'initializing...', 'progress', false)
    progressTarget.setAttribute('max', '100')
    let prevElement
    if ((prevElement = this.summary.querySelector(`[name="${progressTarget.getAttribute('name')}"]`))) prevElement.remove()
    this.progressBar.appendChild(progressTarget)
    new Promise(resolve => this.dispatchEvent(new CustomEvent('webtorrent-add', {
      detail: {
        torrentId: this.getAttribute('torrent-id') || encodeURI(Array.from((new URL(location.href)).searchParams).reduce((acc, curr) => curr[0] === 'torrent-id'
          ? `${curr[1]}`
          : `${acc}&${curr[0]}=${curr[1]}`, '')),
        destroyOpts: errorCounter > 4 ? {destroyStore: true} : errorCounter > 2 ? {destroyStore: false} : false,
        resolve
      },
      bubbles: true,
      cancelable: true,
      composed: true
    }))).then(({torrent, streamToServerReadyPromise}) => {
      torrent.on('error', this.errorEventListener)
      let videosPlaying = []
      this.doOnIntersection = () => {
        clearInterval(this.intervalID)
        this.intervalID = setInterval(() => {
          if (torrent.done) clearInterval(this.intervalID);
          progressElement.setAttribute('value', 100 * torrent.progress)
          this.progressText.textContent = `${(100 * torrent.progress).toFixed(1)}%`;
          if (!this.hasAttribute('no-video-auto-pause')) videosPlaying.forEach(video => video.play())
        }, 200)
      }
      if (this.hasAttribute('intersecting')) this.doOnIntersection()
      this.doOffIntersection = () => {
        if (!this.hasAttribute('no-video-auto-pause')) (videosPlaying = this.videos.filter(video => !video.paused)).forEach(video => video.pause())
        clearInterval(this.intervalID)
      }
      const tagName = errorCounter > 3 ? 'a' : ''
      let file
      if ((file = torrent.files.find(file => file.name === this.getAttribute('file-name')))) {
        this.webtorrentTargetElements.push(Webtorrent.renderFileTo(file, this, this.summary, streamToServerReadyPromise, undefined, this.updateHeight, tagName))
      } else {
        this.webtorrentTargetElements = this.webtorrentTargetElements.concat(Webtorrent.renderFilesTo(torrent, this, this.summary, streamToServerReadyPromise, tagName, this.updateHeight))
      }
      this.webtorrentTargetElements.forEach(({renderTarget}) => renderTarget.addEventListener('error', this.errorEventListener))
    })
  }

  connectedCallback() {
    super.connectedCallback()
    this.hidden = true
    const showPromises = []
    if (this.shouldRenderCSS()) showPromises.push(this.renderCSS())
    if (this.shouldRenderHTML()) showPromises.push(this.renderHTML())
    Promise.all(showPromises).then(() => {
      this.hidden = false
      this.updateHeight()
    })
    if (this.isConnected) this.connectedCallbackOnce()
    this.details.addEventListener('toggle', this.detailsToggleEventListener)
    this.resetLink.addEventListener('click', this.resetLinkEventListener)
    self.addEventListener('resize', this.resizeEventListener)
  }

  connectedCallbackOnce () {
    this.init()
    // @ts-ignore
    this.connectedCallbackOnce = () => {}
  }

  disconnectedCallback () {
    super.disconnectedCallback()
    this.details.removeEventListener('toggle', this.detailsToggleEventListener)
    this.resetLink.removeEventListener('click', this.resetLinkEventListener)
    self.removeEventListener('resize', this.resizeEventListener)
  }

  intersectionCallback (entries, observer) {
    if (this.areEntriesIntersecting(entries)) {
      this.setAttribute('intersecting', '')
      if (this.hidden) this.hidden = false
      if (this.doOnIntersection) this.doOnIntersection()
      return
    }
    if (this.doOffIntersection) this.doOffIntersection()
    this.removeAttribute('intersecting')
  }

  /**
   * evaluates if a render is necessary
   *
   * @return {boolean}
   */
  shouldRenderCSS () {
    return !this.root.querySelector(`${this.cssSelector} > style[_css]`)
  }

  /**
   * evaluates if a render is necessary
   *
   * @return {boolean}
   */
  shouldRenderHTML () {
    return !this.details
  }

  /**
   * renders the css
   *
   * @return {Promise<void>}
   */
  renderCSS () {
    this.css = /* css */`
      ::slotted(video), ::slotted(audio), ::slotted(img), :where(video, audio, img) {
        height: auto;
        width: 100%;
      }
      ::slotted([id=reset]) {
        cursor: pointer;
      }
      :host {
        display: block;
      }
      :host([has-height]:not([intersecting])) > details {
        display: none;
      }
      @media only screen and (max-width: _max-width_) {
        
      }
    `
    return this.fetchTemplate()
  }

  /**
   * fetches the template
   * extend class and overwrite this function to feed your own css template
   *
   * @return {Promise<void>}
   */
  fetchTemplate () {
    switch (this.getAttribute('namespace')) {
      default:
        return Promise.resolve()
    }
  }

  /**
   * Render HTML
   * @prop {string} nickname
   * @returns Promise<void>
   */
  renderHTML (nickname) {
    this.html = /* html */`
      <details ${this.hasAttribute('open') ? 'open' : ''}>
        <summary></summary>
        <div id=controls>
          <div id=progress>
            <div id=progress-bar></div>
            <div id=progress-text></div>
          </div>
          <a id=reset-link><slot name=reset></slot></a>
        </div>
      </details>
    `
    this.html = this.customStyleHeight
    return Promise.resolve()
  }

  static renderFilesTo (torrent, webComponent, targetContainer, streamToServerReadyPromise, tagName, updateHeightFunc) {
    const results = torrent.files.map((file, i) => Webtorrent.renderFileTo(file, webComponent, targetContainer, streamToServerReadyPromise, i, updateHeightFunc, tagName, false))
    const videoResults = results.filter(result => result.tagName === 'video')
    if (videoResults.length === 1) {
      targetContainer.prepend(videoResults[0].appendTarget)
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
          targetContainer.prepend(appendTarget)
        }
      })
    }
    return results
  }

  static renderFileTo (file, webComponent, targetContainer, streamToServerReadyPromise, fileCount, updateHeightFunc, tagName = '', append = true) {
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
    if (append) targetContainer.prepend(appendTarget)
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
      renderTarget.prepend(a)
      if (streamToServerReadyPromise.done) {
        file.streamTo(renderTarget)
      } else {
        file.blob().then(blob => renderTarget.setAttribute(targetAttribute || 'src', URL.createObjectURL(blob)))
      }
    }
    file.on('stream', updateHeightFunc)
    file.on('done', updateHeightFunc)
    return {renderTarget, appendTarget, figureTarget, file, tagName}
  }

  /**
   * create the element by tagname and wrap it into a figure when applicable
   * 
   * @static
   * @param {any} webComponent
   * @param {string} tagName
   * @param {string} fileName
   * @param {number|string} fileCount
   * @param {boolean} [useFigure=undefined]
   * @returns {{ renderTarget: any; appendTarget: any; figureTarget: any; }}
   */
  static getElement (webComponent, tagName, fileName, fileCount, useFigure = undefined) {
    const {slot, target} = Webtorrent.getSlotAndTarget(tagName, webComponent, fileCount)
    let appendTarget = slot || target
    let figureTarget
    // figcaption
    if (useFigure === true || (useFigure !== false && tagName !== 'a' && tagName !== 'track')) {
      const {slot: figureSlot, target: figure} = Webtorrent.getSlotAndTarget('figure', webComponent, fileCount)
      figureTarget = figure
      appendTarget = figureSlot || figureTarget
      figureTarget.appendChild(figureSlot ? target : slot || target)
      const figcaption = document.createElement('figcaption')
      figcaption.textContent = fileName
      figureTarget.appendChild(figcaption)
    }
    return {renderTarget: target, appendTarget, figureTarget}
  }

  /**
   * check if there is a target element with attribute slot, and if so make a clone for this element
   * 
   * @static
   * @param {string} tagName
   * @param {HTMLElement} webComponent
   * @param {number|string} count?
   * @returns {{ slot: HTMLSlotElement | undefined; target: any; }}
   */
  static getSlotAndTarget (tagName, webComponent, count = 0) {
    let slot, target
    if ((target = webComponent.querySelector(`[slot="${tagName}"]`))) {
      target = target.cloneNode()
      // @ts-ignore
      target.setAttribute('is-clone', '')
      // @ts-ignore
      target.hidden = false
      const name = `${tagName}-${count}`
      // @ts-ignore
      target.setAttribute('slot', name)
      let prevElement
      if ((prevElement = webComponent.querySelector(`[slot="${name}"]`))) prevElement.remove()
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

  get details () {
    return this._details || (this._details = this.root.querySelector('details'))
  }

  get summary () {
    return this._summary || (this._summary = this.details.querySelector('summary'))
  }

  get progress () {
    return this._progress || (this._progress = this.details.querySelector('#progress'))
  }

  get progressBar () {
    return this._progressBar || (this._progressBar = this.details.querySelector('#progress-bar'))
  }

  get progressText () {
    return this._progressText || (this._progressText = this.details.querySelector('#progress-text'))
  }

  get resetLink () {
    return this._resetLink || (this._resetLink = this.details.querySelector('#reset-link'))
  }

  get clonedElements () {
    return Array.from(this.querySelectorAll('[is-clone]'))
  }

  get videos () {
    return Array.from(this.querySelectorAll('video')).concat(Array.from(this.root.querySelectorAll('video')))
  }

  get customStyleHeight () {
    return (
      this._customStyleHeight ||
        (this._customStyleHeight = (() => {
          const style = document.createElement('style')
          style.setAttribute('protected', 'true')
          return style
        })())
    )
  }
}
