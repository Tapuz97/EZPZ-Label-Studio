import { useRef, useState } from "react";
import { Smile } from "lucide-react";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "./components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "./components/ui/tooltip";

const choices = {
  Emoji: ["😀", "😊", "😂", "😍", "😎", "🤔", "😭", "😴", "👍", "👎", "👏", "🙏", "💪", "👋", "❤️", "⭐", "🔥", "💡", "✅", "❌", "⚠️", "🔧", "⚙️", "🔩", "📦", "🏷️", "📮", "🚚", "🎁", "♻️", "🌱", "☕", "🍎", "🥛", "🥜", "🐶", "🐱", "🏠", "📱", "💻", "🔋", "🔌", "🎉", "🎂", "🌈", "☀️", "🚀", "🧪"],
  Symbols: ["✓", "✗", "★", "☆", "♥", "♡", "●", "○", "■", "□", "→", "←", "↑", "↓", "±", "×", "÷", "°", "©", "®", "™", "€", "£", "₪"],
  Emoticons: [":-)", ":)", ";-)", ":D", ":-P", ":-(", "<3", "^_^", "(o_o)", "¯\\_(ツ)_/¯", "(╯°□°)╯", "(•‿•)"],
};
export function EmojiPicker({ onInsert, onAfterInsert }: { onInsert: (text: string) => void; onAfterInsert: () => void }) {
  const [open, setOpen] = useState(false);
  const inserted = useRef(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <TooltipProvider><Tooltip><TooltipTrigger asChild><DialogTrigger asChild>
      <Button variant="ghost" size="icon-sm" aria-label="Insert emoji or symbol"><Smile /></Button>
    </DialogTrigger></TooltipTrigger><TooltipContent>Insert emoji, symbol or emoticon</TooltipContent></Tooltip></TooltipProvider>
    <DialogContent className="sm:max-w-lg" onCloseAutoFocus={event => {
      if (inserted.current) {
        event.preventDefault();
        inserted.current = false;
        onAfterInsert();
      }
    }}>
      <DialogHeader>
        <DialogTitle>Emoji & symbols</DialogTitle>
        <DialogDescription>Prints in black and white. You can also paste Unicode emoji or type ASCII emoticons directly into your text.</DialogDescription>
      </DialogHeader>
      <Tabs defaultValue="Emoji">
        <TabsList className="w-full">{Object.keys(choices).map(name => <TabsTrigger key={name} value={name}>{name}</TabsTrigger>)}</TabsList>
        {Object.entries(choices).map(([name, items]) => <TabsContent key={name} value={name}>
          <div className={`grid gap-1 ${name === "Emoticons" ? "grid-cols-3" : "grid-cols-8"}`}>
            {items.map(text => <Button key={text} variant="ghost" aria-label={`Insert ${text}`} onClick={() => { inserted.current = true; onInsert(text); setOpen(false); }}>{text}</Button>)}
          </div>
        </TabsContent>)}
      </Tabs>
    </DialogContent>
  </Dialog>;
}
