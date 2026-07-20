/**
 * Unwrap inline markdown emphasis to plain text for terminal-style displays
 * (the thinking star / trace rows show reasoning like `**Planning the query**`).
 * Only unwraps paired emphasis + inline code; leaves other text untouched.
 */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold**
    .replace(/__(.+?)__/g, '$1') // __bold__
    .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '$1') // *italic*
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, '$1') // _italic_
    .replace(/`(.+?)`/g, '$1') // `code`
}
