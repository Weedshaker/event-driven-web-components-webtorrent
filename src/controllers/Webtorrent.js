// @ts-check
import { default as WebTorrentConstructor } from '../webtorrent/dist/webtorrent.min.js'

/* global Environment */

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

// todo: reconnect client after offline, opfs for torrent files, avoid localStorage
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
    const destroyStoreOnDestroy = false
    // trackers
    let presetTrackers = this.hasAttribute('preset-trackers')
      ? [
        'wss://tracker.openwebtorrent.com',
        'wss://tracker.webtorrent.dev',
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
      : []
    // @ts-ignore
    if (typeof this.getAttribute('preset-trackers') === 'string') presetTrackers = this.getAttribute('preset-trackers').split(',')
    // @ts-ignore
    if (Environment?.trackers) presetTrackers = Environment.trackers.concat(presetTrackers)
    if (this.hasAttribute('fetch-trackers')) {
      this.addOpts = fetch(this.getAttribute('fetch-trackers') || 'https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best.txt').then(response => {
          if (response.status >= 200 && response.status <= 299) return response.text()
          throw new Error(response.statusText)
      }).then(text => text.split('\n').filter(text => text)).then(trackers => ({
        announce: Array.from(new Set([
          ...presetTrackers,
          ...trackers
        ])),
        destroyStoreOnDestroy
      })).catch(error => ({announce: presetTrackers, destroyStoreOnDestroy}))
    } else {
      this.addOpts = Promise.resolve({announce: presetTrackers, destroyStoreOnDestroy})
    }

    // TODO: switch to opfs
    // save to storage
    const torrentOnMetadata = (torrent, uid) => this.dispatchEvent(new CustomEvent('storage-merge', {
      detail: {
        key: `${this.namespace}torrents`,
        value: {
          [torrent.infoHash]: {
            torrentFile: Array.from(torrent.torrentFile),
            added: [{
              href: location.href,
              timestamp: Date.now(),
              uid
            }]
          }
        }
      },
      bubbles: true,
      cancelable: true,
      composed: true
    }))
    
    const torrentMap =  new Map()
    this.webtorrentAddEventListener = async event => {
      // figure out the infoHash
      let infoHash = event.detail.torrentId
      if (typeof event.detail.torrentId === 'string') {
        try {
          const torrentIdUrl = new URL(event.detail.torrentId)
          let xt
          if ((xt = torrentIdUrl.searchParams.get('xt'))) infoHash = xt.replace('urn:btih:', '')
        } catch (error) {}
      }
      // handle existing torrent
      if (torrentMap.has(infoHash)) {
        const existingResult = await torrentMap.get(infoHash)
        if (event.detail.destroyOpts) {
          await Webtorrent.destroyTorrent(existingResult.torrent, event.detail.destroyOpts) // If opts.destroyStore is specified, it will override opts.destroyStoreOnDestroy passed when the torrent was added.
          torrentMap.delete(infoHash)
        } else {
          return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, existingResult, existingResult.torrent)
        }
      }
      let torrentMapResolve = result => result
      torrentMap.set(infoHash, new Promise(resolve => (torrentMapResolve = resolve)))
      let torrentId = event.detail.torrentId
      // figure out the torrentId, best to get torrentFile from storage to resurrect torrent
      // TODO: get this from OPFS
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
      if (torrentContainer) torrentId = new Uint8Array(torrentContainer.torrentFile)
      const torrent = this.client.add(torrentId, Object.assign(event.detail.opts || {}, await this.addOpts))
      const result = {torrent, streamToServerReadyPromise: this.streamToServerReadyPromise}
      torrentMapResolve(result)
      // save to storage
      torrent.on('metadata', () => torrentOnMetadata(torrent, event.detail.uid))
      torrent.on('error', error => console.warn('Webtorrent torrent error:', error))
      this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, result, result.torrent)
    }

    this.webtorrentSeedEventListener = async event => {
      let addOpts
      let torrent = this.client.seed(event.detail.input, Object.assign(event.detail.opts || {}, (addOpts = await this.addOpts)))
      torrent.on('infoHash', () => torrentMap.set(torrent.infoHash, Promise.resolve({torrent, streamToServerReadyPromise: this.streamToServerReadyPromise})))
      // save to storage
      torrent.on('metadata', () => torrentOnMetadata(torrent, event.detail.uid))
      torrent.on('error', error => console.warn('Webtorrent torrent error:', error))
      let checkTorrentDestroyedTimeoutId = null
      checkTorrentDestroyedTimeoutId = setTimeout(async () => {
        // to detect that this torrent already exists, is by looking for the destroyed property or else the infoHash would have to be precalculated
        if (torrent.destroyed) {
          const existingTorrent = this.client.torrents.find(torrent => Array.from(event.detail.input).find(file => file.name === torrent.name))
          if (existingTorrent) {
            if (existingTorrent.done) {
              return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {torrent: existingTorrent, streamToServerReadyPromise: this.streamToServerReadyPromise}, existingTorrent)
            } else {
              await Webtorrent.destroyTorrent(existingTorrent)
              torrentMap.delete(existingTorrent.infoHash)
              torrent = this.client.seed(event.detail.input, Object.assign(event.detail.opts || {}, addOpts))
              torrent.on('infoHash', () => torrentMap.set(torrent.infoHash, Promise.resolve({torrent, streamToServerReadyPromise: this.streamToServerReadyPromise})))
              // save to storage
              torrent.on('metadata', () => torrentOnMetadata(torrent, event.detail.uid))
              torrent.on('error', error => console.warn('Webtorrent torrent error:', error))
              return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {torrent, streamToServerReadyPromise: this.streamToServerReadyPromise}, torrent)
            }
          }
        }
        this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {torrent, streamToServerReadyPromise: this.streamToServerReadyPromise}, torrent)
      }, 200)
    }
  }

  init () {
    /** @type {WebTorrentConstructor|any} */
    this.client = new WebTorrentConstructor()
    this.client.on('error', error => console.warn('Webtorrent client error:', error))
    // service worker stream server
    let isStreamToServerReadyResolve = controller => controller
    /** @type {any} */
    this.streamToServerReadyPromise = new Promise(resolve => (isStreamToServerReadyResolve = resolve))
    this.streamToServerReadyPromise.done = false
    this.streamToServerReadyPromise.finally(() => (this.streamToServerReadyPromise.done = true))
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
  }

  destroy () {
    let clientDestroyedResolve = err => err
    /** @type {any} */
    const clientDestroyedPromise = new Promise(resolve => (clientDestroyedResolve = resolve))
    this.client.destroy(error => clientDestroyedResolve(error))
    return clientDestroyedPromise
  }

  connectedCallback () {
    this.init()
    this.addEventListener(`${this.namespace}add`, this.webtorrentAddEventListener)
    this.addEventListener(`${this.namespace}seed`, this.webtorrentSeedEventListener)
  }

  disconnectedCallback () {
    this.destroy()
    this.removeEventListener(`${this.namespace}add`, this.webtorrentAddEventListener)
    this.removeEventListener(`${this.namespace}seed`, this.webtorrentSeedEventListener)
  }

  /**
   * @async
   * @param {(any)=>void} resolve
   * @param {boolean} dispatch
   * @param {string|undefined} name
   * @param {any} detail
   * @param {any} torrent
   * @return {Promise<void>}
   */
  respond (resolve, dispatch, name, detail, torrent) {
    const respond = async () => {
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
    if (torrent.infoHash) return respond()
    return torrent.on('infoHash', respond)
  }

  static destroyTorrent (torrent, opts) {
    let torrentDestroyedResolve = torrent => torrent
    /** @type {any} */
    const torrentDestroyedPromise = new Promise(resolve => (torrentDestroyedResolve = resolve))
    torrent.destroy(opts, () => torrentDestroyedResolve())
    return torrentDestroyedPromise
  }
}
