// @ts-check
import WebTorrent from '../webtorrent/dist/webtorrent.min.js'

/**
 * https://webtorrent.io/docs
 *
 * @export
 * @return {CustomElementConstructor | *}
 */
export default class Webtorrent extends HTMLElement {
  constructor() {
    super()

    /** @type {string} */
    this.importMetaUrl = import.meta.url.replace(/(.*\/)(.*)$/, '$1')
    // set attribute namespace
    this.namespace = this.getAttribute('namespace') || 'webtorrent-'

    this.client = new WebTorrent()
    this.client.on('error', error => console.warn('Webtorrent client error:', error))
    let isReadyResolve = map => map
    const isReadyPromise = new Promise(resolve => (isReadyResolve = resolve))
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register(this.getAttribute('sw-url') || `${this.importMetaUrl}../../ServiceWorker.js`, { scope: './' })
      navigator.serviceWorker.ready.then(controller => {
        const createServer = () => {
          if (controller.active?.state === 'activated') {
            this.client.createServer({ controller })
            isReadyResolve(controller)
          } else {
            controller.active?.addEventListener('statechange', event => createServer(), {once: true})
          }
        }
        createServer()
      })
    } else {
      console.error('Webtorrent is not working - since there is no navigator.serviceWorker', this)
    }
    
    this.webtorrentAddEventListener = async event => {
      await isReadyPromise
      this.client.get(event.detail.torrentId).then(existingTorrent => {
        if (existingTorrent) {
          if (event.detail.error) {
            existingTorrent.destroy()
          } else {
            return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, {torrent: existingTorrent})
          }
        }
        const torrent = this.client.add(event.detail.torrentId, event.detail.opts, torrent => this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, {torrent}))
        torrent.on('error', error => console.warn('Webtorrent torrent error:', error))
      })
    }
  }

  connectedCallback () {
    this.addEventListener(`${this.namespace}add`, this.webtorrentAddEventListener)
  }

  disconnectedCallback () {
    this.removeEventListener(`${this.namespace}add`, this.webtorrentAddEventListener)
  }

  /**
   * @async
   * @param {(any)=>void} resolve
   * @param {boolean} dispatch
   * @param {string|undefined} name
   * @param {any} detail
   * @return {Promise<any | false>}
   */
  async respond (resolve, dispatch, name, detail) {
    if (typeof resolve === 'function') {
      if (dispatch) {
        resolve(detail)
      } else {
        return resolve(detail)
      }
    }
    if (typeof name === 'string') {
      this.dispatchEvent(new CustomEvent(name, {
        detail: await detail,
        bubbles: true,
        cancelable: true,
        composed: true
      }))
      return detail
    }
    return false
  }
}
