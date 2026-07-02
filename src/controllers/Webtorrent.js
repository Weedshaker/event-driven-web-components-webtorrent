// @ts-check
import { default as WebTorrentConstructor } from '../webtorrent/dist/webtorrent.min.js'
import { WebWorker } from '../event-driven-web-components-prototypes/src/WebWorker.js'

/* global Environment */

/**
 * @typedef {{
 *  isSelf?: boolean,
 *  pinned?: boolean, // do not delete, only available to pin if enough space
 *  paused?: boolean, // load torrent but pause it
 *  deleted?: boolean, // do not load the torrent but show indication to start download. A torrent can only be deleted by the automatic storage cleanup process.
 *  room?: string,
 *  cid?: string,
 *  infoHash?: string,
 *  magnetURI?: string,
 *  name?: string,
 *  progress?: number,
 *  fileTypes?: string[],
 *  length?: number, // bytes
 *  torrentFile: never[],
 *  added: {
 *    timestamp?: string,
 *    href?: string,
 *    uid?: string,
 *    room?: string
 *  }[]
 * }} WEBTORRENT_CONTAINER
 */

/**
 * @typedef {{
 *  torrent,
 *  streamToServerReadyPromise: Promise<ServiceWorkerRegistration> & {done: boolean},
 *  uid?: string,
 *  room?: string,
 *  cid?: string|null,
 *  resetResume?: boolean,
 *  pinned?: boolean, // only used as an webtorrent-add result response
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

  constructor() {
    super()

    /** @type {string} */
    this.importMetaUrl = import.meta.url.replace(/(.*\/)(.*)$/, '$1')
    // set attribute namespace
    this.namespace = this.getAttribute('namespace') || 'webtorrent-'
    // @ts-ignore
    this.opfsMobileQuota = Environment?.opfsMobileQuota || Infinity
    // @ts-ignore
    this.opfsDesktopQuota = Environment?.opfsDesktopQuota || Infinity
    // init is going to fill this Promise
    this.setClientPromise()
    const presetAddOpts = {
      destroyStoreOnDestroy: false,
      createdBy: 'decentral-ninja',
      creationDate: 1, // must be 1 to force the same cid later
      pieceLength: 262144
    }
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
    if (this.getAttribute('preset-trackers') && typeof this.getAttribute('preset-trackers') === 'string') presetTrackers = this.getAttribute('preset-trackers').split(',')
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
        ...presetAddOpts
      })).catch(error => ({announce: presetTrackers, ...presetAddOpts}))
    } else {
      this.addOpts = Promise.resolve({announce: presetTrackers, ...presetAddOpts})
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
      let cid
      if (typeof event.detail.torrentId === 'string') {
        infoHash = event.detail.torrentId.toLowerCase()
        try {
          const torrentIdUrl = new URL(event.detail.torrentId)
          let xt
          if ((xt = torrentIdUrl.searchParams.get('xt'))) infoHash = xt.replace('urn:btih:', '').toLowerCase()
          cid = torrentIdUrl.searchParams.get('cid')
        } catch (error) {}
      }
      // handle existing torrent
      if (await Webtorrent.#torrentMap.has(infoHash)) {
        const existingResult = await Webtorrent.#torrentMap.get(infoHash)
        if (existingResult) {
          if (event.detail.destroyOpts) {
            await Webtorrent.destroyTorrent(existingResult.torrent, infoHash, event.detail.destroyOpts) // If opts.destroyStore is specified, it will override opts.destroyStoreOnDestroy passed when the torrent was added.
          } else {
            this.webWorker(Webtorrent.saveTorrentContainer, Webtorrent.extractTorrentSimpleObj(existingResult.torrent), location.href, event.detail.uid, event.detail.room, event.detail.timestamp, cid)
            return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, {...existingResult, existingResult: true}, existingResult.torrent)
          }
        }
      }
      // figure out the torrentId, best to get torrentFile from storage to resurrect torrent
      /** @type {WEBTORRENT_CONTAINER} */
      const torrentContainer = await this.webWorker(Webtorrent.loadTorrentContainers, infoHash)
      // stop deleted torrents
      if (!event.detail.force && torrentContainer?.deleted) {
        return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}not-added`, {
          error: 'deleted',
          torrentContainer,
          set: 'event.detail.force === true'
        }, null)
      }
      let torrentMapResolve = result => result
      // basically the same as onInfoHash
      Webtorrent.#torrentMap.set(infoHash, new Promise(resolve => (torrentMapResolve = resolve)))
      let torrentId = event.detail.torrentId
      if (torrentContainer?.torrentFile) {
        torrentId = new Uint8Array(torrentContainer.torrentFile)
      } else if (cid) {
        // try to get the torrent through ipfs
        const torrentFile = (await new Promise(resolve => this.dispatchEvent(new CustomEvent('ipfs-get-torrent-file', {
          detail: {
            cid,
            resolve
          },
          bubbles: true,
          cancelable: true,
          composed: true
        })))).torrentFile
        if (torrentFile) torrentId = torrentFile
      }
      const torrent = client.add(torrentId, Object.assign(event.detail.opts || {}, await this.addOpts))
      if (torrentContainer?.paused) torrent.pause()
      /** @type {WEBTORRENT_ADD_SEED_RESULT} */
      const result = {torrent, streamToServerReadyPromise: this.streamToServerReadyPromise, uid: event.detail.uid, room: event.detail.room, cid, resetResume: event.detail.resetResume, pinned: torrentContainer?.pinned}
      torrentMapResolve(result)
      // save to storage
      this.onReady(torrent, event.detail.uid, event.detail.room, event.detail.timestamp, cid, undefined, undefined, false)
      // upload to ipfs || wait until done, on stream did not work so far
      torrent.on('done', () => {
        // this function has to be called from time to time, cleaning OPFS
        this.estimateAndRemoveExceedingEntries()
        if (cid && !torrent.paused) this.dispatchEvent(new CustomEvent('ipfs-seed', {
          detail: {
            torrent
          },
          bubbles: true,
          cancelable: true,
          composed: true
        }))
      })
      this.onError(torrent)
      this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, result, result.torrent, () => {
        // inform ipfs about this cid to addWebSeed to the torrent when torrent.on 'infoHash'
        if (cid) this.dispatchEvent(new CustomEvent('ipfs-add-web-seed', {
          detail: {
            cid,
            torrent
          },
          bubbles: true,
          cancelable: true,
          composed: true
        }))
      })
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
      // this function has to be called from time to time, cleaning OPFS
      this.estimateAndRemoveExceedingEntries()
      const client = await this.clientPromise
      const input = Array.from(event.detail.input).sort((a, b) => a.name.localeCompare(b.name))
      // when the first file in the file list is a torrent file, load the torrent file
      const addOrSeedFunc = async (input, opts) => input.length === 1 && input[0]?.type === 'application/x-bittorrent'
        ? client.add(input[0], Object.assign(opts || {}, await this.addOpts))
        : client.seed(input, Object.assign(opts || {}, await this.addOpts))
      let torrent = await addOrSeedFunc(input, event.detail.opts)
      this.onInfoHash(torrent, event.detail.uid, event.detail.room, event.detail.cid, event.detail.resetResume)
      // save to storage
      this.onReady(torrent, event.detail.uid, event.detail.room, event.detail.timestamp, event.detail.cid, true, false, false)
      this.onError(torrent)
      // no event like warning or error is fired from webtorrent as well as destroy has no event
      const checkTorrentDestroyedIntervalId = setInterval(async () => {
        // to detect that this torrent already exists, is by looking for the destroyed property or else the infoHash would have to be precalculated
        if (torrent.destroyed) {
          clearInterval(checkTorrentDestroyedIntervalId)
          const existingTorrent = (torrent.infoHash && client.torrents.find(existingTorrent => torrent.infoHash === existingTorrent.infoHash)) || client.torrents.find(existingTorrent => input.find(file => file.name === existingTorrent.name))
          if (existingTorrent) {
            if (existingTorrent.done) {
              // Not needed to onReady, onInfoHash or onError because this torrent must have been saved when loaded
              return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {torrent: existingTorrent, streamToServerReadyPromise: this.streamToServerReadyPromise}, existingTorrent)
            } else {
              await Webtorrent.destroyTorrent(existingTorrent, existingTorrent.infoHash.toLowerCase())
              torrent = await addOrSeedFunc(input, event.detail.opts)
              this.onInfoHash(torrent, event.detail.uid, event.detail.room, event.detail.cid, event.detail.resetResume)
              // save to storage
              this.onReady(torrent, event.detail.uid, event.detail.room, event.detail.timestamp, event.detail.cid, true, false, false)
              this.onError(torrent)
              return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {torrent, streamToServerReadyPromise: this.streamToServerReadyPromise}, torrent)
            }
          }
        }
      }, 200)
      this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {torrent, streamToServerReadyPromise: this.streamToServerReadyPromise}, torrent, () => clearInterval(checkTorrentDestroyedIntervalId))
    }

    this.webtorrentResetEventListener = event => this.reset(event.detail?.checkIfStalled)

    this.webtorrentPauseEventListener = async event => {
      if (event.detail.pause) {
        event.detail.torrent.pause()
        this.webWorker(Webtorrent.saveTorrentContainer,Webtorrent.extractTorrentSimpleObj(event.detail.torrent), undefined, undefined, undefined, undefined, undefined, undefined, undefined, true)
      } else {
        event.detail.torrent.resume()
        this.webWorker(Webtorrent.saveTorrentContainer, Webtorrent.extractTorrentSimpleObj(event.detail.torrent), undefined, undefined, undefined, undefined, undefined, undefined, undefined, false)
        let addSeedResult
        if (event.detail.torrent?.done && (addSeedResult = await Webtorrent.#torrentMap.get(event.detail.torrent.infoHash)) && addSeedResult.cid) this.dispatchEvent(new CustomEvent('ipfs-seed', {
          detail: {
            torrent: event.detail.torrent
          },
          bubbles: true,
          cancelable: true,
          composed: true
        }))
      }
    }

    this.webtorrentPinEventListener = async event => {
      const torrentContainer = (await Webtorrent.#torrentMap.get(event.detail.torrent.infoHash))
      if (event.detail.pinned) {
        this.webWorker(Webtorrent.saveTorrentContainer, Webtorrent.extractTorrentSimpleObj(event.detail.torrent), undefined, undefined, undefined, undefined, undefined, undefined, true)
        if (torrentContainer) {
          torrentContainer.pinned = true
          Webtorrent.#torrentMap.set(event.detail.torrent.infoHash, Promise.resolve(torrentContainer))
        }
      } else {
        this.webWorker(Webtorrent.saveTorrentContainer, Webtorrent.extractTorrentSimpleObj(event.detail.torrent), undefined, undefined, undefined, undefined, undefined, undefined, false)
        if (torrentContainer) {
          torrentContainer.pinned = false
          Webtorrent.#torrentMap.set(event.detail.torrent.infoHash, Promise.resolve(torrentContainer))
        }
      }
    }

    let resetCounter = 0
    this.webtorrentViewResetLinkClickEventListener = event => {
      // every 3rd time reset
      if (resetCounter % 3 === 2) this.reset()
      // show reload icon at seventh reset click
      if (resetCounter === 6) this.dispatchEvent(new CustomEvent('hint-reload', {
        bubbles: true,
        cancelable: true,
        composed: true
      }))
      resetCounter++
    }

    this.webtorrentViewIsStalledEventListener = async event => {
      let torrentContainer
      if (!event.detail.torrent.done && !event.detail.torrent.paused && (torrentContainer = (await Webtorrent.#torrentMap.get(event.detail.torrent.infoHash)))) {
        if (torrentContainer.cid) new Promise(resolve => this.dispatchEvent(new CustomEvent('ipfs-cat', {
          detail: {
            torrent: torrentContainer.torrent || event.detail.torrent,
            uid: event.detail.uid || torrentContainer.uid,
            room: torrentContainer.room,
            cid: torrentContainer.cid,
            resolve
          },
          bubbles: true,
          cancelable: true,
          composed: true
        }))).then(result => {
          if (Array.isArray(result.files) && result.files.length && result.files.every(file => file)) {
            this.webtorrentSeedEventListener({
              detail: {
                input: result.files,
                uid: event.detail.uid || torrentContainer.uid,
                room: torrentContainer.room,
                cid: torrentContainer.cid
              }
            })
          } else {
            this.reset()
          }
        })
      }
    }

    const fileErrorTorrentId = []
    let fileErrorTimestamp = Date.now()
    this.webtorrentViewFileErrorEventListener = event => {
      // not form the same torrent/torrentId
      if (event.detail?.torrentId && !fileErrorTorrentId.includes(event.detail.torrentId)) {
        if (!event.detail?.wasStreaming) {
          // not streaming, file errors within 2s do not check if stalled
          this.reset(fileErrorTimestamp + 2000 < Date.now()
            ? false
            : true
          )
        }
        fileErrorTimestamp = Date.now()
        fileErrorTorrentId.push(event.detail.torrentId)
      }
    }

    const torrentErrorTorrentId = []
    this.webtorrentViewTorrentErrorEventListener = event => {
      if (event.detail?.torrentId && !torrentErrorTorrentId.includes(event.detail.torrentId)) {
        this.reset(true)
        torrentErrorTorrentId.push(event.detail.torrentId)
      }
    }

    // chat message got deleted, for that find the torrent and delete it
    this.chatDeletedEventListener = async event => {
      const torrentContainers = (await this.webWorker(Webtorrent.loadTorrentContainers))
        .filter(torrentContainer => !torrentContainer.deleted && torrentContainer.added.some(added => Number(added.timestamp) === event.detail.timestamp))
      for (const torrentContainer of torrentContainers) {
        const {torrent, error}  = await new Promise(resolve => this.webtorrentAddEventListener({
          detail: {
            torrentId: torrentContainer.magnetURI,
            resolve
          }
        }))
        if (!torrent || error) break
        if (torrentContainer.added.every(added => added.timestamp === undefined || Number(added.timestamp) === event.detail.timestamp)) {
          await Webtorrent.destroyTorrent(torrent, torrentContainer.infoHash || torrent.infoHash, {destroyStore: true})
          this.webWorker(Webtorrent.saveTorrentContainer, Webtorrent.extractTorrentSimpleObj(torrent), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'destroyStore')
        } else {
          this.webWorker(Webtorrent.saveTorrentContainer, Webtorrent.extractTorrentSimpleObj(torrent), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, [{key: 'timestamp', value: event.detail.timestamp}])
        }
      }
    }

    // room got deleted, for that find the torrents and delete it
    this.yjsDeletedRoomEventListener = async event => {
      const torrentContainers = (await this.webWorker(Webtorrent.loadTorrentContainers))
        .filter(torrentContainer => !torrentContainer.deleted && torrentContainer.added.some(added => event.detail.rooms.includes(added.room)))
      for (const torrentContainer of torrentContainers) {
        const {torrent, error, existingResult}  = await new Promise(resolve => this.webtorrentAddEventListener({
          detail: {
            torrentId: torrentContainer.magnetURI,
            resolve
          }
        }))
        if (!torrent || error) break
        if (torrentContainer.added.every(added => added.room === undefined || event.detail.rooms.includes(added.room))) {
          await Webtorrent.destroyTorrent(torrent, torrentContainer.infoHash || torrent.infoHash, {destroyStore: true})
          this.webWorker(Webtorrent.saveTorrentContainer, Webtorrent.extractTorrentSimpleObj(torrent), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'destroyStore')
        } else {
          this.webWorker(Webtorrent.saveTorrentContainer, Webtorrent.extractTorrentSimpleObj(torrent), undefined, undefined, undefined, undefined, undefined, undefined, undefined, existingResult, undefined, event.detail.rooms.map(room => ({key: 'room', value: room})))
        }
      }
    }
    
    this.onlineEventListener = event => this.reset(true)
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

  reset (checkIfStalled = false) {
    clearTimeout(this.resetClientTimeout)
    this.resetClientTimeout = setTimeout(async () => {
      if (checkIfStalled && (await this.clientPromise).torrents.some(torrent => torrent.downloadSpeed || torrent.uploadSpeed)) return false
      const resumeTorrents = (await Promise.all(Array.from(Webtorrent.#torrentMap.map).map(async ([key, value]) => {
        const result = await value
        if (!result.resetResume && !result.pinned) return null
        return result
      }))).filter(Boolean)
      await this.destroy()
      await this.init()
      resumeTorrents.forEach(resumeTorrent => this.webtorrentAddEventListener({
        detail: {
          torrentId: `${resumeTorrent?.torrent.magnetURI}${resumeTorrent?.cid ? `&cid=${resumeTorrent.cid}` : ''}`,
          uid: resumeTorrent?.uid,
          room: resumeTorrent?.room,
          resetResume: resumeTorrent?.resetResume
        }
      }))
      this.dispatchEvent(new CustomEvent(`${this.namespace}did-reset`, {
        bubbles: true,
        cancelable: true,
        composed: true
      }))
      return true
    }, this.hasAttribute('client-reset-delay') ? Number(this.getAttribute('client-reset-delay')) : 2000)
  }

  connectedCallback () {
    this.init().then(async () => {
      document.body.setAttribute(`${this.namespace}ready`, 'true')
      this.dispatchEvent(new CustomEvent(`${this.namespace}ready`, {
        detail: {
          ready: true
        },
        bubbles: true,
        cancelable: true,
        composed: true
      }))
      // resume opfs saved, pinned and not paused torrentContainers
      const torrentContainers = (await this.webWorker(Webtorrent.loadTorrentContainers)).filter(torrentContainer => torrentContainer.pinned && !torrentContainer.paused && !torrentContainer.deleted)
      for (const torrentContainer of torrentContainers) {
        this.webtorrentAddEventListener({
          detail: {
            torrentId: `${torrentContainer.magnetURI}${torrentContainer.cid ? `&cid=${torrentContainer.cid}` : ''}`,
            uid: torrentContainer.added[0]?.uid,
            room: torrentContainer.room
          }
        })
      }
    })
    document.body.addEventListener(`${this.namespace}add`, this.webtorrentAddEventListener)
    document.body.addEventListener(`${this.namespace}seed`, this.webtorrentSeedEventListener)
    document.body.addEventListener(`${this.namespace}reset`, this.webtorrentResetEventListener)
    document.body.addEventListener(`${this.namespace}pause`, this.webtorrentPauseEventListener)
    document.body.addEventListener(`${this.namespace}pin`, this.webtorrentPinEventListener)
    document.body.addEventListener(`${this.namespace}view-is-stalled`, this.webtorrentViewIsStalledEventListener)
    document.body.addEventListener(`${this.namespace}view-file-error`, this.webtorrentViewFileErrorEventListener)
    document.body.addEventListener(`${this.namespace}view-torrent-error`, this.webtorrentViewTorrentErrorEventListener)
    document.body.addEventListener(`${this.namespace}view-reset-link-click`, this.webtorrentViewResetLinkClickEventListener)
    this.addEventListener('chat-deleted', this.chatDeletedEventListener)
    this.addEventListener('yjs-deleted-room', this.yjsDeletedRoomEventListener)
    self.addEventListener('online', this.onlineEventListener)
  }

  disconnectedCallback () {
    this.destroy().then(() => {
      document.body.removeAttribute(`${this.namespace}ready`)
      this.dispatchEvent(new CustomEvent(`${this.namespace}ready`, {
        detail: {
          ready: false
        },
        bubbles: true,
        cancelable: true,
        composed: true
      }))
    })
    document.body.removeEventListener(`${this.namespace}add`, this.webtorrentAddEventListener)
    document.body.removeEventListener(`${this.namespace}seed`, this.webtorrentSeedEventListener)
    document.body.removeEventListener(`${this.namespace}reset`, this.webtorrentResetEventListener)
    document.body.removeEventListener(`${this.namespace}pause`, this.webtorrentPauseEventListener)
    document.body.removeEventListener(`${this.namespace}pin`, this.webtorrentPinEventListener)
    document.body.removeEventListener(`${this.namespace}view-is-stalled`, this.webtorrentViewIsStalledEventListener)
    document.body.removeEventListener(`${this.namespace}view-file-error`, this.webtorrentViewFileErrorEventListener)
    document.body.removeEventListener(`${this.namespace}view-torrent-error`, this.webtorrentViewTorrentErrorEventListener)
    document.body.removeEventListener(`${this.namespace}view-reset-link-click`, this.webtorrentViewResetLinkClickEventListener)
    this.removeEventListener('chat-deleted', this.chatDeletedEventListener)
    this.removeEventListener('yjs-deleted-room', this.yjsDeletedRoomEventListener)
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
    if (!torrent || torrent.infoHash) return respond()
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

  onInfoHash (torrent, uid, room, cid, resetResume) {
    torrent.on('infoHash', () => {
      const infoHash = torrent.infoHash.toLowerCase()
      Webtorrent.#torrentMap.set(infoHash, Promise.resolve({torrent, streamToServerReadyPromise: this.streamToServerReadyPromise, uid, room, cid, resetResume}))
      this.dispatchEvent(new CustomEvent(`${this.namespace}${infoHash}`, {
        detail: {
          infoHash
        },
        bubbles: true,
        cancelable: true,
        composed: true
      }))
    })
  }

  onReady (torrent, uid, room, timestamp, cid, isSelf, paused, deleted) {
    torrent.on('ready', () => this.webWorker(Webtorrent.saveTorrentContainer, Webtorrent.extractTorrentSimpleObj(torrent), location.href, uid, room, timestamp, cid, isSelf, undefined, paused, deleted))
  }

  onError (torrent) {
    // the view shall handle this error more precisely
    torrent.on('error', error => console.warn('Webtorrent torrent error:', error))
  }

  estimateAndRemoveExceedingEntries () {
    clearTimeout(this.removeEntriesTimeout)
    this.removeEntriesTimeout = setTimeout(async () => {
      const { usage: navigatorUsage = 0, quota: navigatorQuota = 0 } = await navigator.storage.estimate()
      // @ts-ignore
      const quota = Math.min(navigatorQuota * 0.8, navigator.userAgentData?.mobile ?? /Mobi|Android/i.test(navigator.userAgent) ? this.opfsMobileQuota : this.opfsDesktopQuota)
      if (navigatorUsage > quota) {
        const torrentContainers = (await this.webWorker(Webtorrent.loadTorrentContainers))
          .filter(torrentContainer => !torrentContainer.pinned && !torrentContainer.deleted)
          .sort((a, b) => (a.added[0]?.timestamp || 0) - (b.added[0]?.timestamp || 0))
        let usage = navigatorUsage
        for (const torrentContainer of torrentContainers) {
          if (usage < quota) break
          const {torrent, error}  = await new Promise(resolve => this.webtorrentAddEventListener({
            detail: {
              torrentId: torrentContainer.magnetURI,
              resolve
            }
          }))
          if (torrent && !error) {
            await Webtorrent.destroyTorrent(torrent, torrentContainer.infoHash || torrent.infoHash, {destroyStore: true})
            await this.webWorker(Webtorrent.saveTorrentContainer, Webtorrent.extractTorrentSimpleObj(torrent), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true)
          }
          usage -= torrentContainer.length || torrent.length
        }
      }
    }, 5000)
  }

  /**
   * NOTE: This function must run in a webworker, otherwise getFileHandle does not have the function: createSyncAccessHandle
   * 
   * @async
   * @static
   * @param {any} torrent
   * @param {string} [href=undefined]
   * @param {string} [uid=undefined]
   * @param {string} [room=undefined]
   * @param {string} [timestamp=undefined]
   * @param {string} [cid=undefined]
   * @param {boolean} [isSelf=undefined]
   * @param {boolean} [pinned=undefined]
   * @param {boolean} [paused=undefined]
   * @param {boolean|'destroyStore'} [deleted=undefined]
   * @param {{key: string, value: number|string}[]} [deleteAdded=[]]
   * @returns {Promise<WEBTORRENT_CONTAINER|null>}
   */
  static async saveTorrentContainer (torrent, href = undefined, uid = undefined, room = undefined, timestamp = undefined, cid = undefined, isSelf = undefined, pinned = undefined, paused = undefined, deleted = undefined, deleteAdded = []) {
    if (!torrent) return null
    const infoHash = torrent.infoHash?.toLowerCase()
    if (!infoHash) return null
    /** @type {FileSystemDirectoryHandle} */
    const torrentsDir = await navigator.storage.getDirectory().then(opfsRoot => opfsRoot.getDirectoryHandle('torrents', { create: true }))
    if (deleted === 'destroyStore') {
      try {
        await torrentsDir.removeEntry(infoHash)
        return null
      } catch (err) {
        // just continue and try to set deleted = true
      }
    } 
    // @ts-ignore
    const access = await (await torrentsDir.getFileHandle(infoHash, { create: true })).createSyncAccessHandle({ mode: 'readwrite' })
    // read whats there
    const buffer = new Uint8Array(access.getSize())
    access.read(buffer, { at: 0 })
    /** @type {WEBTORRENT_CONTAINER} */
    let torrentContainer
    try {
      torrentContainer = JSON.parse(new TextDecoder().decode(buffer) || '{}')
    } catch (error) {
      // @ts-ignore
      torrentContainer = {}
    }
    torrentContainer = {
      added: deleted 
        ? []
        : href || uid || room || timestamp
          ? [{
            timestamp: timestamp,
            href,
            uid,
            room
            // @ts-ignore
          }].concat(torrentContainer.added || [])
          : torrentContainer.added || [],
      room: torrentContainer.room === undefined ? room : torrentContainer.room,
      cid: torrentContainer.cid === undefined ? cid : torrentContainer.cid,
      isSelf: torrentContainer.isSelf === undefined ? isSelf : torrentContainer.isSelf,
      pinned: pinned === undefined ? torrentContainer.pinned : pinned,
      paused: paused === undefined ? torrentContainer.paused : paused,
      deleted: deleted === undefined ? torrentContainer.deleted : deleted === 'destroyStore' ? true : deleted,
      infoHash: torrentContainer.infoHash === undefined ? infoHash : torrentContainer.infoHash,
      magnetURI: torrentContainer.magnetURI === undefined ? torrent.magnetURI : torrentContainer.magnetURI,
      name: torrentContainer.name === undefined ? torrent.name : torrentContainer.name,
      length: torrentContainer.length === undefined ? torrent.length : torrentContainer.length,
      progress: torrent.progress,
      fileTypes: torrentContainer.fileTypes === undefined ? torrent.fileTypes : torrentContainer.fileTypes,
      torrentFile: torrent.torrentFile
        ? Array.from(torrent.torrentFile)
        : torrentContainer.torrentFile
    }
    deleteAdded.forEach(({key, value}) => {
      torrentContainer.added = torrentContainer.added.reduce((acc, added) => {
        // @ts-ignore
        if (value && (isNaN(value) ? added[key] === value : Number(added[key]) === value)) return acc
        // @ts-ignore
        acc.push(added)
        return acc
      }, [])
    })
    // filter unique message-timestamp or rooms
    const timestamps = []
    const rooms = []
    torrentContainer.added = torrentContainer.added.filter(added => {
      if (added.timestamp) {
        if (timestamps.includes(added.timestamp)) return false
        timestamps.push(added.timestamp)
        return true
      } else {
        if (rooms.includes(added.room)) return false
        rooms.push(added.room)
        return true
      }
    })
    access.truncate(0)
    access.write(new TextEncoder().encode(JSON.stringify(torrentContainer)), { at: 0 })
    access.flush()
    access.close()
    return torrentContainer
  }

  /**
   * NOTE: This function must run in a webworker, otherwise getFileHandle does not have the function: createSyncAccessHandle
   * returns one (with infoHash) or all torrent containers
   * 
   * @async
   * @static
   * @param {string} [infoHash='']
   * @returns {Promise<WEBTORRENT_CONTAINER|{}|WEBTORRENT_CONTAINER[]|{}[]>}
   */
  static async loadTorrentContainers (infoHash = '') {
    /** @type {FileSystemDirectoryHandle} */
    const torrentsDir = await navigator.storage.getDirectory().then(opfsRoot => opfsRoot.getDirectoryHandle('torrents', { create: true }))
    const readJson = async fileHandle => {
      const access = await fileHandle.createSyncAccessHandle({ mode: 'read-only' })
      const buffer = new Uint8Array(access.getSize())
      access.read(buffer, { at: 0 })
      access.close()
      try {
        return JSON.parse(new TextDecoder().decode(buffer) || '{}')
      } catch (error) {
        return {}
      }
    }
    if (infoHash) {
      return readJson(await torrentsDir.getFileHandle(infoHash, { create: true }))
    } else {
      const torrentContainers = []
      for await (const [name, fileHandle] of torrentsDir.entries()) {
        if (fileHandle.kind !== 'file') continue
        torrentContainers.push(readJson(fileHandle))
      }
      return Promise.all(torrentContainers)
    }
  }

  static extractTorrentSimpleObj (torrent) {
    if (!torrent) return null
    return {
      infoHash: torrent.infoHash,
      magnetURI: torrent.magnetURI,
      name: torrent.name,
      length: torrent.length,
      progress: torrent.progress,
      fileTypes: torrent.files.map(file => file.type),
      torrentFile: torrent.torrentFile
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
