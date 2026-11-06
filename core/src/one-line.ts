export function oneLine(text: string): string {
  return text
    .split(/\s*\n\s*/)
    .filter((part) => part !== "")
    .join(" ");
}
