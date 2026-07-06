// @ts-check
import { Intersection } from '../event-driven-web-components-prototypes/src/Intersection.js'

/**
 * errorCounter starts with 0 + 1 normal reload of html nodes, 2 + 3 reset torrent, 4 render to link instead of video/img/audio and then starts from 0 again.
 @typedef {0|1|2|3|4|number} ErrorCounter
*/

/**
 * Webtorrent
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
    if (this.torrentId) this.setAttribute('has-torrent-id', '')
    const torrentIdUrl = new URL(this.torrentId)
    this.keyEpoch = torrentIdUrl.searchParams.get('key-epoch')
    this.iv = torrentIdUrl.searchParams.get('iv')
    this.fileName = torrentIdUrl.searchParams.get('dn')
    let xt
    if ((xt = torrentIdUrl.searchParams.get('xt'))) this.infoHash = xt.replace('urn:btih:', '').toLowerCase()
    /** @type {{renderTarget, appendTarget, figureTarget, file, tagName}[]} */
    this.webtorrentTargetElements = []
    this.renderReject = null
    const initTimestamp = Date.now()

    this.mediaResumeMap = new Map()
    this.mediaResumeMaxTimeout = 5000
    
    this.stallTimeout = 10000
    const stillScrollAfter = 3000

    // keep track on how many times render torrent got called
    this.renderedTorrent = 0

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
      self.requestAnimationFrame(timestamp => {
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

    this.dblclickEventListener = event => {
      if (event) event.stopPropagation()
    }

    this.pauseChangeEventListener = event => {
      if (this.torrent && this.torrent.infoHash) {
        this.dispatchEvent(new CustomEvent(`${this.namespace}pause`, {
          detail: {
            pause: !this.pauseCheckbox.checked,
            torrent: this.torrent
          },
          bubbles: true,
          cancelable: true,
          composed: true
        }))
      }
    }

    this.pinClickLinkEventListener = evnet => {
      if (this.torrent && this.torrent.infoHash) {
        const pinned = this.pinLink.children[0]?.assignedElements()?.[0].hasAttribute('state')
        if (pinned) {
          this.pinLink.children[0]?.assignedElements()?.[0].removeAttribute('state')
        } else {
          this.pinLink.children[0]?.assignedElements()?.[0].setAttribute('state', 'pinned')
        }
        this.dispatchEvent(new CustomEvent(`${this.namespace}pin`, {
          detail: {
            pinned: !pinned,
            torrent: this.torrent
          },
          bubbles: true,
          cancelable: true,
          composed: true
        }))
      }
    }

    this.downloadClickLinkEventListener = event => {
      if (this.torrent) this.torrent.files.forEach(async file => this.getBlob(file, await this.keyContainer).then(blob => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.target = '_blank'
        a.download = file.name
        a.click()
        URL.revokeObjectURL(url)
      }))
    }

    let resetCounter = 0
    this.resetClickLinkEventListener = event => {
      if (event) {
        event.preventDefault()
        event.stopPropagation()
      }
      let assignedElement
      if (assignedElement = this.resetLink.children[0]?.assignedElements()?.[0]) {
        assignedElement.addEventListener('transitionend', event => assignedElement.removeAttribute('rotate'), {once: true})
        assignedElement.setAttribute('rotate', '360deg')
      }
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

    this.trashClickLinkEventListener = event => {
      if (event) {
        event.preventDefault()
        event.stopPropagation()
      }
      if (this.infoHash) {
        this.setAttribute('deleting', '')
        this.dispatchEvent(new CustomEvent(`${this.namespace}deleted`, {
          detail: {
            infoHash: this.infoHash,
            deleted: true // not 'destroyStore' but just delete and keep torrentContainer with deleted flag = true
          },
          bubbles: true,
          cancelable: true,
          composed: true
        }))
      }
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
    this.addEventListener('dblclick', this.dblclickEventListener)
    this.pinLink.addEventListener('click', this.pinClickLinkEventListener)
    this.downloadLink.addEventListener('click', this.downloadClickLinkEventListener)
    this.pauseCheckbox.addEventListener('change', this.pauseChangeEventListener)
    this.resetLink.addEventListener('click', this.resetClickLinkEventListener)
    this.trashLink.addEventListener('click', this.trashClickLinkEventListener)
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
    this.keyContainer.then(keyContainer => {
      if (keyContainer) {
        this.setAttribute('has-key', '')
        let assignedElement
        if (assignedElement = this.keyIcon.assignedElements()?.[0]) {
          // reset the key element with all the attributes already set plus key epoch and public-name
          const replacement = document.createElement(assignedElement.tagName)
          Array.from(assignedElement.attributes).forEach(attribute => replacement.setAttribute(attribute.name, attribute.value))
          replacement.setAttribute('epoch', keyContainer.key.epoch)
          replacement.setAttribute('public-name', keyContainer.public.name)
          replacement.setAttribute('title', 'File successfully decrypted!')
          assignedElement.replaceWith(replacement)
        }
      }
    })
    this.renderTorrent(false, false, true)
    // @ts-ignore
    this.connectedCallbackOnce = () => {}
  }

  disconnectedCallback () {
    super.disconnectedCallback()
    this.details.removeEventListener('toggle', this.detailsToggleEventListener)
    this.removeEventListener('dblclick', this.dblclickEventListener)
    this.pinLink.removeEventListener('click', this.pinClickLinkEventListener)
    this.downloadLink.removeEventListener('click', this.downloadClickLinkEventListener)
    this.pauseCheckbox.removeEventListener('change', this.pauseChangeEventListener)
    this.resetLink.removeEventListener('click', this.resetClickLinkEventListener)
    this.trashLink.removeEventListener('click', this.trashClickLinkEventListener)
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
        max-height: 75dvh;
      }
      ::slotted(video), ::slotted(audio), ::slotted(img), :where(video, audio, img) {
        width: 100%;
      }
      ::slotted(img), img {
        object-fit: scale-down;
      }
      ::slotted(embed), ::slotted(iframe), :where(embed, iframe) {
        height: auto;
        max-height: 75dvh;
        object-fit: scale-down;
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
      :host(:where([error], [deleted])) ::slotted([id=error]) {
        display: block;
        padding: 0 0 0.15em 0;
      }
      :host {
        display: inline-block;
        width: 100%;
        white-space: normal;
        margin-bottom: 1.25em;
      }
      :host(:not(:where([error], [deleted]))):has(> details[open]) {
        margin-bottom: 0;
      }
      :host > details {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
      }
      :host(:not(:where([error], [deleted]))) > details {
        min-height: var(--view-min-height, 0);
      }
      :host([has-height]:not([intersecting])) > details {
        display: none;
      }
      :host([has-height]:not([intersecting])) {
        white-space: pre-line;
      }
      :host > details > summary::marker {
        content: "";
      }
      :host > details > summary > figure {
        margin: 0 0 1em;
      }
      :host > details > summary #header {
        border-bottom: 1px solid var(--color-secondary);
        border-top: 1px solid var(--color-secondary);
        text-align: center;
        position: relative;
        cursor: pointer;
        padding: 0.15em 0;
      }
      :host(:not(:where([error], [deleted]))) > details[open] > summary #header {
        border-bottom: 1px dashed var(--color-secondary);
      }
      :host(:not(:where([error], [deleted]))) > details > summary #header::after {
        background: var(--color-secondary);
        clip-path: polygon(0 0, 100% 0, 50% 100%);
        color: var(--color-white);
        content: attr(content, 'file info');
        display: block;
        font-size: 0.7em;
        height: 1.75em;
        position: absolute;
        right: 30%;
        top: 100%;
        width: 40%;
      }
      :host(:not(:where([error], [deleted]))) > details[open] > summary #header::after {
        content: attr(content-open, 'file info');
        clip-path: none;
        line-height: 1.75em;
      }
      :host > details > summary #header > [name=key] {
        display: none;
      }
      :host > details > summary #header > #file-name {
        line-height: 1em;
      }
      :host([has-key]) > details > summary #header > [name=key] {
        display: contents;
      }
      :host([has-key]) > details > summary #header {
        flex: 1;
        display: flex;
        min-height: 2em;
        align-items: flex-end;
      }
      :host([has-key]) > details > summary #header > #file-name {
        align-self: flex-start;
        width: calc(100% - 3.5em);
      }
      :host > details > #content {
        padding: 0 0.5em 0.25em;
      }
      :host > details[open] > #content {
        border-bottom: 1px solid var(--color-secondary);
      }
      :host > details > #content > #controls, :host > details > #content > #progress, :host > details > #content > #progress-info {
        align-items: center;
        display: flex;
        gap: 0.5em;
        justify-content: end;
      }
      :host > details > #content > #progress-info {
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0 1em;
        column-rule: 1px dotted currentColor;
      }
      :host > details .pair {
        display: flex;
        flex-wrap: nowrap;
      }
      :host > details .pair > #torrent-downloaded:empty + span {
        display: none;
      }
      :host([deleted]) > details > #content {
        display: none;
      }
      :host > details > #content > #controls {
        margin-top: 1.125em;
      }
      :host > details > #content > #controls > a {
        line-height: 0.5em;
      }
      :host > details > #content > #controls > :where(a#download-link, a#reset-link, a#trash-link, a#pin-link) {
        display: none;
      }
      :host([done]) > details > #content > #controls > a#download-link,
      :host([has-torrent]:not([self]):not([deleting])) > details > #content > #controls > a#trash-link,
      :host([has-torrent-id]) > details > #content > #progress > #pause,
      :host([has-torrent-id]) > details > #content > #controls > :where(a#reset-link, a#pin-link) {
        display: block;
      }
      :host > details > #content > #progress {
        justify-content: space-between;
        align-items: flex-end;
      }
      :host > details > #content > #progress > #pause {
        display: none;
        width: 2em;
        height: 2em;
        margin: 0;
        cursor: pointer;
      }
      :host > details > #content > #progress > #progress-bar {
        flex: 1;
        display: flex;
        align-self: center;
      }
      :host > details > #content > #progress > #progress-bar > progress {
        min-width: 100%;
      }
      :host > details > #content > #progress-info > * {
        flex-shrink: 0;
      }
      :host > details > #content > #progress-info > *:empty {
        display: none;
      }
      @media only screen and (max-width: _max-width_) {
        :host([has-key]) > details > summary #header {
          min-height: 3em;
        }
        :host > details > #content > #progress-info {
          justify-content: center;
        }
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
   * @returns Promise<void>
   */
  renderHTML () {
    this.html = /* html */`
      <details ${this.hasAttribute('open') ? 'open' : ''}>
        <summary>
          <div id=header>
            <slot name=key></slot>
            <a id=error-link><slot name=error></slot></a>
            <div id=file-name content="file info" content-open="file info"></div>
          </div>
        </summary>
        <div id=content>
          <div id=controls>
            <a id=pin-link><slot name=pin></slot></a>
            <a id=download-link><slot name=download></slot></a>
            <a id=reset-link><slot name=reset></slot></a>
            <a id=trash-link><slot name=trash></slot></a>
          </div>
          <div id=progress>
            <input title="pause or resume torrent" id=pause type=checkbox checked />
            <div id=progress-bar></div>
          </div>
          <div id=progress-info>
            <div id=torrent-status></div>
            <div id=torrent-progress></div>
            <div class=pair>
              <div id=torrent-downloaded></div>
              <span>&nbsp;/&nbsp;</span>
              <div id=torrent-length></div>
            </div>
            <div id=torrent-peers></div>
            <div class=pair>
              <div id=torrent-download-speed></div>
              <span>&nbsp;</span>
              <div id=torrent-upload-speed></div>
            </div>
            <div id=torrent-time-remaining></div>
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
   * @param {boolean} [keepScroll=false]
   * @param {boolean} [force=false]
   * @returns {Promise<void>}
   */
  async renderTorrent (resetTorrent = false, forceRenderToLink = false, keepScroll = false, force = false) {
    this.setAttribute('updating', '')
    this.doOnIntersection = null
    this.doOffIntersection = null
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
    this.progressBar.innerHTML = ''
    this.resetLink.children[0]?.assignedElements()?.[0].removeAttribute('rotate')
    // set new elements
    const {appendTarget: progressTarget, renderTarget: progressElement} = Webtorrent.getElement(this, 'progress', 'initializing...', 'progress', false)
    progressTarget.setAttribute('max', '100')
    this.progressBar.appendChild(progressTarget)
    this.fileNameEl.textContent = this.fileName
    this.details.setAttribute('open', '')
    // get torrent
    return new Promise((resolve, reject) => {
      this.renderReject = reject
      this.dispatchEvent(new CustomEvent(`${this.namespace}add`, {
        detail: {
          uid: this.getAttribute('uid'),
          timestamp: this.getAttribute('timestamp'),
          room: this.getAttribute('room'),
          isSelf: this.hasAttribute('self'),
          torrentId: this.torrentId,
          destroyOpts: resetTorrent === true ? {destroyStore: false} : resetTorrent === 'destroyStore' ? {destroyStore: true} : undefined,
          force,
          resolve
        },
        bubbles: true,
        cancelable: true,
        composed: true
      }))
    }).then(({torrent, streamToServerReadyPromise, error, pinned}) => {
      if (error === 'deleted') {
        this.torrent = null
        this.removeAttribute('has-torrent')
        this.setAttribute('deleted', '')
        this.removeAttribute('updating')
        this.addEventListener('click', event => this.renderTorrent(true, false, false, true), {once: true})
        this.updateHeight()
        return
      } else {
        this.torrent = torrent
        this.setAttribute('has-torrent', '')
        this.removeAttribute('deleted')
        this.removeAttribute('deleting')
      }
      torrent.on('error', this.torrentErrorEventListener)
      const doneFunc = () => this.details.removeAttribute('open')
      if (torrent.done) doneFunc()
      torrent.on('done', doneFunc)
      this.renderedTorrent++
      const firstActivity = Date.now()
      let lastActivity = Date.now()
      const activityFunc = () => (lastActivity = Date.now())
      torrent.on('download', activityFunc)
      torrent.on('upload', activityFunc)
      torrent.on('wire', activityFunc)
      let videosPlaying = []
      this.fileNameEl.textContent = torrent.name
      if (pinned) {
        this.pinLink.children[0]?.assignedElements()?.[0].setAttribute('state', 'pinned')
      } else {
        this.pinLink.children[0]?.assignedElements()?.[0].removeAttribute('state')
      }
      this.doOnIntersection = () => {
        if (!this.hasAttribute('no-video-auto-pause')) videosPlaying.forEach(video => video.play())
        // destroy has no event on webTorrent, thats why interval
        const intervalFunc = () => {
          if (torrent.destroyed) {
            clearInterval(this.intervalID)
            return this.renderTorrent()
          }
          // is torrent stalled without activity for some time?
          // is it the first torrent render and no metadata after first activity for some time?
          if (!torrent.done && !torrent.paused && torrent.numPeers > 0 && !torrent.downloadSpeed && !torrent.uploadSpeed && ((lastActivity + this.stallTimeout) < Date.now() || (this.renderedTorrent <= 3 && !torrent.metadata && (firstActivity + this.stallTimeout) < Date.now()))) {
            if (!torrent.metadata && this.renderedTorrent === 2) {
              this.renderTorrent(true)
            } else {
              this.dispatchEvent(new CustomEvent(`${this.namespace}view-is-stalled`, {
                detail: {
                  torrent,
                  torrentId: this.torrentId
                },
                bubbles: true,
                cancelable: true,
                composed: true
              }))
            }
            activityFunc()
          }
          this.torrentStatusEl.textContent = torrent.paused
            ? torrent.done
              ? 'Not seeding'
              : 'Paused'
            : torrent.done
              ? 'Seeding'
              : 'Downloading'
          const progress = (100 * torrent.progress || 0).toFixed(1)
          if (torrent.metadata) progressElement.setAttribute('value', progress)
          this.headerEl.setAttribute('content', torrent.done ? this.torrentStatusEl.textContent : `${this.torrentStatusEl.textContent} - ${progress}%`)
          this.headerEl.setAttribute('content-open', torrent.done ? 'file info' : this.torrentStatusEl.textContent)
          this.pauseCheckbox.checked = !torrent.paused
          if (torrent.done) {
            this.setAttribute('done', '')
          } else {
            this.removeAttribute('done')
          }
          this.torrentProgressEl.textContent = `${progress}%`
          this.torrentDownloadedEl.textContent = Webtorrent.formatBytes(torrent.downloaded)
          this.torrentLengthEl.textContent = Webtorrent.formatBytes(torrent.length)
          this.torrentPeersEl.textContent = `${torrent.numPeers} peer${torrent.numPeers === 1 ? '' : 's'}`
          this.torrentDownloadSpeedEl.innerHTML = `&darr;${Webtorrent.formatBytes(torrent.downloadSpeed, true)}`
          this.torrentUploadSpeedEl.innerHTML = `&uarr;${Webtorrent.formatBytes(torrent.uploadSpeed, true)}`
          this.torrentTimeRemainingEl.textContent = torrent.timeRemaining ? `${Webtorrent.formatTimeRemaining(torrent.timeRemaining)} remaining` : ''
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
          const loadedEventListener = event => {
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
          }
          if (['audio', 'video'].includes(renderTarget.tagName.toLowerCase())) {
            renderTarget.addEventListener('loadedmetadata', event => {
              loadedEventListener()
              if (!this.hasAttribute('no-media-resume')) {
                let mediaResumeItem
                if (mediaResumeItem = this.mediaResumeMap.get(torrent.name)) {
                  // must have at least 5 seconds to continue replay
                  if ((mediaResumeItem.currentTime + 5) < renderTarget.duration) renderTarget.currentTime = mediaResumeItem.currentTime
                  // resume only if it was playing in less than the this.mediaResumeMaxTimeout before
                  if (renderTarget.paused && mediaResumeItem.timestamp + this.mediaResumeMaxTimeout > Date.now()) renderTarget.play()
                }
              }
            })
            if (!this.hasAttribute('no-media-resume')) renderTarget.addEventListener('timeupdate', event => this.mediaResumeMap.set(torrent.name, {
              currentTime: renderTarget.currentTime,
              timestamp: Date.now()
            }))
            renderTarget.addEventListener('canplay', loadedEventListener, {once: true})
          } else {
            renderTarget.addEventListener('load', loadedEventListener)
          }
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
      results.forEach(async ({renderTarget, appendTarget, figureTarget, tagName, file}) => {
        if (tagName === 'track') {
          videoResults[0].renderTarget.appendChild(renderTarget)
        } else if (tagName === 'img') {
          renderTarget.remove()
          appendTarget.remove()
          figureTarget?.remove()
          if (streamToServerReadyPromise.done) {
            videoResults[0].renderTarget.setAttribute('poster', file.streamURL)
          } else {
            this.getBlob(file, await this.keyContainer).then(blob => videoResults[0].renderTarget.setAttribute('poster', URL.createObjectURL(blob)))
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
                  text: file, // must be file here, since the range for the stream is going to be calculated by crypto
                  iv: new Uint8Array(iv.split(',')),
                  name: 'wormhole-crypto',
                  key: keyContainer.key.epoch,
                  start: start ? start : 0,
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
    // TODO: fallback view if no key
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
    try {
      if (keyContainer) {
        const decryptedStream = await new Promise(async resolve => this.dispatchEvent(new CustomEvent('yjs-decrypt', {
          detail: {
            resolve,
            encrypted: {
              text: file.stream(),
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
        // TODO: fallback view if no key
        return await file.blob()
      }
    } catch (error) {
      this.resetClickLinkEventListener()
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

  static formatBytes(bytes, isPerSecond = false) {
    if(!bytes) return '0'
    const units = isPerSecond
      ? ['bytes/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s']
      : ['bytes', 'KB', 'MB', 'GB', 'TB']
    let i = 0
    let value = bytes
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024
      i++
    }
    return `${value?.toFixed(1) || '0'} ${units[i]}`
  }

  static formatTimeRemaining(ms) {
    if (!ms || ms < 0) return '0s'
    const totalSeconds = Math.round(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) return `${hours}h ${minutes}m`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  }

  get details () {
    return this._details || (this._details = this.root.querySelector('details'))
  }

  get summary () {
    return this._summary || (this._summary = this.details.querySelector('summary'))
  }

  get progressBar () {
    return this._progressBar || (this._progressBar = this.details.querySelector('#progress-bar'))
  }

  get torrentStatusEl () {
    return this._torrentStatusEl || (this._torrentStatusEl = this.details.querySelector('#torrent-status'))
  }

  get torrentProgressEl () {
    return this._torrentProgressEl || (this._torrentProgressEl = this.details.querySelector('#torrent-progress'))
  }

  get torrentDownloadedEl () {
    return this._torrentDownloadedEl || (this._torrentDownloadedEl = this.details.querySelector('#torrent-downloaded'))
  }

  get torrentLengthEl () {
    return this._torrentLengthEl || (this._torrentLengthEl = this.details.querySelector('#torrent-length'))
  }

  get torrentPeersEl () {
    return this._torrentPeersEl || (this._torrentPeersEl = this.details.querySelector('#torrent-peers'))
  }

  get torrentDownloadSpeedEl () {
    return this._torrentDownloadSpeedEl || (this._torrentDownloadSpeedEl = this.details.querySelector('#torrent-download-speed'))
  }

  get torrentUploadSpeedEl () {
    return this._torrentUploadSpeedEl || (this._torrentUploadSpeedEl = this.details.querySelector('#torrent-upload-speed'))
  }

  get torrentTimeRemainingEl () {
    return this._torrentTimeRemainingEl || (this._torrentTimeRemainingEl = this.details.querySelector('#torrent-time-remaining'))
  }

  get headerEl () {
    return this.details.querySelector('#header')
  }

  get fileNameEl () {
    return this.details.querySelector('#file-name')
  }

  get pauseCheckbox () {
    return this._pauseCheckbox || (this._pauseCheckbox = this.details.querySelector('#pause'))
  }

  get pinLink () {
    return this._pinLink || (this._pinLink = this.details.querySelector('#pin-link'))
  }

  get downloadLink () {
    return this._downloadLink || (this._downloadLink = this.details.querySelector('#download-link'))
  }

  get resetLink () {
    return this._resetLink || (this._resetLink = this.details.querySelector('#reset-link'))
  }

  get trashLink () {
    return this._trashLink || (this._trashLink = this.details.querySelector('#trash-link'))
  }

  get keyIcon () {
    return this._keyIcon || (this._keyIcon = this.details.querySelector('[name=key]'))
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
