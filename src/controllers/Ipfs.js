// @ts-check
import '../ipfs/index.min.js'
import '../ipfs/blockstore-core@7.0.1/dist/index.min.js'
import '../ipfs/ipfs-unixfs-importer@17.0.1/dist/index.min.js'


/* global Environment */
/* global KuboRpcClient */
/* global IpfsUnixfsImporter */
/* global BlockstoreCore */

/**
 * @typedef {{
 *  origin: string,
 *  supports: ('add'|'cat'|'web-seed'|'fetch')[],
 *  hasError?: boolean,
 *  client?: any
 * }} GATEWAY
 */

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

    // set attribute namespace
    this.namespace = this.getAttribute('namespace') || 'ipfs-'
    /** @type {GATEWAY[]} */
    this.gateways = this.hasAttribute('preset-gateways')
      ? [
        {
          origin: 'https://ipfs.oversas.org',
          supports: ['add', 'cat', 'web-seed', 'fetch']
        },
        {
          origin: 'https://ipfs.io',
          supports: ['web-seed', 'fetch']
        },
        {
          origin: 'https://ipfs.filebase.io',
          supports: ['web-seed', 'fetch']
        },
        {
          origin: 'https://ipfs.network.thegraph.com',
          supports: ['add', 'cat', 'fetch']
        },
        {
          origin: 'https://cdn.ipfsscan.io',
          supports: ['add', 'web-seed', 'fetch']
        },
        {
          origin: 'https://ipfs.decentralized-content.com',
          supports: ['web-seed', 'fetch']
        },
        {
          origin: 'https://dweb.link',
          supports: ['web-seed', 'fetch']
        },
        {
          origin: 'https://dget.top',
          supports: ['fetch']
        },
        {
          origin: 'https://gw.ipfs-lens.dev',
          supports: ['web-seed', 'fetch']
        },
        {
          origin: 'https://api.thegraph.com',
          supports: ['add', 'cat', 'fetch']
        },
        {
          origin: 'https://gateway.pinata.cloud',
          supports: ['web-seed', 'fetch']
        },
        {
          origin: 'https://ipfs.effect.ai',
          supports: ['add', 'web-seed', 'fetch']
        },
        {
          origin: 'https://ipfs.questbook.app',
          supports: ['add', 'cat']
        },
        {
          origin: 'https://gw-seattle.crustcloud.io:443',
          supports: ['add', 'cat']
        }
      ]
      : []
    // @ts-ignore
    if (this.getAttribute('preset-gateways') && typeof this.getAttribute('preset-gateways') === 'string') this.gateways = JSON.parse(this.getAttribute('preset-gateways'))
    // @ts-ignore
    if (Environment?.ipfsGateways) this.gateways = Environment.ipfsGateways.concat(this.gateways)
    this.cidVersion = 0
    this.rawLeaves = false
    this.clientRpcVersion = `/api/v${this.cidVersion}`

    // torrent.addWebSeed from filesMetadata
    this.torrentAddWebSeed = event => {
      const addWebSeedFunc = async torrent => {
        try {
          // we avoid sending the torrent file metadata with the addWebSeed link
          const filesMetadata = JSON.parse(await this.catCidToText(event.detail.cid)).filter(fileMetadata => fileMetadata.type !== 'application/x-bittorrent')
          // https://www.bittorrent.org/beps/bep_0019.html calls a single file .../webtorrent-web-seed/ and multiple .../webtorrent-web-seed/file1/file2
          // also it delivers a range in the header, which can span multiple files, thats why we pass some torrent file data through the addWebSeed url to the service worker
          this.gateways.forEach(gateway => {
            if (gateway.supports.includes('web-seed')) torrent.addWebSeed(`${gateway.origin}/ipfs/files-metadata/${encodeURIComponent(JSON.stringify(filesMetadata))}/webtorrent-web-seed/`)
          })
        } catch (error) {
          console.warn('IPFS addWebSeed filesMetadata error!', error)
        }
      }
      // wait for torrent to be ready, that we can read offset and length
      addWebSeedFunc(event.detail.torrent)
    }

    //TODO: recover torrent with cat to seed when stalled
    // client.cat
    this.ipfsCatEventListener = event => {
      if (!event.detail.cid) return
      Promise.all(event.detail.torrent.files.map(async file => {
        const client = this.getClient('cat').client
        const chunks = []
        // TODO: cat or fetch
        for await (const chunk of client.cat(`${event.detail.cid}/${file.name}`)) {
          chunks.push(chunk)
        }
        return new File(
          chunks,
          file.name,
          {
            type: file.type,
            lastModified: file.lastModified
          }
        )
      })).then(files => {
        console.log('*********', 'added from ipfs', files)
        this.dispatchEvent(new CustomEvent('webtorrent-seed', {
          detail: {
            uid: event.detail.uid,
            room: event.detail.room,
            cid: event.detail.cid,
            input: files,
          },
          bubbles: true,
          cancelable: true,
          composed: true
        }))
      })
    }

    // client.addAll
    this.ipfsSeedEventListener = event => {
      const addAllFunc = async (inputFiles, torrent) => {
        let cidOne, cidTwo
        // returns the filesMetadata cid
        if (event.detail?.resolveCid) this.respond(event.detail?.resolveCid, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {cid: (cidOne = await this.createFileListCid(inputFiles, torrent))})
        // adds and returns the filesMetadata cid
        this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {cid: (cidTwo = await this.addAll(inputFiles, torrent))})
        if (cidOne && cidTwo && cidOne !== cidTwo) console.warn('Error while creating cid\'s', {cidOne, cidTwo})
      }
      // wait for torrent to be ready, that we can read offset and length
      if (event.detail.torrent.ready) return addAllFunc(Array.from(event.detail.input), event.detail.torrent)
      event.detail.torrent.on('ready', () => addAllFunc(Array.from(event.detail.input), event.detail.torrent))
    }

    this.ipfsGetTorrentFileEventListener = async event => this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}torrent-file`, {cid: event.detail.cid, torrentFile: await this.getTorrentFile(event.detail.cid)})
  }

  connectedCallback () {
    document.body.addEventListener(`${this.namespace}add-web-seed`, this.torrentAddWebSeed)
    document.body.addEventListener(`${this.namespace}cat`, this.ipfsCatEventListener)
    document.body.addEventListener(`${this.namespace}seed`, this.ipfsSeedEventListener)
    document.body.addEventListener(`${this.namespace}get-torrent-file`, this.ipfsGetTorrentFileEventListener)
  }

  disconnectedCallback () {
    document.body.removeEventListener(`${this.namespace}add-web-seed`, this.torrentAddWebSeed)
    document.body.removeEventListener(`${this.namespace}cat`, this.ipfsCatEventListener)
    document.body.removeEventListener(`${this.namespace}seed`, this.ipfsSeedEventListener)
    document.body.removeEventListener(`${this.namespace}get-torrent-file`, this.ipfsGetTorrentFileEventListener)
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

  // TODO: Error handling for all client.cat, client.add, etc.
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

  /**
   * Bundles all the files cid's, torrent.files metadata and torrentFile itself into one JSON called filesMetadata and returns it's cid
   * 
   * @param {FileList} inputFiles
   * @param {any} torrent
   * @returns {Promise<string>} // returns the filesMetadata cid
   */
  async addAll (inputFiles, torrent) {
    const client = this.getClient('add').client
    const filesMetadata = []
    // upload files and collect metadata
    let counter = 0
    for await (const result of client.addAll(Ipfs.createFileListArray(inputFiles, torrent), {
      pin: true,
      cidVersion: this.cidVersion,
      rawLeaves: this.rawLeaves,
      wrapWithDirectory: false
    })) {
      filesMetadata.push(Ipfs.createFileMetadata(inputFiles, torrent, result, counter))
      counter++
    }
    return (await client.add(new File(
      [JSON.stringify(filesMetadata)],
      'fileList.json',
      { type: 'application/json' }
    ), {
      pin: true,
      cidVersion: this.cidVersion,
      rawLeaves: this.rawLeaves,
      wrapWithDirectory: false
    })).cid.toString()
  }

  /**
   * Creates cid for fileList
   * 
   * @param {FileList} inputFiles
   * @param {any} torrent
   * @returns {Promise<string>}
   */
  async createFileListCid (inputFiles, torrent) {
    // @ts-ignore
    const blockstore = new BlockstoreCore.MemoryBlockstore()
    let fileListCid = null
    // @ts-ignore
    for await (const result of IpfsUnixfsImporter.importer([{
      path: 'fileList.json',
      content: new File(
        [JSON.stringify(await this.createFileListMetadata(inputFiles, torrent))],
        'fileList.json',
        { type: 'application/json' }
      ).stream()
    }], blockstore, {
      cidVersion: this.cidVersion,
      rawLeaves: this.rawLeaves,
      wrapWithDirectory: false
    })) {
      if (result.path === 'fileList.json') fileListCid = result.cid.toString()
    }
    return fileListCid
  }

  /**
   * Creates cid for fileList
   * 
   * @param {FileList} inputFiles
   * @param {any} torrent
   * @returns {Promise<{cid: string, name: string | 'torrent', type: string | 'application/x-bittorrent', size?: number, offset?: number, length?: number}[]>}
   */
  async createFileListMetadata (inputFiles, torrent) {
    // @ts-ignore
    const blockstore = new BlockstoreCore.MemoryBlockstore()
    const filesMetadata = []
    await Promise.all(Ipfs.createFileListArray(inputFiles, torrent).map(async (file, i) => {
      // @ts-ignore
      for await (const result of IpfsUnixfsImporter.importer([file], blockstore, {
        cidVersion: this.cidVersion,
        rawLeaves: this.rawLeaves,
        wrapWithDirectory: false
      })) {
        // importer emits directory entries too sometimes
        if (!result.path) continue
        filesMetadata.push(Ipfs.createFileMetadata(inputFiles, torrent, result, i))
      }
    }))
    return filesMetadata
  }

  /**
   * Instead of a folder, we create a list of all files plus torrent and put it into an array
   * 
   * @param {FileList} inputFiles
   * @param {any} torrent
   * @returns {{path: string, content: ReadableStream}[]}
   */
  static createFileListArray (inputFiles, torrent) {
    return Array.from(inputFiles).concat([new File(
      [torrent.torrentFile],
      'torrent',
      {
        type: 'application/x-bittorrent'
      }
    )]).map(file => {
      return {
        path: file.name,
        content: file.stream()
      }
    }) // passing file.stream() does not work, for that reason we wait for torrent on done and not torrent on stream to pass the files for seeding
  }

  /**
   * Instead of a folder, we create a list of all files plus torrent and put it into an array
   * 
   * @param {FileList} inputFiles
   * @param {any} torrent
   * @returns {{cid: string, name: string | 'torrent', type: string | 'application/x-bittorrent', size?: number, offset?: number, length?: number}}
   */
  static createFileMetadata (inputFiles, torrent, result, counter) {
    return inputFiles[counter] ?
      {
        cid: result.cid.toString(),
        //lastModified: inputFiles[counter].lastModified, // avoid this, otherwise the cid is always going to change
        name: inputFiles[counter].name,
        type: inputFiles[counter].type,
        size: inputFiles[counter].size,
        offset: torrent.files[counter].offset,
        length: torrent.files[counter].length
      }
      : {
        cid: result.cid.toString(),
        name: 'torrent',
        type: 'application/x-bittorrent'
      }
  }

  /**
   * client.cat file from ipfs
   * 
   * @param {string} cid
   * @returns {Promise<string>}
   */
  async catCidToText (cid) {
    const client = this.getClient('cat').client
    const decoder = new TextDecoder()
    let text = ''
    // TODO: cat or fetch
    for await (const chunk of client.cat(cid)) {
      text += decoder.decode(chunk, { stream: true })
    }
    text += decoder.decode()
    return text
  }

  async catCidToFile (cid, name, type) {
    const client = this.getClient('cat').client
    const chunks = []
    // TODO: cat or fetch
    for await (const chunk of client.cat(cid)) {
      chunks.push(chunk)
    }
    return new File(
      chunks,
      name,
      {
        type: type
      }
    )
  }

  async getTorrentFile (cid) {
    const json = JSON.parse(await this.catCidToText(cid))
    const torrentFileEntry = json.find(entry => entry.type === 'application/x-bittorrent')
    return this.catCidToFile(torrentFileEntry.cid, torrentFileEntry.name, torrentFileEntry.type)
  }

  /**
   * Create a KuboRpcClient
   * 
   * @param {'add'|'cat'|'web-seed'|'fetch'} usage
   * @param {boolean} [ignoreError=false]
   * @returns {GATEWAY}
   */
  getClient (usage, ignoreError = false) {
    return this.gateways.find(gateway => {
      if (!ignoreError && gateway.hasError) return false
      if (!gateway.supports.includes(usage)) return false
      // @ts-ignore
      if (!gateway.client) gateway.client = KuboRpcClient.create({url: `${gateway.origin}${this.clientRpcVersion}`})
      return true
    }) || this.getClient(usage, true)
  }
}
