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
      'https://tracker.peerweb.site',
      'wss://tracker.peerweb.site'
    ]
    this.addOpts = fetch('https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best.txt').then(response => {
        if (response.status >= 200 && response.status <= 299) return response.text()
        throw new Error(response.statusText)
    }).then(text => text.split('\n').filter(text => text)).then(trackers => ({
			announce: Array.from(new Set([
				...presetTrackers,
        ...trackers
			])),
      destroyStoreOnDestroy: false
		})).catch(error => ({announce: presetTrackers}))
    console.log('*********', this.addOpts)

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

    // TODO: only concat: 'unshift', maxLength: 20 for added but not torrentFile
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
    
    const torrentIdMap =  new Map()
    this.webtorrentAddEventListener = async event => {
      if (torrentIdMap.has(event.detail.torrentId)) return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, await torrentIdMap.get(event.detail.torrentId))
      this.client.get(event.detail.torrentId).then(async existingTorrent => {
        // handle possible existing torrent
        if (existingTorrent) {
          if (event.detail.destroyOpts) {
            torrentIdMap.delete(existingTorrent.infoHash)
            torrentIdMap.delete(existingTorrent.magnetURI)
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
        torrent.on('metadata', () => torrentOnMetadata(torrent, event.detail.uid))
        torrent.on('error', error => console.warn('Webtorrent torrent error:', error))
        const result = {torrent, streamToServerReadyPromise}
        // @ts-ignore
        torrentIdMapResolve(result)
        const respond = () => this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}added`, result)
        if (torrent.infoHash) return respond()
        return torrent.on('infoHash', respond)
      })
    }

    this.webtorrentSeedEventListener = async event => {
      let addOpts
      let torrent = this.client.seed(event.detail.input, Object.assign(event.detail.opts || {}, (addOpts = await this.addOpts)))
      // save to storage
      torrent.on('metadata', () => torrentOnMetadata(torrent, event.detail.uid))
      const result = {torrent}
      let checkTorrentDestroyedTimeoutId = null
      const respond = () => {
        clearTimeout(checkTorrentDestroyedTimeoutId)
        return this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, result)
      }
      checkTorrentDestroyedTimeoutId = setTimeout(() => {
        // only way to detect that this torrent already exists, is by looking for the destroyed property
        if (torrent.destroyed) {
          const existingTorrent = this.client.torrents.find(torrent => Array.from(event.detail.input).find(file => file.name === torrent.name))
          if (existingTorrent) {
            if (existingTorrent.done) {
              result.torrent = existingTorrent
              respond()
            } else {
              torrentIdMap.delete(existingTorrent.infoHash)
              torrentIdMap.delete(existingTorrent.magnetURI)
              existingTorrent.destroy()
              result.torrent = this.client.seed(event.detail.input, Object.assign(event.detail.opts || {}, addOpts))
              // save to storage
              result.torrent.on('metadata', () => torrentOnMetadata(result.torrent, event.detail.uid))
              if (result.torrent.infoHash) return respond()
              return result.torrent.on('infoHash', respond)
            }
          }
        }
      }, 200)
      if (torrent.infoHash) return respond()
      return torrent.on('infoHash', respond)
    }
  }

  connectedCallback () {
    this.addEventListener(`${this.namespace}add`, this.webtorrentAddEventListener)
    this.addEventListener(`${this.namespace}seed`, this.webtorrentSeedEventListener)
  }

  disconnectedCallback () {
    this.removeEventListener(`${this.namespace}add`, this.webtorrentAddEventListener)
    this.removeEventListener(`${this.namespace}seed`, this.webtorrentSeedEventListener)
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
