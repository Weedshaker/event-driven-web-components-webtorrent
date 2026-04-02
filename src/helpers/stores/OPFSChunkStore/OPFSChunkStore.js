'use strict'

export default class Storage {
  constructor (chunkLength, opts) {
    if (!opts) opts = {}

    this.chunkLength = Number(chunkLength)
    if (!this.chunkLength) throw new Error('First argument must be a chunk length')

    this.closed = false
    this.destroyed = false
    this.length = Number(opts.length) || Infinity
    this.name = opts.name || 'opfs-chunk-store'

    if (this.length !== Infinity) {
      this.lastChunkLength = (this.length % this.chunkLength) || this.chunkLength
      this.lastChunkIndex = Math.ceil(this.length / this.chunkLength) - 1
    }

    this.rootPromise = navigator.storage.getDirectory()
    this.dirPromise = this._initDir()
  }

  async _initDir () {
    const root = await this.rootPromise
    return root.getDirectoryHandle(this.name, { create: true })
  }

  async _getFileHandle (index, create) {
    const dir = await this.dirPromise
    return dir.getFileHandle(index, { create })
  }

  put (index, buf, cb = () => {}) {
    if (this.closed) return cb(new Error('Storage is closed'))
    if (typeof index !== 'number') return cb(new Error('index must be a number'))

    const isLastChunk = (index === this.lastChunkIndex)
    if (isLastChunk && buf.length !== this.lastChunkLength) return cb(new Error('Last chunk length must be ' + this.lastChunkLength))
    if (!isLastChunk && buf.length !== this.chunkLength) return cb(new Error('Chunk length must be ' + this.chunkLength))

    let arr = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    if (arr.byteOffset !== 0 || arr.byteLength !== arr.buffer.byteLength) arr = arr.slice()

    ;(async () => {
      try {
        const handle = await this._getFileHandle(index, true)
        const writable = await handle.createWritable()
        await writable.write(arr)
        await writable.close()
      } catch (err) {
        cb(err)
        return
      }

      cb(null)
    })()
  }

  get (index, opts, cb = () => {}) {
    if (typeof opts === 'function') return this.get(index, {}, opts)
    if (!opts) opts = {}

    if (this.closed) return cb(new Error('Storage is closed'))

    ;(async () => {
      let file
      try {
        const handle = await this._getFileHandle(index, false)
        file = await handle.getFile()
      } catch (err) {
        const e = new Error('Chunk not found')
        e.notFound = true
        cb(e)
        return
      }

      let buf = new Uint8Array(await file.arrayBuffer())

      const offset = opts.offset || 0
      const len = opts.length || (buf.length - offset)

      if (offset !== 0 || len !== buf.length) {
        buf = buf.slice(offset, offset + len)
      }

      cb(null, buf)
    })()
  }

  close (cb = () => {}) {
    if (this.closed) cb(new Error('Storage is closed'))

    this.closed = true

    cb(null)
  }

  destroy (cb = () => {}) {
    if (this.closed) return cb(new Error('Storage is closed'))
    if (this.destroyed) return cb(new Error('Storage is destroyed'))

    this.destroyed = true

    this.close(async (err) => {
      if (err) return cb(err)

      try {
        const root = await this.rootPromise
        await root.removeEntry(this.name, { recursive: true })
      } catch (error) {
        cb(err)
        return
      }

      cb(null)
    })
  }
}
