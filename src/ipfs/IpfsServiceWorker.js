// @ts-check

/* global self */
/* global clients */

const IpfsServiceWorker = (ChosenExtend = class {}) => class IpfsServiceWorker extends ChosenExtend {
  /**
   * save the web seed request url stuff
   * 
   * @readonly
   * @static
   * @type {Map<string, {filesMetadata: any, fileName: string}>}
   */
  static #requestDataMap = new Map()

  // stitch a response together from multiple files and ranges
  static webSeedRespondWith (event, request) {
    if (!request.url.includes('/webtorrent-web-seed/')) return false
    const range = request.headers.get('range')
    if (!range) return event.respondWith(new Response('Range required', { status: 400 })) || true
    // @ts-ignore
    const [, rangeStart, rangeEnd] = /bytes=(\d+)-(\d+)/.exec(range).map(num => Number(num))
    // @ts-ignore
    let {directoryRoot, filesMetadata, fileName} = IpfsServiceWorker.getRequestData(request)
    if (directoryRoot === undefined || filesMetadata === undefined || fileName === undefined) return event.respondWith(new Response('Files metadata required', { status: 400 })) || true
    // TODO: properly debug
    console.log('*********', IpfsServiceWorker.#requestDataMap, directoryRoot)
    // @ts-ignore
    const {parts: partsRange, rangeTotal} = IpfsServiceWorker.resolveRange(filesMetadata, fileName, rangeStart, rangeEnd)
    if (partsRange === undefined || !partsRange.length || rangeTotal === undefined) return event.respondWith(new Response(`FileName: ${fileName} not found in files metadata`, { status: 400 })) || true
    return event.respondWith(new Response(IpfsServiceWorker.createMultipartStream(directoryRoot, partsRange), {
      status: 206,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${rangeStart}-${rangeEnd}/${rangeTotal}`,
        'Content-Length': String(rangeEnd - rangeStart + 1) // 0-0 starts with 1 thats why it must be added here
      }
    })) || true
  }

  static getRequestData (request) {
    const [directoryRoot, filesMetadataUrl] = request.url.split('/files-metadata/')
    // @ts-ignore
    if (IpfsServiceWorker.#requestDataMap.has(filesMetadataUrl)) return Object.assign(IpfsServiceWorker.#requestDataMap.get(filesMetadataUrl), {directoryRoot})
    let [filesMetadata, pathname] = filesMetadataUrl.split('/webtorrent-web-seed/')
    const fileName = decodeURIComponent(pathname.replace(/^.*\/(.*)$/, '$1'))
    try {
      // we do this on every request, since the request.url can change
      filesMetadata = JSON.parse(decodeURIComponent(filesMetadata))
    } catch (error) {
      return null
    }
    // @ts-ignore
    return Object.assign(IpfsServiceWorker.#requestDataMap.set(filesMetadataUrl, {filesMetadata, fileName}).get(filesMetadataUrl), {directoryRoot})
  }

  // calculates the range per file, since start and end span multiple files
  static resolveRange(files, fileName, start, end) {
    const file = files.length === 1
      ? files[0]
      : files.find(file => file.name === fileName)
    if (!file) return false
    return {parts: [{
      name: file.cid,
      start,
      end
    }], rangeTotal: file.length - 1 /* -1 because it starts at 0 */}
  }
  /*
  // the below chooses by range and not by fileName, not sure if this works with some bep definitions, but can be deleted if not needed
  static resolveRange(files, fileName, start, end) {
    const fileEnds = []
    const parts = files.reduce((acc, file) => {
      const fileStart = file.offset
      const fileEnd = file.offset + file.length - 1 // -1 because it starts at 0
      fileEnds.push(fileEnd)
      // no overlap
      if (end < fileStart || start > fileEnd) return acc
      // overlap
      const overlapStart = Math.max(start, fileStart)
      const overlapEnd = Math.min(end, fileEnd)
      acc.push({
        name: file.cid,
        start: overlapStart - fileStart,
        end: overlapEnd - fileStart
      })
      return acc
    }, [])
    return {parts, rangeTotal: Math.max(...fileEnds)}
  }
  */

  // this function makes a whole stream, which can spawn multiple files (parts) and stitches it into one
  static createMultipartStream(directoryRoot, parts) {
    return new ReadableStream({
      async start(controller) {
        try {
          for (const part of parts) {
            const response = await fetch(`${directoryRoot}/${part.name}`, {
              headers: {
                Range: `bytes=${part.start}-${part.end}`
              }
            })
            if (!response.ok && response.status !== 206) throw new Error(`Bad response: ${response.status}`)
            // @ts-ignore
            const reader = response.body.getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              controller.enqueue(value)
            }
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      }
    })
  }
}
// Start the worker
//const IpfsServiceWorker = new (IpfsServiceWorker())() // eslint-disable-line
