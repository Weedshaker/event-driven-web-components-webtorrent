// @ts-check
import '../ipfs/index.min.js'

/* global Environment */
/* global KuboRpcClient */

/**
 * https://github.com/ipfs/js-kubo-rpc-client/tree/main
 * // TODO: IPFS service provider choose by ping / https://ipfs.qzz.io/ type health check / ipfs hosted file with providers
 * // TODO: Error handling (CORS)
 *
 * @export
 * @return {CustomElementConstructor | *}
 */
export default class Ipfs extends HTMLElement {
  constructor() {
    super()

    /** @type {string} */
    this.importMetaUrl = import.meta.url.replace(/(.*\/)(.*)$/, '$1')
    // set attribute namespace
    this.namespace = this.getAttribute('namespace') || 'ipfs-'
    const stallTimeout = 6000 // has to be less than the timeout at view
    this.clientUrl = 'https://ipfs.oversas.org'
    this.clientRpcVersion = '/api/v0'
    // init is going to fill this Promise
    this.setClientPromise()

    // TODO: Error handling
    /*
    for await (const chunk of client.cat(cid, {
      timeout: 10000
    })) {
      ...
    }
    */
    // ----------------
    // TODO: use abort controller array per client and clear all when client gets connected to an other ipfs service provider
    /*
    const controller = new AbortController()

    try {
      for await (const chunk of client.cat(cid, {
        signal: controller.signal
      })) {
        text += decoder.decode(chunk, { stream: true })
      }

      text += decoder.decode()
    } catch (err) {
      if (controller.signal.aborted) {
        console.log('Download cancelled')
      } else {
        console.error(err)
      }
    }
    */
    // client.cat
    this.ipfsAddEventListener = async event => {
      const addWebSeedFunc = torrent => {
        clearTimeout(readyTimeoutId)
        // https://www.bittorrent.org/beps/bep_0019.html calls a single file .../webtorrent-web-seed/ and multiple .../webtorrent-web-seed/file1/file2
        // also it delivers a range in the header, which can span multiple files, thats why we pass some torrent file data through the addWebSeed url to the service worker
        const filesMetadata = encodeURIComponent(JSON.stringify(torrent.files.reduce((acc, file) => {
          acc.push({name: file.name, offset: file.offset, length: file.length})
          return acc
        }, [])))
        // TODO: add multiple ipfs web seeds
        torrent.addWebSeed(`${this.clientUrl}/ipfs/${event.detail.cid}/files-metadata/${filesMetadata}/webtorrent-web-seed/`)
      }
      // when torrent does not have torrent file and does not become ready, in that case... after some timeout... we fetch the torrent file from ipfs
      const readyTimeoutId = setTimeout(async () => {
        const client = await this.clientPromise
        const chunks = []
        for await (const chunk of client.cat(`${event.detail.cid}/torrent`)) {
          chunks.push(chunk)
        }
        const torrentFile = new File(
          chunks,
          'torrent',
          {
            type: 'application/x-bittorrent'
          }
        )
        new Promise(resolve => this.dispatchEvent(new CustomEvent('webtorrent-seed', {
          detail: {
            uid: event.detail.uid,
            room: event.detail.room,
            input: [torrentFile],
            resolve
          },
          bubbles: true,
          cancelable: true,
          composed: true
        }))).then(({torrent}) => addWebSeedFunc(torrent))
      }, 2000)
      event.detail.torrent.on('ready', () => {
        clearTimeout(readyTimeoutId)
        addWebSeedFunc(event.detail.torrent)
      })
    }

    // client.addAll
    this.ipfsSeedEventListener = async event => {
      const client = await this.clientPromise
      let directoryResult
      // todo: error handling try/catch
      for await (const result of client.addAll(Array.from(event.detail.input).concat([event.detail.torrent.torrentFile]).map(file => ({
        path: file.name || 'torrent',
        content: file
      })), {pin: true, wrapWithDirectory: true})) {
        directoryResult = result
      }
      // creates a directory cid and allows routing by name eg.: https://ipfs.io/ipfs/QmUtvc4sz34X2163vkoPAjRfjRKDPdB7PqwjrvRabaMt8j/3 6 9 Power Tesla.jpg
      this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {cid: directoryResult.cid.toString()})
    }
  }

  async init () {
    if (this.clientDestroyedPromise) await this.clientDestroyedPromise
    // @ts-ignore
    if (this.clientPromise.done) return
    // @ts-ignore
    const client = KuboRpcClient.create({url: `${this.clientUrl}${this.clientRpcVersion}`})
    // @ts-ignore
    this.clientPromiseResolve(client)
    this.setClientPromise()
    // @ts-ignore
    this.clientPromiseResolve(client)
    // @ts-ignore
    if (this.clientPromise.done) return
    
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
    client.stop().then(() => {
      // init is going to fill this Promise
      this.setClientPromise()
      clientDestroyedResolve(null)
      this.clientDestroyedPromise = null
    })
    return this.clientDestroyedPromise
  }

  connectedCallback () {
    this.init()
    document.body.addEventListener(`${this.namespace}add`, this.ipfsAddEventListener)
    document.body.addEventListener(`${this.namespace}seed`, this.ipfsSeedEventListener)
  }

  disconnectedCallback () {
    this.destroy()
    document.body.removeEventListener(`${this.namespace}add`, this.ipfsAddEventListener)
    document.body.removeEventListener(`${this.namespace}seed`, this.ipfsSeedEventListener)
  }

  /**
   * @async
   * @param {(any)=>void} resolve
   * @param {boolean} dispatch
   * @param {string|undefined} name
   * @param {any} detail
   * @param {() => void} [callback = () => {}]
   * @return {Promise<void>}
   */
  respond (resolve, dispatch, name, detail, callback = () => {}) {
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
    return respond()
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
}
