import { createFileRoute } from "@tanstack/react-router";
import { WalletView } from "./wallet";

export const Route = createFileRoute("/seller/wallet")({
  component: SellerWallet,
});

function SellerWallet() {
  return (
    <div>
      <h1 className="font-display text-2xl mb-4">SELLER WALLET</h1>
      <WalletView />
    </div>
  );
}
