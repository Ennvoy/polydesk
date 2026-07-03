// keycap 顯示正規化單測（node 環境、純位元組）。守 REQ-TERM-009：
// ① 各式 keycap（數字/#/*，含或不含 FE0F）在 bytes 層退化成純基底字元＝消去圍框；
// ② 不誤傷其他 emoji（尤其含 E2 首 byte 的 ❤ U+2764，快篩會命中但非 keycap）；
// ③ 無狀態：被 chunk 切斷的殘缺 keycap 尾端原樣保留、不扣尾（＝不阻塞 PTY 輸出）。
// 隱形字元一律以 String.fromCodePoint 建構，免測試檔藏 combining 字元。

import { describe, it, expect } from 'vitest';
import { stripEnclosingKeycap } from './displayNormalize';

const enc = new TextEncoder();
const dec = new TextDecoder();
const FE0F = String.fromCodePoint(0xfe0f); // emoji variation selector
const ENCLOSE = String.fromCodePoint(0x20e3); // combining enclosing keycap
const KC = FE0F + ENCLOSE; // 標準 keycap 尾（FE0F + 20E3）
const HEART = String.fromCodePoint(0x2764) + FE0F; // ❤️（UTF-8 首 byte 也是 E2，但非 keycap）
const CHECK = String.fromCodePoint(0x2714) + FE0F; // ✔️
/** 便捷：字串 → encode 成 PTY bytes → strip → decode 回字串，比對可讀。 */
const strip = (s: string): string => dec.decode(stripEnclosingKeycap(enc.encode(s)));

describe('stripEnclosingKeycap（終端機 keycap 顯示正規化，bytes 層無狀態）', () => {
  it('標準 keycap（數字+FE0F+20E3）→ 純數字，消去圍框', () => {
    expect(strip('1' + KC)).toBe('1');
  });

  it('無 FE0F 的 keycap（數字 + U+20E3）也退化成純數字', () => {
    expect(strip('2' + ENCLOSE)).toBe('2');
  });

  it('一行多個編號都處理、其他字元不動', () => {
    expect(strip(`1${KC} 認可 2${KC} 調整 3${KC} 重設`)).toBe('1 認可 2 調整 3 重設');
  });

  it('# / * / 0 的 keycap 也支援', () => {
    expect(strip('#' + KC)).toBe('#');
    expect(strip('*' + KC)).toBe('*');
    expect(strip('0' + KC)).toBe('0');
  });

  it('不誤傷其他 emoji（❤️/✔️ 含 FE0F、❤ 首 byte 也是 E2 但非 keycap，皆原樣）', () => {
    expect(strip(HEART)).toBe(HEART);
    expect(strip(CHECK)).toBe(CHECK);
  });

  it('純 ASCII / ANSI escape 原樣返回，且零拷貝（回傳同一參考）', () => {
    const bytes = enc.encode('\x1b[31m一般輸出 hello 123\x1b[0m'.replace(/[^\x00-\x7f]/g, '')); // 保純 ASCII
    expect(stripEnclosingKeycap(bytes)).toBe(bytes); // fast path：缺 E2 → 同參考
  });

  it('前導 FE0F 於 keycap 完整時一併移除（bytes 全清）', () => {
    expect(stripEnclosingKeycap(enc.encode('1' + KC))).toEqual(enc.encode('1'));
  });

  it('無狀態：被 chunk 切斷的殘缺 keycap 尾端（僅 E2 或 E2 83）原樣保留、不扣尾', () => {
    const partial1 = Uint8Array.from([0x31, 0xe2]); // '1' + U+20E3 首 byte
    expect(stripEnclosingKeycap(partial1)).toEqual(partial1);
    const partial2 = Uint8Array.from([0x31, 0xe2, 0x83]); // '1' + U+20E3 前 2 bytes
    expect(stripEnclosingKeycap(partial2)).toEqual(partial2);
  });

  it('空 Uint8Array 安全', () => {
    expect(stripEnclosingKeycap(new Uint8Array(0))).toEqual(new Uint8Array(0));
  });
});
