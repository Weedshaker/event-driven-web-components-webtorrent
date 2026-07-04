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
 *  hasAddError?: boolean,
 *  client?: any
 * }} GATEWAY
 */

/**
 * @typedef {{
 *  cid: string,
 *  name: string | 'torrent',
 *  type: string | 'application/x-bittorrent',
 *  size?: number,
 *  offset?: number,
 *  length?: number}
 * } FILE_METADATA
 */

/**
 * https://github.com/ipfs/js-kubo-rpc-client/tree/main
 *
 * @export
 * @return {CustomElementConstructor | *}
 */
export default class Ipfs extends HTMLElement {
  constructor() {
    super()

    // set attribute namespace
    this.namespace = this.getAttribute('namespace') || 'ipfs-'
    this.generalRequestTimeout = 10000
    /** @type {GATEWAY[]} */
    this.gateways = this.hasAttribute('preset-gateways')
      ? [
        {
          origin: 'https://ipfs.peerweb.site',
          supports: ['add']
        },{
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
          supports: ['web-seed', 'fetch']
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
      if (this.getAttribute('preset-gateways') && typeof this.getAttribute('preset-gateways') === 'string') {
        try {
          // @ts-ignore
          this.gateways = JSON.parse(this.getAttribute('preset-gateways'))
        } catch (error) {
          console.warn('passed preset-gateways are not valid json')
        }
    }
    // @ts-ignore
    if (Environment?.ipfsGateways) this.gateways = Environment.ipfsGateways.concat(this.gateways)
    // can be async aka. lazy, is faster than the next request but even if not, it is not crucial, since this only loads if a gateway every hadError or hadAddError
    const gatewayOrigins = []
    this.loadGateways().then(result => (this.gateways = this.gateways.filter(gateway => {
      if (gatewayOrigins.includes(gateway.origin)) return false
      gatewayOrigins.push(gateway.origin)
      return true
    }).map(gateway => {
      let loadedGateway
      if (Array.isArray(result.value) && (loadedGateway = result.value.find(loadedGateway => gateway.origin === loadedGateway.origin))) {
        return Object.assign(loadedGateway, gateway)
      }
      return gateway
    })))
    this.cidVersion = 0
    this.rawLeaves = false
    this.clientRpcVersion = `/api/v${this.cidVersion}`

    // torrent.addWebSeed from filesCidMetadata
    // dispatched from controllers/Webtorrent.js when webtorrentAddEventListener => torrent.on 'infoHash'
    this.torrentAddWebSeed = async event => {
      const filterFileMetadata = fileListText => {
        try {
          const fileMetadata = typeof fileListText === 'string' ? JSON.parse(fileListText) : fileListText
          // we avoid sending the torrent file metadata with the addWebSeed link
          return fileMetadata.filter(fileMetadata => fileMetadata.type !== 'application/x-bittorrent')
        } catch (error) {
          console.warn('IPFS addWebSeed filesCidMetadata error!', error)
          return null
        }
      }
      const addWebSeedFunc = (torrent, filesCidMetadata) => {
        // https://www.bittorrent.org/beps/bep_0019.html calls a single file .../webtorrent-web-seed/ and multiple .../webtorrent-web-seed/file1/file2
        // so we pass some torrent file data through the addWebSeed url to the service worker
        this.gateways.forEach(gateway => {
          if (!gateway.hasError && gateway.supports.includes('web-seed') && !torrent.destroyed) torrent.addWebSeed(`${gateway.origin}/ipfs/files-metadata/${encodeURIComponent(JSON.stringify(filesCidMetadata))}/webtorrent-web-seed/`)
        })
      }
      // cat/fetch the filesMetadata from IPFS
      const fileListText = await this.catCidToText(event.detail.cid, true)
      let filesCidMetadata
      if (fileListText && (filesCidMetadata = filterFileMetadata(fileListText))) {
        addWebSeedFunc(event.detail.torrent, filesCidMetadata)
      } else {
        // wait for torrent to be ready, that we can read all files data to create the fileMetadata from scratch
        const doOnMetadata = async () => {
          const filesCidMetadata = await this.createFileListCidMetadata(event.detail.torrent.files, event.detail.torrent)
          addWebSeedFunc(event.detail.torrent, filterFileMetadata(filesCidMetadata))
          // add the filesCidMetadata to IPFS
          this.add(Ipfs.createFileListJsonFile(filesCidMetadata))
        }
        if (event.detail.torrent.metadata) return doOnMetadata()
        return event.detail.torrent.on('metadata', doOnMetadata)
      }
    }

    // client.cat
    this.ipfsCatEventListener = async event => {
      const fileListText = await this.catCidToText(event.detail.cid, true)
      if (!fileListText) return null
      let fileList
      try {
        fileList = JSON.parse(fileListText)
      } catch (error) {
        return null
      }
      this.respond(event.detail.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}catted`, {files: await Promise.all(fileList.filter(entry => entry.type !== 'application/x-bittorrent').map(entry => this.catCidToFile(entry.cid, entry.name, entry.type)))})
    }

    // client.addAll
    this.ipfsSeedEventListener = event => {
      const addAllFunc = async (inputFiles, torrent) => {
        let cidOne, cidTwo
        // returns the filesCidMetadata cid
        if (event.detail?.resolveCid) this.respond(event.detail.resolveCid, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {cid: (cidOne = await this.createFileListCid(inputFiles, torrent))})
        // adds and returns the filesCidMetadata cid
        this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {cid: (cidTwo = await this.addAll(inputFiles, torrent))})
        if (cidOne && cidTwo && cidOne !== cidTwo) console.warn('Error while creating cids', {cidOne, cidTwo})
      }
      // preferred to consume the files directly from File Input but must be sorted analog controller/Webtorrent.js client.seed L: 282, sometimes the torrent.files made trouble to stream, which resulted in some Readable Stream error
      const files = event.detail.input ? Array.from(event.detail.input).sort((a, b) => a.name.localeCompare(b.name)) : event.detail.torrent.files
      // wait for torrent to be ready, that we can read offset and length
      if (event.detail.torrent.ready) return addAllFunc(files, event.detail.torrent)
      event.detail.torrent.on('ready', () => addAllFunc(files, event.detail.torrent))
    }

    this.ipfsGetTorrentFileEventListener = async event => this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}torrent-file`, {cid: event.detail.cid, torrentFile: await this.getTorrentFile(event.detail.cid)})

    this.onlineEventListener = event => {
      this.gateways.forEach(gateway => {
        gateway.hasError = false
        gateway.hasAddError = false
      })
      this.saveGateways()
    }
  }

  connectedCallback () {
    document.body.addEventListener(`${this.namespace}add-web-seed`, this.torrentAddWebSeed)
    document.body.addEventListener(`${this.namespace}cat`, this.ipfsCatEventListener)
    document.body.addEventListener(`${this.namespace}seed`, this.ipfsSeedEventListener)
    document.body.addEventListener(`${this.namespace}get-torrent-file`, this.ipfsGetTorrentFileEventListener)
    self.addEventListener('online', this.onlineEventListener)
  }

  disconnectedCallback () {
    document.body.removeEventListener(`${this.namespace}add-web-seed`, this.torrentAddWebSeed)
    document.body.removeEventListener(`${this.namespace}cat`, this.ipfsCatEventListener)
    document.body.removeEventListener(`${this.namespace}seed`, this.ipfsSeedEventListener)
    document.body.removeEventListener(`${this.namespace}get-torrent-file`, this.ipfsGetTorrentFileEventListener)
    self.removeEventListener('online', this.onlineEventListener)
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

  /**
   * Bundles all the files cid's, torrent.files metadata and torrentFile itself into one JSON called filesCidMetadata and returns it's cid
   * 
   * @param {FileList} inputFiles
   * @param {any} torrent
   * @returns {Promise<string>} // returns the filesCidMetadata cid
   */
  async addAll (inputFiles, torrent) {
    const filesCidMetadata = []
    // upload files and collect metadata
    await Promise.all(Ipfs.createFileListArray(inputFiles, torrent).map(async (file, i) => {
      filesCidMetadata.push(Ipfs.createFileMetadata(inputFiles, torrent, await this.add(file).result, i))
    }))
    return (await this.add(Ipfs.createFileListJsonFile(filesCidMetadata)).result).cid.toString() 
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
      content: Ipfs.createFileListJsonFile(await this.createFileListCidMetadata(inputFiles, torrent)).stream()
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
  async createFileListCidMetadata (inputFiles, torrent) {
    // @ts-ignore
    const blockstore = new BlockstoreCore.MemoryBlockstore()
    const filesCidMetadata = []
    await Promise.all(Ipfs.createFileListArray(inputFiles, torrent).map(async (file, i) => {
      // @ts-ignore
      for await (const result of IpfsUnixfsImporter.importer([
        file instanceof File
          ? {
            path: file.name,
            content: file
          }
          : file
      ], blockstore, {
        cidVersion: this.cidVersion,
        rawLeaves: this.rawLeaves,
        wrapWithDirectory: false
      })) {
        // importer emits directory entries too sometimes
        if (!result.path) continue
        filesCidMetadata.push(Ipfs.createFileMetadata(inputFiles, torrent, result, i))
      }
    }))
    return filesCidMetadata
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
        get content () {
          return file.stream()
        }
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
        offset: torrent.files[counter]?.offset,
        length: torrent.files[counter]?.length
      }
      : {
        cid: result.cid.toString(),
        name: 'torrent',
        type: 'application/x-bittorrent'
      }
  }

  static createFileListJsonFile (data) {
    return new File(
      [JSON.stringify(data.sort((a, b) => a.cid.localeCompare(b.cid)))],
      'fileList.json',
      { type: 'application/json' }
    )
  }

  /**
   * first get fileList.json then find torrent cid, download the torrent file and return
   * 
   * @param {string} cid
   * @returns {Promise<File | null>}
   */
  async getTorrentFile (cid) {
    const fileListText = await this.catCidToText(cid, true)
    if (!fileListText) return null
    let json
    try {
      json = JSON.parse(fileListText)
    } catch (error) {
      return null
    }
    const torrentFileEntry = json.find(entry => entry.type === 'application/x-bittorrent')
    return torrentFileEntry?.cid ? this.catCidToFile(torrentFileEntry.cid, torrentFileEntry.name, torrentFileEntry.type) : null
  }

  /**
   * client.cat file from ipfs to text
   * 
   * @param {string} cid
   * @param {boolean} [isJson=false]
   * @returns {Promise<string|null>}
   */
  catCidToText (cid, isJson = false) {
    const decodeText = chunks => {
      const decoder = new TextDecoder()
      return chunks.reduce((text, chunk) => (text += decoder.decode(chunk, { stream: true })), '') + decoder.decode()
    }
    return new Promise(resolve => {
      let counter = 0
      let didResolve = false
      const doResolve = response => {
        counter++
        if (!didResolve) {
          didResolve = true
          if (response) {
            resolve(response)
          } else if (counter >= 2) { // two which race, when none resulted in any useful response, resolve with null
            resolve(response)
          }
        }
      }
      let {result: catChunksPromise, getAbortController: catGetAbortController} = this.cat(cid)
      let {result: fetchResponsePromise, getAbortController: fetchGetAbortController} = this.fetch(cid)
      catChunksPromise.then(({chunks, gateway, isAbortError}) => {
        const doResolveNull = () => {
          if (!isAbortError && gateway) {
            this.setGatewayError(gateway, 'hasError', true)
          }
          return doResolve(null)
        }
        if (!chunks) return doResolveNull()
        const text = decodeText(chunks)
        if (isJson) {
          try {
            JSON.parse(text)
          } catch (error) {
            return doResolveNull()
          }
        }
        fetchGetAbortController().abort()
        doResolve(text)
      })
      fetchResponsePromise.then(async ({response, gateway, isAbortError}) => {
        const doResolveNull = () => {
          if (!isAbortError && gateway) {
            this.setGatewayError(gateway, 'hasError', true)
          }
          return doResolve(null)
        }
        if (!response) return doResolveNull()
        const text = await response.text()
        if (isJson) {
          try {
            JSON.parse(text)
          } catch (error) {
            return doResolveNull()
          }
        }
        catGetAbortController().abort()
        doResolve(text)
      })
    })
  }

  /**
   * client.cat file from ipfs to file
   * 
   * @param {string} cid
   * @param {string} name
   * @param {string} type
   * @returns {Promise<File | null>}
   */
  async catCidToFile (cid, name, type) {
    const getFile = (chunks, name, type) => new File(
      // @ts-ignore
      chunks,
      name,
      {
        type: type
      }
    )
    return new Promise(resolve => {
      let counter = 0
      let didResolve = false
      const doResolve = response => {
        counter++
        if (!didResolve) {
          if (response) {
            resolve(response)
            didResolve = true
          } else if (counter >= 2) { // two which race, when none resulted in any useful response, resolve with null
            resolve(response)
            didResolve = true
          }
        }
      }
      let {result: catChunksPromise, getAbortController: catGetAbortController} = this.cat(cid)
      let {result: fetchResponsePromise, getAbortController: fetchGetAbortController} = this.fetch(cid)
      catChunksPromise.then(({chunks, gateway, isAbortError}) => {
        const doResolveNull = () => {
          if (!isAbortError && gateway) {
            this.setGatewayError(gateway, 'hasError', true)
          }
          return doResolve(null)
        }
        if (!chunks) return doResolveNull()
        fetchGetAbortController().abort()
        doResolve(getFile(chunks, name, type))
      })
      fetchResponsePromise.then(async ({response, gateway, isAbortError}) => {
        const doResolveNull = () => {
          if (!isAbortError && gateway) {
            this.setGatewayError(gateway, 'hasError', true)
          }
          return doResolve(null)
        }
        if (!response) return doResolveNull()
        catGetAbortController().abort()
        doResolve(getFile([await response.blob()], name, type))
      })
    })
  }

  /**
   * cat resp. download through ipfs client
   * 
   * @param {string} cid
   * @returns {{result: Promise<{chunks: any[]|null, gateway:GATEWAY|null, isAbortError?:boolean}>, getAbortController: () => AbortController}}
   */
  cat (cid) {
    let abortController = new AbortController()
    const func = async () => {
      const gatewayResult = this.getGateway('cat')
      if (gatewayResult.gateway?.client) {
        const client = gatewayResult.gateway.client
        try {
          const chunks = []
          for await (const chunk of client.cat(cid, {signal: abortController.signal})) {
            chunks.push(chunk)
          }
          this.setGatewayError(gatewayResult.gateway, 'hasError', false)
          return {chunks, gateway: gatewayResult.gateway}
        } catch (error) {
          if (error.name === 'AbortError') {
            return {chunks: null, gateway: gatewayResult.gateway, isAbortError: true}
          } else {
            this.setGatewayError(gatewayResult.gateway, 'hasError', true)
            if (!gatewayResult.ignoreError) {
              const catResult = this.cat(cid)
              abortController = catResult.getAbortController()
              return catResult.result
            } else {
              return {chunks: null, gateway: gatewayResult.gateway}
            }
          }
        }
      } else {
        console.warn('No more viable gateways...', this.gateways)
        return {chunks: null, gateway: null}
      }
    }
    return {result: this.resolveWhenOnline(func), getAbortController: () => abortController}
  }

  /**
   * fetch resp. download through ipfs client
   * 
   * @param {string} cid
   * @returns {{result: Promise<{response: Response|null, gateway:GATEWAY|null, isAbortError?:boolean}>, getAbortController: () => AbortController}}
   */
  fetch (cid) {
    let abortController = new AbortController()
    const func = () => {
      const gatewayResult = this.getGateway('fetch')
      if (gatewayResult.gateway) {
        return fetch(`${gatewayResult.gateway.origin}/ipfs/${cid}`, {signal: abortController.signal}).then(response => {
          this.setGatewayError(gatewayResult.gateway, 'hasError', false)
          return {response, gateway: gatewayResult.gateway}
          // @ts-ignore
        }).catch(error => {
          if (error.name === 'AbortError') {
            return {response: null, gateway: gatewayResult.gateway, isAbortError: true}
          } else {
            this.setGatewayError(gatewayResult.gateway, 'hasError', true)
            if (!gatewayResult.ignoreError) {
              const fetchResult = this.fetch(cid)
              abortController = fetchResult.getAbortController()
              return fetchResult.result
            } else {
              return {response: null, gateway: gatewayResult.gateway}
            }
          }
        })
      } else {
        console.warn('No more viable gateways...', this.gateways)
        return Promise.resolve({response: null, gateway: null})
      }
    }
    return {result: this.resolveWhenOnline(func), getAbortController: () => abortController}
  }

  /**
   * Description
   * 
   * @method
   * @name add
   * @kind method
   * @memberof Ipfs
   * @param {{path: string, content: ReadableStream}|File} file
   * @returns {{result: Promise<{cid: string}>, getAbortController: () => AbortController}}
   */
  add (file) {
    // TODO: keep state of adding in progress and avoid double adding
    let abortController = new AbortController()
    const func = async () => {
      const createFileCid = async file => {
        // create the cid local when .add fails to at least get the file list json file
        // @ts-ignore
        const blockstore = new BlockstoreCore.MemoryBlockstore()
        // @ts-ignore
        for await (const result of IpfsUnixfsImporter.importer([
          file instanceof File
            ? {
              path: file.name,
              content: file
            }
            : file
          ], blockstore, {
          cidVersion: this.cidVersion,
          rawLeaves: this.rawLeaves,
          wrapWithDirectory: false
        })) {
          // importer emits directory entries too sometimes
          if (!result.path) continue
          return result
        }
      }
      const gatewayResult = this.getGateway('add')
      if (gatewayResult.gateway?.client) {
        const client = gatewayResult.gateway.client
        try {
          const result = await client.add(file, {
            pin: true,
            cidVersion: this.cidVersion,
            rawLeaves: this.rawLeaves,
            wrapWithDirectory: false,
            timeout: this.generalRequestTimeout
          })
          // TODO: when doing input add dialog... add progress function as property in the add options, to track how much is added
          // TODO: progress - function - undefined - Called with (bytes, path) as bytes are added
          // TODO: input add dialog listen to client.add error 413 Request Entity Too Large to propose alternative gateway
          this.setGatewayError(gatewayResult.gateway, 'hasAddError', false)
          return result
        } catch (error) {
          if (error.name === 'AbortError') {
            return createFileCid(file)
          } else {
            this.setGatewayError(gatewayResult.gateway, 'hasAddError', true)
            if (!gatewayResult.ignoreError) {
              const addResult = this.add(file)
              abortController = addResult.getAbortController()
              return addResult.result
            } else {
              console.warn('Failed to add...', error, file)
              return createFileCid(file)
            }
          }
        }
      } else {
        console.warn('No more viable gateways...', this.gateways)
        return createFileCid(file)
      }
    }
    return {result: this.resolveWhenOnline(func), getAbortController: () => abortController}
  }

  /**
   * Create a KuboRpcClient
   * 
   * @param {'add'|'cat'|'web-seed'|'fetch'} usage
   * @param {boolean} [ignoreError=false]
   * @returns {{gateway: GATEWAY | null, ignoreError: boolean}}
   */
  getGateway (usage, ignoreError = false) {
    const gatewaysFiltered = this.gateways.filter(gateway => (usage === 'add' ? !gateway.hasAddError : !gateway.hasError))
    const findGatewayFunc = gateway => {
      if (!gateway.supports.includes(usage)) return false
      // KuboRpcClient is only used for add and cat
      // @ts-ignore
      if (!gateway.client && ['add', 'cat'].includes(usage)) gateway.client = KuboRpcClient.create({
        url: `${gateway.origin}${this.clientRpcVersion}`,
        timeout: this.generalRequestTimeout
      })
      return true
    }
    let gateway = gatewaysFiltered.find(findGatewayFunc)
    if (!gateway && ignoreError) {
      gateway = this.gateways.find(findGatewayFunc)
      clearTimeout(this.resetGatewaysTimeoutId)
      this.resetGatewaysTimeoutId = setTimeout(() => {
        this.gateways.forEach(gateway => {
          gateway.hasError = false
          gateway.hasAddError = false
        })
        this.saveGateways()
      }, 1000) // cool down 1 sec. before resetting
    }
    return gateway
      ? {gateway, ignoreError}
      : ignoreError
        ? {gateway: null, ignoreError}
        : this.getGateway(usage, true)
  }

  saveGateways () {
    this.dispatchEvent(new CustomEvent('storage-set', {
      detail: {
        key: `${this.namespace}gateways`,
        value: this.gateways.map(gateway => {
          if (gateway.client) delete gateway.client
          return gateway
        })
      },
      bubbles: true,
      cancelable: true,
      composed: true
    }))
  }

  loadGateways () {
    return new Promise(resolve => this.dispatchEvent(new CustomEvent('storage-get', {
      detail: {
        key: `${this.namespace}gateways`,
        resolve
      },
      bubbles: true,
      cancelable: true,
      composed: true
    })))
  }

  // TODO: distinguish error like "413 Request Entity Too Large". to decide if gateways error flag shall be set or how to handle, this is going to be covered by the upload dialog.
  // TODO: Note: At the moment we just only set error true, for a gateway to be cleared it has to occur that no more other error false gateways exist, then getGateway clears all errors.
  setGatewayError (gateway, propName, flag) {
    if (gateway[propName] === flag) return
    if (flag) gateway[propName] = flag
    this.saveGateways()
  }

  /**
   * Executes a function as soon as only
   * TODO: NOTE: this triggered a freeze after returning to navigator.onLine when all fires from the queue and getGateway does reset too quick. trying now with: this.resetGatewaysTimeoutId
   * 
   * @param {()=>any} func
   * @returns {Promise<any>}
   */
  resolveWhenOnline (func) {
    let resolveFunc = resolve => resolve
    const promise = new Promise(resolve => (resolveFunc = resolve))
    if (navigator.onLine) resolveFunc(func())
    self.addEventListener('online', () => resolveFunc(func()), {once: true})
    return promise
  }
}
