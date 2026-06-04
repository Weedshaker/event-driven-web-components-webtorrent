// @ts-check
import { Intersection } from '../event-driven-web-components-prototypes/src/Intersection.js'

/**
 * errorCounter starts with 0 + 1 normal reload of html nodes, 2 + 3 reset torrent, 4 render to link instead of video/img/audio and then starts from 0 again.
 @typedef {0|1|2|3|4|number} ErrorCounter
*/

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
    
    // set attribute namespace
    this.namespace = this.getAttribute('namespace') || 'webtorrent-'
    this.torrentId = this.getAttribute('torrent-id') || encodeURI(Array.from((new URL(location.href)).searchParams).reduce((acc, curr) => curr[0] === 'torrent-id'
      ? `${curr[1]}`
      : `${acc}&${curr[0]}=${curr[1]}`, ''))
    const torrentIdUrl = new URL(this.torrentId)
    this.keyEpoch = torrentIdUrl.searchParams.get('key-epoch')
    this.iv = torrentIdUrl.searchParams.get('iv')
    let xt
    if ((xt = torrentIdUrl.searchParams.get('xt'))) this.infoHash = xt.replace('urn:btih:', '').toLowerCase()
    /** @type {{renderTarget, appendTarget, figureTarget, file, tagName}[]} */
    this.webtorrentTargetElements = []
    this.renderReject = null
    const initTimestamp = Date.now()
    
    this.stallTimeout = 10000
    const stillScrollAfter = 3000

    this.torrentErrorEventListener = event => {
      this.renderTorrent(true)
      this.dispatchEvent(new CustomEvent(`${this.namespace}view-torrent-error`, {
        detail: {
          torrentId: this.torrentId
        },
        bubbles: true,
        cancelable: true,
        composed: true
      }))
    }

    let errorCounter = 0
    let errorTimeoutID
    this.fileErrorEventListener = event => {
      if (event.target?.tagName === 'TRACK') return
      clearTimeout(errorTimeoutID)
      errorTimeoutID = setTimeout(() => {
        console.warn('Webtorrent view error:', event, event.target || this, ':is webworker active?')
        this.hadFileError = true
        // reset counter after 3
        /** @type {ErrorCounter} */
        const errorCounterStatus = errorCounter % 4
        // stop cycle after 10 and reaching status 3
        if (errorCounter < 10 || errorCounterStatus === 3) {
          this.setAttribute('error', '')
          this.renderTorrent(errorCounterStatus === 1 || errorCounterStatus === 2 ? true : false, errorCounterStatus === 3 ? true : false, (errorCounterStatus === 0 && initTimestamp + stillScrollAfter > Date.now())).then(() => {
            if (errorCounterStatus < 2) this.removeAttribute('error')
            this.dispatchEvent(new CustomEvent(`${this.namespace}view-file-error`, {
              detail: {
                errorCounter,
                torrentId: this.torrentId,
                wasStreaming: this.wasStreaming
              },
              bubbles: true,
              cancelable: true,
              composed: true
            }))
          })
        }
        errorCounter++
      }, 200)
    }

    // Avoid DOM performance issues
    this.updateHeight = () => {
      let promiseResolve
      const promise = new Promise(resolve => (promiseResolve = resolve))
      this.removeAttribute('has-height')
      this.customStyleHeight.textContent = ''
      self.requestAnimationFrame(timeStamp => {
        this.customStyleHeight.textContent = /* css */`
          :host([has-height]:not([intersecting])), :host([has-height][error]) > details, :host([has-height][updating]) > details {
            min-height: ${this.offsetHeight}px;
          }
        `
        this.setAttribute('has-height', '')
        promiseResolve()
      })
      return promise
    }

    this.detailsToggleEventListener = event => {
      if (!this.hasAttribute('updating')) this.updateHeight()
    }

    let resetCounter = 0
    this.resetLinkEventListener = event => {
      event.preventDefault()
      event.stopPropagation()
      this.renderTorrent(resetCounter > 0
        ? true
        : false
      )
      this.dispatchEvent(new CustomEvent(`${this.namespace}view-reset-link-click`, {
        detail: {
          torrentId: this.torrentId
        },
        bubbles: true,
        cancelable: true,
        composed: true
      }))
      resetCounter++
    }

    this.webtorrentDidResetEventListener = event => {
      clearTimeout(errorTimeoutID)
      this.hadFileError = false
      this.removeAttribute('error')
      errorCounter = 0
    }

    this.webtorrentInfoHashEventListener = event => this.renderTorrent()

    // this updates the min-height on resize, see updateHeight function for more info
    let resizeTimeout = null
    this.resizeEventListener = event => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => this.updateHeight(), 200)
    }
  }

  connectedCallback() {
    super.connectedCallback()
    this.hidden = true
    const showPromises = []
    if (this.shouldRenderCSS()) showPromises.push(this.renderCSS())
    if (this.shouldRenderHTML()) showPromises.push(this.renderHTML())
    Promise.all(showPromises).then(() => (this.hidden = false))
    this.details.addEventListener('toggle', this.detailsToggleEventListener)
    this.resetLink.addEventListener('click', this.resetLinkEventListener)
    self.addEventListener('resize', this.resizeEventListener)
    document.body.addEventListener(`${this.namespace}did-reset`, this.webtorrentDidResetEventListener)
    if (this.infoHash) document.body.addEventListener(`${this.namespace}${this.infoHash}`, this.webtorrentInfoHashEventListener)
    if (this.isConnected) this.connectedCallbackOnce()
  }

  connectedCallbackOnce () {
    this.keyContainer = this.keyEpoch
      ? new Promise(resolve => this.dispatchEvent(new CustomEvent('yjs-get-key', {
        detail: {
          epoch: this.keyEpoch,
          resolve
        },
        bubbles: true,
        cancelable: true,
        composed: true
      })))
      : Promise.resolve(null)
    this.renderTorrent(false, false, true)
    // @ts-ignore
    this.connectedCallbackOnce = () => {}
  }

  disconnectedCallback () {
    super.disconnectedCallback()
    this.details.removeEventListener('toggle', this.detailsToggleEventListener)
    this.resetLink.removeEventListener('click', this.resetLinkEventListener)
    self.removeEventListener('resize', this.resizeEventListener)
    document.body.removeEventListener(`${this.namespace}did-reset`, this.webtorrentDidResetEventListener)
    if (this.infoHash) document.body.removeEventListener(`${this.namespace}${this.infoHash}`, this.webtorrentInfoHashEventListener)
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
      ::slotted(video), ::slotted(img), :where(video, img) {
        height: auto;
      }
      ::slotted(video), ::slotted(audio), ::slotted(img), :where(video, audio, img) {
        width: 100%;
      }
      ::slotted(embed), ::slotted(iframe), :where(embed, iframe) {
        height: auto;
        width: 100%;
        aspect-ratio: 4/3;
      }
      ::slotted([id=reset]) {
        cursor: pointer;
      }
      ::slotted([id=error]) {
        display: none;
        height: 100%;
        flex: 1;
      }
      :host([error]) ::slotted([id=error]) {
        display: block;
      }
      :host {
        display: block;
        white-space: normal;
        min-height: var(--view-min-height, 0);
      }
      :host > details {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      :host([has-height]:not([intersecting])) > details {
        display: none;
      }
      :host > details > #content > #controls, :host > details > #content > #progress {
        align-items: center;
        display: flex;
        gap: 1em;
        justify-content: end;
      }
      :host > details > #content > #controls > a {
        line-height: 0.5em;
      }
      :host > details > #content > #progress {
        justify-content: space-between;
      }
      :host > details > #content > #progress > #progress-bar {
        flex: 1;
        display: flex;
      }
      :host > details > #content > #progress > #progress-bar > progress {
        min-width: 100%;
      }
      :host > details > #content > #progress > :where(#progress-text, #peers) {
        flex-shrink: 0;
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
        <summary>
          <div id=file-name></div>
        </summary>
        <div id=content>
          <a id=error-link><slot name=error></slot></a>
          <div id=progress>
            <div id=progress-bar></div>
            <div id=progress-text></div>
            <div id=peers></div>
          </div>
          <div id=controls>
            <a id=reset-link><slot name=reset></slot></a>
            <a id=trash-link><slot name=trash></slot></a>
          </div>
        </div>
      </details>
    `
    this.html = this.customStyleHeight
    return Promise.resolve()
  }

  /**
   * Get torrent and render
   * 
   * @param {true|false|'destroyStore'} [resetTorrent=false]
   * @param {boolean} [forceRenderToLink=false]
   * @returns {Promise<void>}
   */
  async renderTorrent (resetTorrent = false, forceRenderToLink = false, keepScroll = false) {
    this.setAttribute('updating', '')
    this.details.setAttribute('open', '')
    clearInterval(this.intervalID)
    if (this.renderReject) {
      this.renderReject()
      this.renderReject = null
    }
    // reset previous render
    if (keepScroll) await this.updateHeight()
    // clear previous torrent media elements
    this.webtorrentTargetElements.forEach(({renderTarget, appendTarget, figureTarget}) => {
      renderTarget.remove()
      appendTarget.remove()
      figureTarget?.remove()
    })
    this.webtorrentTargetElements = []
    this.clonedElements.forEach(element => element.remove())
    // clear information elements
    this.summary.innerHTML = '<div id=file-name></div>'
    Array.from(this.progress.children).forEach(child => (child.innerHTML = ''))
    // set new elements
    const {appendTarget: progressTarget, renderTarget: progressElement} = Webtorrent.getElement(this, 'progress', 'initializing...', 'progress', false)
    progressTarget.setAttribute('max', '100')
    this.progressBar.appendChild(progressTarget)
    // get torrent
    return new Promise((resolve, reject) => {
      this.renderReject = reject
      this.dispatchEvent(new CustomEvent(`${this.namespace}add`, {
        detail: {
          uid: this.getAttribute('uid'),
          room: this.getAttribute('room'),
          torrentId: this.torrentId,
          destroyOpts: resetTorrent === true ? {destroyStore: false} : resetTorrent === 'destroyStore' ? {destroyStore: true} : undefined,
          resolve
        },
        bubbles: true,
        cancelable: true,
        composed: true
      }))
    }).then(({torrent, streamToServerReadyPromise}) => {
      torrent.on('error', this.torrentErrorEventListener)
      const doneFunc = () => this.details.removeAttribute('open')
      if (torrent.done) doneFunc()
      torrent.on('done', doneFunc)
      let lastActivity = Date.now()
      const activityFunc = () => (lastActivity = Date.now())
      torrent.on('download', activityFunc)
      torrent.on('upload', activityFunc)
      torrent.on('wire', activityFunc)
      let videosPlaying = []
      this.fileNameEl.textContent = torrent.name
      this.doOnIntersection = () => {
        if (!this.hasAttribute('no-video-auto-pause')) videosPlaying.forEach(video => video.play())
        // destroy has no event on webTorrent, thats why interval
        const intervalFunc = () => {
          if (torrent.destroyed) {
            clearInterval(this.intervalID)
            return this.renderTorrent()
          }
          // is torrent stalled
          if (!torrent.done && (lastActivity + this.stallTimeout) < Date.now() && torrent.numPeers > 0 && !torrent.downloadSpeed && !torrent.uploadSpeed) {
            this.dispatchEvent(new CustomEvent(`${this.namespace}view-is-stalled`, {
              detail: {
                torrent,
                torrentId: this.torrentId
              },
              bubbles: true,
              cancelable: true,
              composed: true
            }))
            activityFunc()
          }
          if (torrent.metadata) progressElement.setAttribute('value', 100 * torrent.progress)
          this.progressText.textContent = `${(100 * torrent.progress).toFixed(1)}%`
          this.peersEl.innerText = `${torrent.numPeers} peer${torrent.numPeers === 1 ? '' : 's'}`
        }
        intervalFunc()
        clearInterval(this.intervalID)
        this.intervalID = setInterval(intervalFunc, this.hasAttribute('refresh-rate') ? Number(this.getAttribute('refresh-rate')) : 2000)
      }
      if (this.hasAttribute('intersecting')) this.doOnIntersection()
      this.doOffIntersection = () => {
        if (!this.hasAttribute('no-video-auto-pause')) (videosPlaying = this.videos.filter(video => !video.paused)).forEach(video => video.pause())
        clearInterval(this.intervalID)
      }
      const tagName = forceRenderToLink ? 'a' : ''
      const streamOrDoneFunc = () => activityFunc()
      const renderFiles = async () => {
        let file
        if ((file = torrent.files.find(file => file.name === this.getAttribute('file-name')))) {
          this.webtorrentTargetElements.push(await this.renderFileTo(file, this, this.summary, streamToServerReadyPromise, undefined, streamOrDoneFunc, tagName))
        } else {
          this.webtorrentTargetElements = this.webtorrentTargetElements.concat(await this.renderFilesTo(torrent, this, this.summary, streamToServerReadyPromise, tagName, streamOrDoneFunc))
        }
        this.webtorrentTargetElements.forEach(({renderTarget}) => {
          renderTarget.addEventListener(['audio', 'video'].includes(renderTarget.tagName.toLowerCase()) ? 'loadeddata' : 'load', event => {
            this.updateHeight()
            this.removeAttribute('updating')
            if (keepScroll) this.dispatchEvent(new CustomEvent(`${this.namespace}load`, {
              detail: {
                origEvent: event,
                torrentId: this.torrentId
              },
              bubbles: true,
              cancelable: true,
              composed: true
            }))
          })
          renderTarget.addEventListener('error', this.fileErrorEventListener)
        })
      }
      if (torrent.ready) {
        renderFiles()
      } else {
        torrent.on('ready', renderFiles)
      }
    })
  }

  async renderFilesTo (torrent, webComponent, targetContainer, streamToServerReadyPromise, tagName, streamOrDoneFunc) {
    const results = await Promise.all(torrent.files.map(async (file, i) => await this.renderFileTo(file, webComponent, targetContainer, streamToServerReadyPromise, i, streamOrDoneFunc, tagName, false)))
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
            this.getBlob(file, this.keyContainer).then(blob => videoResults[0].renderTarget.setAttribute('poster', URL.createObjectURL(blob)))
          }
        }
      })
    } else {
      results.forEach(({appendTarget, tagName}) => {
        if (tagName === 'track') {
          const videoOrAudio = results.find(result => ['audio', 'video'].includes(result.tagName))
          if (videoOrAudio) videoOrAudio.renderTarget.appendChild(appendTarget)
        } else {
          targetContainer.prepend(appendTarget)
        }
      })
    }
    return results
  }

  async renderFileTo (file, webComponent, targetContainer, streamToServerReadyPromise, fileCount, streamOrDoneFunc, tagName, append) {
    // check if file is encrypted and if so, get the ReadableStream of stream decrypt
    let keyContainer, iv
    if ((iv = this.iv)) {
      if (keyContainer = await this.keyContainer) {
        file.on('iterator', ({ iterator, file, req }, cb) => {
          this.wasStreaming = true
          // decrypt on each iteration the requested chunks
          cb((async function* () {
            const [, start, end] = (/bytes=(\d+)-(\d*)/.exec(req?.headers?.range) || []).map(num => Number(num))
            const decryptedStream = await new Promise(async resolve => webComponent.dispatchEvent(new CustomEvent('yjs-decrypt', {
              detail: {
                resolve,
                encrypted: {
                  text: file,
                  iv: new Uint8Array(iv.split(',')),
                  name: 'wormhole-crypto',
                  key: keyContainer.key.epoch,
                  start,
                  length: end ? end - start + 1 : file.length - 1,
                  fileLength: file.length
                },
                key: keyContainer
              },
              bubbles: true,
              cancelable: true,
              composed: true
            }))).then(result => {
              if (result) {
                const { decrypted } = result
                if (decrypted.error) return null
                return decrypted.text
              }
              return null
            })
            if (!decryptedStream) {
              // fallback to original iterator (must stay valid)
              yield* iterator
              return
            }
            const reader = decryptedStream.getReader()
            while (true) {
              const { value, done } = await reader.read()
              if (done) return
              yield value
            }
          })())
        })
      }
    }
    file.on('stream', streamOrDoneFunc)
    file.on('done', streamOrDoneFunc)
    return await this._renderFileTo(file, webComponent, targetContainer, streamToServerReadyPromise, fileCount, keyContainer, tagName, append)
  }

  async _renderFileTo (file, webComponent, targetContainer, streamToServerReadyPromise, fileCount, keyContainer, tagName = '', append = true) {
    // streamTo and streamURL only work when service worker is up and running
    const setHref = async target => {
      if (streamToServerReadyPromise.done && !/OS 16_/.test(navigator.userAgent)) {
        target.setAttribute('href', file.streamURL)
      } else {
        target.setAttribute('href', URL.createObjectURL(await this.getBlob(file, keyContainer)))
      }
    }
    let targetAttribute
    if (!tagName) [tagName, targetAttribute] = Webtorrent.getTagNameByMimeType(file.type, file.path)
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
      // here we can consider tagName !== 'video' instead of (!this.hadFileError && !this.wasStreaming), which still makes videos trying to stream decrypt, which does not work, then fail and rerender
      if (streamToServerReadyPromise.done && tagName !== 'embed' && tagName !== 'iframe' && (!this.hadFileError && !this.wasStreaming)) {
        file.streamTo(renderTarget)
      } else {
        renderTarget.setAttribute(targetAttribute || 'src', URL.createObjectURL(await this.getBlob(file, keyContainer)))
      }
    }
    return {renderTarget, appendTarget, figureTarget, file, tagName}
  }

  async getBlob (file, keyContainer) {
    if (keyContainer) {
      const decryptedStream = await new Promise(async resolve => this.dispatchEvent(new CustomEvent('yjs-decrypt', {
        detail: {
          resolve,
          encrypted: {
            text: file,
            // @ts-ignore
            iv: new Uint8Array(this.iv.split(',')),
            name: 'wormhole-crypto',
            key: keyContainer.key.epoch
          },
          key: keyContainer
        },
        bubbles: true,
        cancelable: true,
        composed: true
      }))).then(result => {
        if (result) {
          const { decrypted } = result
          if (decrypted.error) return null
          return decrypted.text
        }
        return null
      })
      if (!decryptedStream) return await file.blob()
      return await new Response(decryptedStream, {
        headers: { 'Content-Type': 'application/octet-stream' }
      }).blob()
    } else {
      return await file.blob()
    }
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

  static getTagNameByMimeType (type, path) {
    const match = path.match(/\.[a-z]{3}$/)
    if (match?.[0]) {
      if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.avif', '.svg', '.ico'].includes(match[0])) return ['img', 'src']
      if (['.mp4', '.mkv', '.mov', '.avi', '.wmv', '.flv', '.webm', '.divx'].includes(match[0])) return ['video', 'src']
      if (['.mp3', '.wav', '.ogg', '.oga', '.aac', '.m4a', '.flac'].includes(match[0])) return ['audio', 'src']
      if (['.pdf', '.html', '.htm', '.svg', '.xml', '.txt'].includes(match[0])) return ['embed', 'src']
    }
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

  get peersEl () {
    return this._peersEl || (this._peersEl = this.details.querySelector('#peers'))
  }

  get fileNameEl () {
    return this.details.querySelector('#file-name')
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
