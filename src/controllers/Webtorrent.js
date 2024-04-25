// @ts-check
import WebTorrent from '../webtorrent/dist/webtorrent.min.js'

/**
 * https://webtorrent.io/docs
 *
 * @export
 * @param {CustomElementConstructor} [ChosenHTMLElement = HTMLElement]
 * @return {CustomElementConstructor | *}
 */
export default class Webtorrent extends HTMLElement {
  constructor() {
    super()
    console.log('controller hooked', {webtorrentClient: new WebTorrent()});
  }
}
