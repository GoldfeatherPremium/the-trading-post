import gameElden from "@/assets/game-elden.jpg";
import gameVoid from "@/assets/game-void.jpg";
import gameLeague from "@/assets/game-league.jpg";
import gameSurvive from "@/assets/game-survive.jpg";
import gameRoyale from "@/assets/game-royale.jpg";
import gameRacing from "@/assets/game-racing.jpg";
import itemGold from "@/assets/item-gold.jpg";
import itemSword from "@/assets/item-sword.jpg";

export const PRODUCT_IMAGES: Record<string, string> = {
  gold: itemGold,
  sword: itemSword,
  elden: gameElden,
  void: gameVoid,
  league: gameLeague,
  survive: gameSurvive,
  royale: gameRoyale,
  racing: gameRacing,
};

export const IMAGE_KEYS = Object.keys(PRODUCT_IMAGES);

/**
 * Resolve a product image key to a URL.
 * - Seller-uploaded image IDs (stored as `upload:<id>` in `products.image_key`)
 *   are served by the public image route.
 * - Legacy preset keys map to bundled assets.
 * - Falls back to the gold coins illustration.
 */
export const productImage = (key: string | null | undefined): string => {
  if (key && key.startsWith("upload:")) return `/api/public/img/${key.slice("upload:".length)}`;
  return (key && PRODUCT_IMAGES[key]) || itemGold;
};
