// @ts-check

/**
 * Webtorrent
 *
 * @export
 * @param {CustomElementConstructor} [ChosenHTMLElement = HTMLElement]
 * @return {CustomElementConstructor | *}
 */
export default class Webtorrent extends HTMLElement {
  constructor() {
    super()
    console.log('view hooked');
  }
}
