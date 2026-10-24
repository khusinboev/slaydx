/** AI chat button callbacks (`chy:<token>:<hash>` confirm, `chn:<token>` cancel). Pure; the handler is `./chat`. */
export function isChatCallback(data: string | undefined): boolean {
  return typeof data === "string" && /^ch[yn]:/.test(data);
}
