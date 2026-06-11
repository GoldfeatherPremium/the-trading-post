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

export const productImage = (key: string | null | undefined) =>
  (key && PRODUCT_IMAGES[key]) || itemGold;
