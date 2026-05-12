// @ts-check
import '../ipfs/index.min.js'

/* global Environment */
/* global KuboRpcClient */

/*
const stream = new ReadableStream({
  async start(controller) {
    for await (const chunk of ipfs.cat(cid)) {
      controller.enqueue(chunk)
    }

    controller.close()
  }
})

const response = new Response(stream)
const blob = await response.blob()

video.src = URL.createObjectURL(blob)

---

// @ts-ignore
this.clientPromise.then(async client => {
  console.log(client.add('Hello Files! Yooooooh'))
  const decoder = new TextDecoder()
  let data = ''
  for await (const chunk of client.cat("QmRohXmcFYoxA45AdWyDjDMcDA3u1reqATHDjVpU6W6s3r")) {
    data += decoder.decode(chunk, { stream: true })
  }
  console.log(data)
})

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

    /** @type {string} */
    this.importMetaUrl = import.meta.url.replace(/(.*\/)(.*)$/, '$1')
    // set attribute namespace
    this.namespace = this.getAttribute('namespace') || 'ipfs-'
    const stallTimeout = 6000 // has to be less than the timeout at view
    // init is going to fill this Promise
    this.setClientPromise()

    // client.cat
    this.ipfsAddEventListener = async event => {
      const client = await this.clientPromise
      const decoder = new TextDecoder()
      let text = ''
      // TODO: cache here, not to cat twice
      for await (const chunk of client.cat(event.detail.cid)) {
        text += decoder.decode(chunk, { stream: true })
      }
      text += decoder.decode()
      const fileList = JSON.parse(text)
      Promise.all(fileList.map(async metadata => {
        const chunks = []
        for await (const chunk of client.cat(metadata.cid)) {
          chunks.push(chunk)
        }
        return new File(
          chunks,
          metadata.name,
          {
            type: metadata.type,
            lastModified: metadata.lastModified
          }
        )
      })).then(files => {
        console.log('*********', 'added from ipfs')
        this.dispatchEvent(new CustomEvent('webtorrent-seed', {
          detail: {
            uid: event.detail.uid,
            room: event.detail.room,
            input: files,
          },
          bubbles: true,
          cancelable: true,
          composed: true
        }))
      })
    }

    // client.addAll
    this.ipfsSeedEventListener = async event => {
      const client = await this.clientPromise
      const fileListMetaData = []
      // upload files and collect metadata
      let counter = 0
      for await (const result of client.addAll(event.detail.input, {pin: true})) {
        fileListMetaData.push({
          cid: result.cid.toString(),
          lastModified: event.detail.input[counter].lastModified,
          name: event.detail.input[counter].name,
          size: event.detail.input[counter].size,
          type: event.detail.input[counter].type
        })
        counter++
      }
      // list all files of the wrapWithDirectory
      const fileListJson = new File(
        [JSON.stringify(fileListMetaData)],
        'fileList.json',
        { type: 'application/json' }
      )
      const rootCid = (await client.add(fileListJson, {pin: true})).cid.toString()
      this.respond(event.detail?.resolve, event.detail?.dispatch, event.detail?.name || `${this.namespace}seeded`, {cid: rootCid})
    }
  }

  async init () {
    if (this.clientDestroyedPromise) await this.clientDestroyedPromise
    // @ts-ignore
    if (this.clientPromise.done) return
    // @ts-ignore
    const client = KuboRpcClient.create({url: 'https://ipfs.oversas.org/api/v0'})
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
