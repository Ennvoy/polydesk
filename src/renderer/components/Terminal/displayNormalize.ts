// 終端機顯示層正規化：在 PTY 原始 bytes 流無狀態移除 keycap 的「combining enclosing keycap」（REQ-TERM-009）。
// 純位元組模組（無 xterm/DOM 相依），故可於 node 環境單測（displayNormalize.test.ts）。
//
// 為什麼需要：項目編號 1、2、3 的 keycap emoji（1️⃣2️⃣…）由三個 code point 疊出——
//   基底（數字/#/*）＋ U+FE0F（emoji variation selector）＋ U+20E3（combining enclosing keycap）。
// xterm 會把三者 join 成同一格（寬度正確），但本 app 的等寬字型鏈（Consolas…，無 emoji 字型）
// 不會把它合成成彩色 keycap；偏偏 Consolas 自帶 U+20E3 的「圍框」glyph，於是渲染成「數字＋一個
// 空框」、框還溢出疊到相鄰 cell。等寬終端機無法 per-cell 換 emoji 字型合成，故唯一根治＝顯示層
// 把 U+20E3（含其前導 U+FE0F）移除、退化成純數字。
//
// 為什麼在「bytes 層＋無狀態」做（而非解碼成 string）：
//  - chunk 是 PTY 原始 bytes，xterm 用自己的 stateful UTF-8 decoder 跨 chunk 正確接續。若我們在中間
//    插一層自己的 stream 解碼緩衝去湊 string，會扣住 chunk 尾端不完整的多 byte 序列、與 xterm 的 write
//    佇列時序脫節，破壞 PTY 輸出即時性/完整性（實測會卡死 PSReadLine 的貼上/OSC52 鏈路）。故一律
//    維持 xterm 原生 Uint8Array 解碼路徑不變，只在餵進去前的 bytes 上做「無狀態」剔除。
//  - U+20E3 的 UTF-8 是固定三 bytes E2 83 A3；只剔除「完整出現」的序列，被 chunk 切斷的殘缺尾端原樣
//    留存（不扣尾、不跨 chunk 記狀態）＝絕不阻塞輸出。keycap 幾乎總落在單一 chunk 內（ConPTY 按序列
//    輸出），跨 chunk 被切者極罕見、頂多該次漏一個框，不影響功能。
//  - fast path：E2 是 U+20E3 的必要首 byte，純 ASCII 輸出（最常見）以 includes 直接短路、零拷貝。

const KC0 = 0xe2, KC1 = 0x83, KC2 = 0xa3; // U+20E3 combining enclosing keycap（畫圍框的兇手）
const VS0 = 0xef, VS1 = 0xb8, VS2 = 0x8f; // U+FE0F emoji variation selector（keycap 的前導修飾）

/** 無狀態移除 PTY bytes 中完整的 U+20E3 圍框序列（及其緊鄰前導 U+FE0F）；無 keycap 時回傳原陣列（零拷貝）。 */
export function stripEnclosingKeycap(chunk: Uint8Array): Uint8Array {
  if (!chunk.includes(KC0)) return chunk; // 快篩：缺 E2 必無 U+20E3
  // 確認真有完整 E2 83 A3（含 E2 但非 keycap，如 ❤ U+2764=E2 9D A4，走到這裡不重建、原樣返回）。
  let hit = false;
  for (let i = 0; i + 2 < chunk.length; i++) {
    if (chunk[i] === KC0 && chunk[i + 1] === KC1 && chunk[i + 2] === KC2) { hit = true; break; }
  }
  if (!hit) return chunk;
  // 重建：剔除每個完整 E2 83 A3 及其緊鄰前導 EF B8 8F；殘缺尾端（如僅 E2 或 E2 83）照原樣 push（不扣尾）。
  const out: number[] = [];
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === KC0 && chunk[i + 1] === KC1 && chunk[i + 2] === KC2) {
      const n = out.length;
      if (n >= 3 && out[n - 3] === VS0 && out[n - 2] === VS1 && out[n - 1] === VS2) out.length = n - 3;
      i += 2; // 跳過 83、A3（for 迴圈 ++ 再跳過 E2）
      continue;
    }
    out.push(chunk[i]);
  }
  return Uint8Array.from(out);
}
