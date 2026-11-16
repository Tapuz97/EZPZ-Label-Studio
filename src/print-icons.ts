export type PrintIcon = { id: string; aliases?: string[]; node: [string, Record<string, string | number>][] };
export type IconCatalog = { provider: string; version: string; icons: PrintIcon[] };
export const iconName = (id: string) => id.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join(" ");
export function iconSvg(icon: PrintIcon) {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const nodes = icon.node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([key, value]) => `${key}="${escape(String(value))}"`).join(" ")} />`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${nodes}</svg>`;
}
export function findIcons(icons: PrintIcon[], query: string) {
  const words = query.toLowerCase().trim().split(/[\s_-]+/).filter(Boolean);
  const synonyms: Record<string, string[]> = { love: ["heart"], happy: ["smile", "laugh"], sad: ["frown", "angry"], shipping: ["package", "truck", "box"], warning: ["alert"], food: ["apple", "carrot", "utensils", "pizza", "sandwich"], recycling: ["recycle"], emoji: ["smile", "laugh", "frown", "angry", "heart", "thumbs"] };
  return icons.filter(icon => {
    const names = [icon.id, ...(icon.aliases ?? [])];
    return words.every(word => names.some(name => name.includes(word)) || synonyms[word]?.some(term => names.some(name => name.includes(term))));
  });
}
