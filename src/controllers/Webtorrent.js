// @ts-check
import WebTorrent from '../webtorrent/dist/webtorrent.min.js'

/**
 * @typedef {{
 *  torrentFile: Uint8Array,
 *  added: {
 *    href: string,
 *    timestamp: number,
 *    uid?: string | null
 *  }[]
 * }} WEBTORRENT_CONTAINER
 */

/**
 * https://webtorrent.io/docs
 * hint: clear OPFS "await (await navigator.storage.getDirectory()).remove({ recursive: true })"
 * 
    async function listAllOPFSFiles(dirHandle, path = "") {
      for await (const [name, handle] of dirHandle.entries()) {
        const fullPath = path + name;

        if (handle.kind === "file") {
          console.log("file:", fullPath);
        } else if (handle.kind === "directory") {
          console.log("dir:", fullPath + "/");
          await listAllOPFSFiles(handle, fullPath + "/");
        }
      }
    }
    // Entry point
    async function logOPFS() {
      const root = await navigator.storage.getDirectory();
      await listAllOPFSFiles(root);
    }
    logOPFS();
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
			])),
      destroyStoreOnDestroy: false
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
    
    const torrentIdMap =  new Map()
    this.webtorrentAddEventListener = async event => {
      if (torrentIdMap.has(event.detail.torrentId)) return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, await torrentIdMap.get(event.detail.torrentId))
      this.client.get(event.detail.torrentId).then(async existingTorrent => {
        // handle possible existing torrent
        if (existingTorrent) {
          if (event.detail.destroyOpts) {
            existingTorrent.destroy(event.detail.destroyOpts) // If opts.destroyStore is specified, it will override opts.destroyStoreOnDestroy passed when the torrent was added.
          } else {
            const result = {torrent: existingTorrent, streamToServerReadyPromise}
            torrentIdMap.set(event.detail.torrentId, Promise.resolve(result))
            const respond = () => this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, result)
            if (existingTorrent.infoHash) return respond()
            return existingTorrent.on('infoHash', respond)
          }
        }
        let torrentIdMapResolve
        torrentIdMap.set(event.detail.torrentId, new Promise(resolve => (torrentIdMapResolve = resolve)))
        // figure out the torrentId, best to get torrentFile from storage to resurrect torrent
        let torrentId = event.detail.torrentId
        if (typeof torrentId === 'string') {
          let infoHash = torrentId
          try {
            const torrentIdUrl = new URL(torrentId)
            let xt
            if ((xt = torrentIdUrl.searchParams.get('xt'))) {
              infoHash = xt.replace('urn:btih:', '')
            }
          } catch (error) {}
          /** @type {WEBTORRENT_CONTAINER} */
          const torrentContainer = await new Promise(resolve => this.dispatchEvent(new CustomEvent('storage-get', {
            detail: {
              key: `${this.namespace}torrents`,
              resolve
            },
            bubbles: true,
            cancelable: true,
            composed: true
          }))).then(result => result.value[infoHash])
          if (torrentContainer) {
            torrentId = new Uint8Array(torrentContainer.torrentFile)
          }
        }
        const torrent = this.client.add(torrentId, Object.assign(event.detail.opts || {}, await this.addOpts))
        // save to storage
        // TODO: only concat: 'unshift', maxLength: 20 for added but not torrentFile
        torrent.on('metadata', () => this.dispatchEvent(new CustomEvent('storage-merge', {
          detail: {
            key: `${this.namespace}torrents`,
            value: {
              [torrent.infoHash]: {
                torrentFile: Array.from(torrent.torrentFile),
                added: [{
                  href: location.href,
                  timestamp: Date.now(),
                  uid: event.detail.uid
                }]
              }
            }
          },
          bubbles: true,
          cancelable: true,
          composed: true
        })))
        torrent.on('error', error => console.warn('Webtorrent torrent error:', error))
        const result = {torrent, streamToServerReadyPromise}
        // @ts-ignore
        torrentIdMapResolve(result)
        const respond = () => this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, result)
        if (torrent.infoHash) return respond()
        return torrent.on('infoHash', respond)
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
