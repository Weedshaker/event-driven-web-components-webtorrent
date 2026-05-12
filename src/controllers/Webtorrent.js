// @ts-check
import { default as WebTorrentConstructor } from '../webtorrent/dist/webtorrent.min.js'
import { WebWorker } from '../event-driven-web-components-prototypes/src/WebWorker.js'

/* global Environment */

/**
 * @typedef {{
 *  self: boolean,
 *  room: string,
 *  torrentFile: never[],
 *  added: {
 *    href: string,
 *    timestamp: number,
 *    uid: string,
 *    room: string
 *  }[]
 * }} WEBTORRENT_CONTAINER
 */

/**
 * @typedef {{
 *  torrent,
 *  streamToServerReadyPromise: Promise<ServiceWorkerRegistration> & {done: boolean}
 * }} WEBTORRENT_ADD_SEED_RESULT
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
export default class Webtorrent extends WebWorker() {
  // handles the active torrents added to client and avoids conflicts of doubles and also of serving destroyed torrents
  static #torrentMap = {
    /**
     * caching the torrents
     *
     * @type {Map<string, Promise<WEBTORRENT_ADD_SEED_RESULT>>}
     */
    map: new Map(),
    /**
     * get Cache
     *
     * @returns {(key: string) => Promise<WEBTORRENT_ADD_SEED_RESULT|undefined>}
     */
    get get () {
      return key => {
        const value = this.map.get(key)
        return value ? value.then(result => result.torrent.destroyed ? undefined : result) : Promise.resolve(undefined)
      }
    },
    /**
     * has Cache
     *
     * @returns {(key: string) => Promise<boolean>}
     */
    get has () {
      return key => {
        const value = this.map.get(key)
        return value ? value.then(result => result.torrent.destroyed ? false : true) : Promise.resolve(false)
      }
    },
    /**
     * set Cache
     *
     * @returns {(key: string, value: Promise<WEBTORRENT_ADD_SEED_RESULT>) => void}
     */
    get set () {
      return (key, value) => this.map.set(key, value)
    },
    /**
     * delete Cache
     *
     * @returns {(key: string) => boolean}
     */
    get delete () {
      return key => this.map.delete(key)
    },
    /**
     * clear Cache
     *
     * @returns {() => void}
     */
    get clear () {
      return key => this.map.clear()
    }
  }

  /**
   * mirrors all saved torrentFileContainers Objects / all active torrents saved when torrent on metadata (torrentFile available) happens
   * so this is a shortcut instead of every time loading the torrentFileContainer from OPFS (not done because of performance but convenience)
   * // TODO: re-upload file
   * 
   * @readonly
   * @static
   * @type {Map<string, Promise<WEBTORRENT_CONTAINER>>}
   */
  static #torrentFileMap = new Map()

  constructor() {
    super()

    /** @type {string} */
    this.importMetaUrl = import.meta.url.replace(/(.*\/)(.*)$/, '$1')
    // set attribute namespace
    this.namespace = this.getAttribute('namespace') || 'webtorrent-'
    const stallTimeout = 6000 // has to be less than the timeout at view
    // init is going to fill this Promise
    this.setClientPromise()
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
    
    // expects the following event.detail:
    // torrentId string - files to add to webtorrent
    // destroyOpts Object - shall already existing torrents be destroyed
    // opts Object - with options for webtorrent
    // resolve Promise.resolve - for answer
    // name string - for dispatchEvent name
    // dispatch boolean - shall the answer be dispatched
    // uid string - for metadata at the opfs torrentFile store
    // room string - for metadata at the opfs torrentFile store
    this.webtorrentAddEventListener = async event => {
      const client = await this.clientPromise
      // figure out the infoHash
      let infoHash = event.detail.torrentId
      if (typeof event.detail.torrentId === 'string') {
        infoHash = event.detail.torrentId.toLowerCase()
        try {
          const torrentIdUrl = new URL(event.detail.torrentId)
          let xt
          if ((xt = torrentIdUrl.searchParams.get('xt'))) infoHash = xt.replace('urn:btih:', '').toLowerCase()
          // TODO: may delay this, in case the torrent loads quickly form OPFS or network
          // inform ipfs about this cid
          let cid
          if ((cid = torrentIdUrl.searchParams.get('cid'))) this.dispatchEvent(new CustomEvent('ipfs-add', {
            detail: {
              cid
            },
            bubbles: true,
            cancelable: true,
            composed: true
          }))
        } catch (error) {}
      }
      // handle existing torrent
      if (await Webtorrent.#torrentMap.has(infoHash)) {
        const existingResult = await Webtorrent.#torrentMap.get(infoHash)
        if (existingResult) {
          if (event.detail.destroyOpts) {
            await Webtorrent.destroyTorrent(existingResult.torrent, infoHash, event.detail.destroyOpts) // If opts.destroyStore is specified, it will override opts.destroyStoreOnDestroy passed when the torrent was added.
          } else {
            return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, existingResult, existingResult.torrent)
          }
        }
      }
      let torrentMapResolve = result => result
      Webtorrent.#torrentMap.set(infoHash, new Promise(resolve => (torrentMapResolve = resolve)))
      let torrentId = event.detail.torrentId
      // figure out the torrentId, best to get torrentFile from storage to resurrect torrent
      /** @type {WEBTORRENT_CONTAINER} */
      const torrentContainer = await this.webWorker(Webtorrent.loadTorrentFile, infoHash)
      if (torrentContainer?.torrentFile) torrentId = new Uint8Array(torrentContainer.torrentFile)
      const torrent = client.add(torrentId, Object.assign(event.detail.opts || {}, await this.addOpts))
      /** @type {WEBTORRENT_ADD_SEED_RESULT} */
      const result = {torrent, streamToServerReadyPromise: this.streamToServerReadyPromise}
      torrentMapResolve(result)
      // save to storage
      this.onMetadata(torrent, event.detail.uid, event.detail.room)
      // TODO: on('done', this.dispatchEvent(new CustomEvent('ipfs-seed') ... IMPORTANT: only do this once, ether check at ipfs or here
      this.onError(torrent)
      this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, result, result.torrent)
    }

    // expects the following event.detail:
    // input FileList - files to add to webtorrent
    // opts Object - with options for webtorrent
    // resolve Promise.resolve - for answer
    // name string - for dispatchEvent name
    // dispatch boolean - shall the answer be dispatched
    // uid string - for metadata at the opfs torrentFile store
    // room string - for metadata at the opfs torrentFile store
    this.webtorrentSeedEventListener = async event => {
      const client = await this.clientPromise
      let addOpts
      // when the first file in the file list is a torrent file, load the torrent file
      let torrent = Array.from(event.detail.input)[0]?.type === 'application/x-bittorrent'
        ? client.add(Array.from(event.detail.input)[0], Object.assign(event.detail.opts || {}, await this.addOpts))
        : client.seed(event.detail.input, Object.assign(event.detail.opts || {}, (addOpts = await this.addOpts)))
      this.onInfoHash(torrent)
      // save to storage
      this.onMetadata(torrent, event.detail.uid, event.detail.room, true)
      this.onError(torrent)
      // no event like warning or error is fired from webtorrent as well as destroy has no event
      const checkTorrentDestroyedIntervalId = setInterval(async () => {
        // to detect that this torrent already exists, is by looking for the destroyed property or else the infoHash would have to be precalculated
        if (torrent.destroyed) {
          clearInterval(checkTorrentDestroyedIntervalId)
          const existingTorrent = client.torrents.find(torrent => Array.from(event.detail.input).find(file => file.name === torrent.name))
          if (existingTorrent) {
            if (existingTorrent.done) {
              // Not needed, because this torrent must have been saved when loaded on metadata
              //this.onMetadata(existingTorrent, event.detail.uid, event.detail.room, true)
              return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {torrent: existingTorrent, streamToServerReadyPromise: this.streamToServerReadyPromise}, existingTorrent)
            } else {
              await Webtorrent.destroyTorrent(existingTorrent, existingTorrent.infoHash.toLowerCase())
              torrent = client.seed(event.detail.input, Object.assign(event.detail.opts || {}, addOpts))
              this.onInfoHash(torrent)
              // save to storage
              this.onMetadata(torrent, event.detail.uid, event.detail.room, true)
              this.onError(torrent)
              return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {torrent, streamToServerReadyPromise: this.streamToServerReadyPromise}, torrent)
            }
          }
        }
      }, 200)
      this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {torrent, streamToServerReadyPromise: this.streamToServerReadyPromise}, torrent, () => clearInterval(checkTorrentDestroyedIntervalId))
    }

    this.webtorrentResetEventListener = event => this.reset()

    let resetTimeoutId
    this.webtorrentIsStalledEventListener = event => {
      clearTimeout(resetTimeoutId)
      resetTimeoutId = setTimeout(async () => {
        const client = await this.clientPromise
        if (client.torrents.some(torrent => torrent.numPeers > 0) && client.torrents.every(torrent => !torrent.downloadSpeed && !torrent.uploadSpeed)) this.reset()
      }, stallTimeout)
    }

    this.onlineEventListener = event => this.reset()
  }

  async init () {
    if (this.clientDestroyedPromise) await this.clientDestroyedPromise
    // @ts-ignore
    if (this.clientPromise.done) return
    /** @type {WebTorrentConstructor|any} */
    const client = new WebTorrentConstructor()
    // @ts-ignore
    this.clientPromiseResolve(client)
    this.setClientPromise()
    // @ts-ignore
    this.clientPromiseResolve(client)
    client.on('error', error => {
      console.warn('Webtorrent client error:', error)
      this.reset()
    })
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
            client.createServer({ controller })
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

  async destroy () {
    if (this.clientDestroyedPromise) await this.clientDestroyedPromise
    let clientDestroyedResolve = err => err
    /** @type {any} */
    this.clientDestroyedPromise = new Promise(resolve => (clientDestroyedResolve = resolve))
    // @ts-ignore
    if (!this.clientPromise.done) {
      clientDestroyedResolve(null)
      return this.clientDestroyedPromise
    }
    const client = await this.clientPromise
    if (client.destroyed) {
      clientDestroyedResolve(null)
      return this.clientDestroyedPromise
    }
    client.destroy(error => {
      Webtorrent.#torrentMap.clear()
      // init is going to fill this Promise
      this.setClientPromise()
      clientDestroyedResolve(error)
      this.clientDestroyedPromise = null
    })
    return this.clientDestroyedPromise
  }

  reset () {
    clearTimeout(this.resetClientTimeout)
    this.resetClientTimeout = setTimeout(() => {
      this.destroy()
      this.init()
    }, this.hasAttribute('client-reset-delay') ? Number(this.getAttribute('client-reset-delay')) : 2000)
  }

  connectedCallback () {
    this.init()
    document.body.addEventListener(`${this.namespace}add`, this.webtorrentAddEventListener)
    document.body.addEventListener(`${this.namespace}seed`, this.webtorrentSeedEventListener)
    document.body.addEventListener(`${this.namespace}reset`, this.webtorrentResetEventListener)
    document.body.addEventListener(`${this.namespace}is-stalled`, this.webtorrentIsStalledEventListener)
    self.addEventListener('online', this.onlineEventListener)
  }

  disconnectedCallback () {
    this.destroy()
    document.body.removeEventListener(`${this.namespace}add`, this.webtorrentAddEventListener)
    document.body.removeEventListener(`${this.namespace}seed`, this.webtorrentSeedEventListener)
    document.body.removeEventListener(`${this.namespace}reset`, this.webtorrentResetEventListener)
    document.body.removeEventListener(`${this.namespace}is-stalled`, this.webtorrentIsStalledEventListener)
    self.removeEventListener('online', this.onlineEventListener)
  }

  /**
   * @async
   * @param {(any)=>void} resolve
   * @param {boolean} dispatch
   * @param {string|undefined} name
   * @param {any} detail
   * @param {any} torrent
   * @param {() => void} [callback = () => {}]
   * @return {Promise<void>}
   */
  respond (resolve, dispatch, name, detail, torrent, callback = () => {}) {
    const respond = async () => {
      callback()
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

  setClientPromise () {
    // init is going to fill this Promise
    this.clientPromiseResolve = client => client
    this.clientPromise = new Promise(resolve => (this.clientPromiseResolve = resolve))
    // @ts-ignore
    this.clientPromise.done = false
    // @ts-ignore
    this.clientPromise.finally(() => (this.clientPromise.done = true))
  }

  onInfoHash (torrent) {
    torrent.on('infoHash', () => Webtorrent.#torrentMap.set(torrent.infoHash.toLowerCase(), Promise.resolve({torrent, streamToServerReadyPromise: this.streamToServerReadyPromise})))
  }

  onMetadata (torrent, uid, room, self) {
    torrent.on('metadata', () => Webtorrent.#torrentFileMap.set(torrent.infoHash.toLowerCase(), this.webWorker(Webtorrent.saveTorrentFile, torrent.infoHash.toLowerCase(), torrent.torrentFile, location.href, uid, room, self)))
  }

  onError (torrent) {
    // the view shall handle this error more precisely
    torrent.on('error', error => console.warn('Webtorrent torrent error:', error))
  }

  // NOTE: This function must run in a webworker, otherwise getFileHandle does not have the function: createSyncAccessHandle
  static async saveTorrentFile (infoHash, torrentFile, href, uid, room, self = false) {
    /** @type {FileSystemDirectoryHandle} */
    const opfsTorrents = await navigator.storage.getDirectory().then(opfsRoot => opfsRoot.getDirectoryHandle('torrents', { create: true }))
    // @ts-ignore
    const access = await (await opfsTorrents.getFileHandle(infoHash, { create: true })).createSyncAccessHandle({ mode: 'readwrite' })
    // read whats there
    const buffer = new Uint8Array(access.getSize())
    access.read(buffer, { at: 0 })
    /** @type {WEBTORRENT_CONTAINER} */
    let torrentContainers
    try {
      torrentContainers = JSON.parse(new TextDecoder().decode(buffer) || '{}')
    } catch (error) {
      // @ts-ignore
      torrentContainers = {}
    }
    torrentContainers = {
      self: torrentContainers.self ? torrentContainers.self : self,
      room: torrentContainers.room ? torrentContainers.room : room,
      torrentFile: Array.from(torrentFile),
      added: [{
        timestamp: Date.now(),
        href,
        uid,
        room
        // @ts-ignore
      }].concat(torrentContainers.added || [])
    }
    // @ts-ignore
    if (Array.isArray(torrentContainers.added) && torrentContainers.added.length > 20) torrentContainers.added.length = 20
    access.write(new TextEncoder().encode(JSON.stringify(torrentContainers)), { at: 0 })
    access.flush()
    access.close()
    return torrentContainers
  }

  // NOTE: This function must run in a webworker, otherwise getFileHandle does not have the function: createSyncAccessHandle
  static async loadTorrentFile (infoHash) {
    /** @type {FileSystemDirectoryHandle} */
    const opfsTorrents = await navigator.storage.getDirectory().then(opfsRoot => opfsRoot.getDirectoryHandle('torrents', { create: true }))
    // @ts-ignore
    const access = await (await opfsTorrents.getFileHandle(infoHash, { create: true })).createSyncAccessHandle({ mode: 'read-only' })
    const buffer = new Uint8Array(access.getSize())
    access.read(buffer, { at: 0 })
    access.close()
    try {
      return JSON.parse(new TextDecoder().decode(buffer) || '{}')
    } catch (error) {
      return {}
    }
  }

  static destroyTorrent (torrent, infoHash, opts = {}) {
    let torrentDestroyedResolve = torrent => torrent
    /** @type {any} */
    const torrentDestroyedPromise = new Promise(resolve => (torrentDestroyedResolve = resolve))
    torrent.destroy(opts, () => {
      Webtorrent.#torrentMap.delete(infoHash)
      torrentDestroyedResolve()
    })
    return torrentDestroyedPromise
  }
}
