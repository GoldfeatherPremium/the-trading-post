import { createFileRoute } from "@tanstack/react-router";
import gameElden from "@/assets/game-elden.jpg";
import gameVoid from "@/assets/game-void.jpg";
import gameLeague from "@/assets/game-league.jpg";
import gameSurvive from "@/assets/game-survive.jpg";
import gameRoyale from "@/assets/game-royale.jpg";
import gameRacing from "@/assets/game-racing.jpg";
import itemGold from "@/assets/item-gold.jpg";
import itemSword from "@/assets/item-sword.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "X-VAULT — Buy & Sell Game Currency, Items, Accounts" },
      { name: "description", content: "The trusted marketplace for gamers. Buy currency, items, accounts, top-ups and boosting with secure escrow and instant delivery." },
      { property: "og:title", content: "X-VAULT — Gaming Marketplace" },
      { property: "og:description", content: "Buy & sell game currency, accounts, items, top-ups and boosting. Secure trade. Fast delivery." },
    ],
  }),
  component: Index,
});

const games = [
  { name: "ELDEN REACH", img: gameElden, prompt: "fantasy game cover art" },
  { name: "VOID STRIKE", img: gameVoid, prompt: "sci-fi shooter cover" },
  { name: "MAGE LEGENDS", img: gameLeague, prompt: "moba character art" },
  { name: "LOST EMPIRE", img: gameSurvive, prompt: "survival sandbox" },
  { name: "BATTLE ROYALE", img: gameRoyale, prompt: "battle royale cover" },
  { name: "NIGHT DRIFT", img: gameRacing, prompt: "racing game cover" },
];

const categories = ["CURRENCY", "ACCOUNTS", "ITEMS", "BOOSTING", "TOP-UP", "CD KEYS"];

const offers = [
  { title: "1M Gold — Instant Delivery", game: "World of Valor", price: "$14.50", badge: "Lv.99 Seller", rating: "4.9 ★ (2k+)", img: itemGold },
  { title: "God-Slayer Blade +12", game: "Elden Reach", price: "$299.00", badge: "Verified", rating: "5.0 ★ (45)", img: itemSword },
  { title: "5,000 Void Credits", game: "Void Strike", price: "$22.99", badge: "Power Seller", rating: "4.8 ★ (980)", img: itemGold },
  { title: "Mythic Account · Lvl 240", game: "Mage Legends", price: "$185.00", badge: "Secure Trade", rating: "5.0 ★ (132)", img: itemSword },
];

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-8 bg-primary rounded flex items-center justify-center font-display text-xl text-primary-foreground">X</div>
          <span className="font-display text-2xl tracking-tight">X-VAULT</span>
        </div>
        <div className="flex items-center gap-3">
          <button aria-label="Cart" className="size-9 rounded-full bg-secondary grid place-items-center">
            <svg className="size-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 9m12-9l2 9m-9-4a2 2 0 11-4 0 2 2 0 014 0zm8 0a2 2 0 11-4 0 2 2 0 014 0z"/>
            </svg>
          </button>
          <button className="text-xs font-bold px-3 py-1.5 bg-primary text-primary-foreground rounded-md">SIGN IN</button>
        </div>
      </nav>

      {/* Hero */}
      <header className="px-4 py-6 space-y-4">
        <h1 className="font-display text-5xl leading-none text-balance animate-enter">
          Level Up Your <span className="text-primary">Armory</span>
        </h1>
        <p className="text-sm text-muted-foreground animate-enter" style={{ animationDelay: "60ms" }}>
          The gamer-trusted marketplace. Currency, items, accounts & boosting — escrow-protected.
        </p>
        <div className="relative animate-enter" style={{ animationDelay: "120ms" }}>
          <input
            type="text"
            placeholder="Search games, items, or services..."
            className="w-full bg-secondary/60 border border-border rounded-lg py-3.5 pl-4 pr-16 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground transition-all"
          />
          <button className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground text-[10px] font-bold tracking-widest px-3 py-2 rounded-md">GO</button>
        </div>
      </header>

      {/* Categories */}
      <div className="px-4 flex gap-2 overflow-x-auto no-scrollbar pb-2 animate-enter" style={{ animationDelay: "160ms" }}>
        {categories.map((c, i) => (
          <button
            key={c}
            className={`whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-bold tracking-wide ${
              i === 0 ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-border"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Popular Games */}
      <section className="px-4 py-8">
        <div className="flex justify-between items-end mb-4">
          <h2 className="font-display text-2xl tracking-wide">POPULAR GAMES</h2>
          <span className="text-[10px] text-primary font-bold tracking-widest">VIEW ALL</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {games.map((g, i) => (
            <div key={g.name} className="space-y-1.5 animate-enter" style={{ animationDelay: `${200 + i * 30}ms` }}>
              <div className="aspect-[3/4] bg-secondary rounded-md overflow-hidden ring-1 ring-border">
                <img
                  src={g.img}
                  alt={g.name}
                  loading="lazy"
                  width={512}
                  height={640}
                  className="w-full h-full object-cover opacity-90 hover:opacity-100 transition-opacity"
                />
              </div>
              <p className="text-[10px] font-bold truncate tracking-wider">{g.name}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trending Offers */}
      <section className="px-4 py-6 space-y-3 bg-secondary/30 border-y border-border">
        <div className="flex justify-between items-end pt-2">
          <h2 className="font-display text-2xl tracking-wide">TRENDING OFFERS</h2>
          <span className="text-[10px] text-primary font-bold tracking-widest">SEE MORE</span>
        </div>

        {offers.map((o) => (
          <article key={o.title} className="bg-background border border-border p-3 rounded-lg flex gap-3">
            <div className="size-16 shrink-0 bg-secondary rounded overflow-hidden">
              <img src={o.img} alt={o.title} loading="lazy" width={200} height={200} className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start gap-2">
                  <h3 className="text-xs font-bold leading-tight truncate">{o.title}</h3>
                  <span className="text-accent font-mono text-xs whitespace-nowrap">{o.price}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{o.game}</p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[9px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-bold">{o.badge}</span>
                <span className="text-[9px] text-muted-foreground">{o.rating}</span>
              </div>
            </div>
          </article>
        ))}
      </section>

      {/* Trust signals */}
      <section className="grid grid-cols-3 gap-2 px-4 py-10 text-center">
        {[
          { icon: "🛡️", t: "Secure\nEscrow" },
          { icon: "⚡", t: "Instant\nDelivery" },
          { icon: "🎧", t: "24/7\nSupport" },
        ].map((x) => (
          <div key={x.t} className="space-y-2">
            <div className="text-2xl">{x.icon}</div>
            <p className="text-[10px] font-bold leading-tight uppercase whitespace-pre-line">{x.t}</p>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer className="bg-secondary/20 border-t border-border px-4 py-10 pb-12">
        <div className="space-y-8">
          <div className="font-display text-2xl">X-VAULT</div>
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase">Platform</h4>
              <ul className="text-xs space-y-2 text-foreground/70">
                <li>Sell with us</li>
                <li>Affiliate Program</li>
                <li>Privacy Policy</li>
                <li>Terms of Service</li>
              </ul>
            </div>
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase">Support</h4>
              <ul className="text-xs space-y-2 text-foreground/70">
                <li>Help Center</li>
                <li>Safety Guide</li>
                <li>Contact Us</li>
                <li>Trade Shield</li>
              </ul>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground text-center pt-6 border-t border-border/60 tracking-wide">
            © 2026 X-VAULT MARKETPLACE. ALL RIGHTS RESERVED.
          </p>
        </div>
      </footer>
    </div>
  );
}
