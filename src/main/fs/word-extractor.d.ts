// word-extractor 無官方型別：最小宣告（只涵蓋本專案用到的 API）。
declare module 'word-extractor' {
  class WordDocument {
    getBody(): string;
    getHeaders(): string;
    getFooters(): string;
    getFootnotes(): string;
    getEndnotes(): string;
  }
  export default class WordExtractor {
    extract(source: string | Buffer): Promise<WordDocument>;
  }
}
