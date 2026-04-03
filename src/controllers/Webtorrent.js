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

    const presetTrackers = [
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://9.rarbg.com:2810/announce',
      'udp://tracker.torrent.eu.org:451/announce',
      'udp://tracker.moeking.me:6969/announce',
      'udp://tracker.dler.org:6969/announce',
      'udp://tracker.altrosky.nl:6969/announce',
      'udp://p4p.arenabg.com:1337/announce',
      'udp://opentracker.i2p.rocks:6969/announce',
      'udp://open.stealth.si:80/announce',
      'udp://open.demonii.com:1337/announce',
      'udp://explodie.org:6969/announce',
      'udp://exodus.desync.com:6969/announce',
      'https://tracker.nanoha.org:443/announce',
      'https://tracker.lilithraws.org:443/announce',
      'https://tr.burnabyhighstar.com:443/announce',
      'https://opentracker.i2p.rocks:443/announce',
      'http://tracker1.bt.moack.co.kr:80/announce',
      'http://tracker.mywaifu.best:6969/announce',
      'udp://zecircle.xyz:6969/announce',
      'udp://www.peckservers.com:9000/announce'
    ]
    this.addOpts = fetch('https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best.txt').then(response => {
        if (response.status >= 200 && response.status <= 299) return response.text()
        throw new Error(response.statusText)
    }).then(text => text.split('\n').filter(text => text)).then(trackers => ({
			announce: Array.from(new Set([
        ...trackers,
				...presetTrackers
			]))
		})).catch(error => ({announce: presetTrackers}))

    // service worker stream server
    let isStreamToServerReadyResolve = controller => controller
    /** @type {any} */
    const streamToServerReadyPromise = new Promise(resolve => (isStreamToServerReadyResolve = resolve))
    streamToServerReadyPromise.done = false
    streamToServerReadyPromise.finally(() => (streamToServerReadyPromise.done = true))
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register(this.getAttribute('sw-url') || `${this.importMetaUrl}../../ServiceWorker.js`, { scope: './' })
      navigator.serviceWorker.ready.then(controller => {
        const createServer = () => {
          if (controller.active?.state === 'activated') {
            this.client.createServer({ controller })
            isStreamToServerReadyResolve(controller)
          } else {
            controller.active?.addEventListener('statechange', event => createServer(), {once: true})
          }
        }
        createServer()
      })
    } else {
      console.warn('Webtorrent is not working - since there is no navigator.serviceWorker', this)
    }
    
    this.webtorrentAddEventListener = event => {
      this.client.get(event.detail.torrentId).then(async existingTorrent => {
        if (existingTorrent) {
          if (event.detail.destroy) {
            existingTorrent.destroy()
          } else {
            return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, {torrent: existingTorrent, streamToServerReadyPromise})
          }
        }
        const torrent = this.client.add(event.detail.torrentId, Object.assign(event.detail.opts || {}, await this.addOpts), torrent => this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, {torrent, streamToServerReadyPromise}))
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
