import "@rainbow-me/rainbowkit/styles.css";
import { ConnectButton, RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { http, type Address, type Abi } from "viem";
import { createConfig, useAccount, usePublicClient, useSwitchChain, useWalletClient, WagmiProvider } from "wagmi";
import type { Chain } from "wagmi/chains";
import { injected } from "wagmi/connectors";

const RITUAL_RPC_URL = import.meta.env.VITE_RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const RITUAL_CHAIN_ID = Number(import.meta.env.VITE_RITUAL_CHAIN_ID || 1979);
export const ritualChain = {
  id: RITUAL_CHAIN_ID,
  name: "Ritual Chain Testnet",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: {
    default: { http: [RITUAL_RPC_URL] },
    public: { http: [RITUAL_RPC_URL] }
  },
  blockExplorers: {
    default: { name: "Ritual Explorer", url: "https://explorer.ritualfoundation.org" }
  },
  testnet: true
} as const satisfies Chain;

const queryClient = new QueryClient();
let wagmiConfig: ReturnType<typeof createConfig> | undefined;
let mounted = false;

type WriteRegistryArgs = {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
};

export type RitualWalletBridge = {
  address?: Address;
  chainId?: number;
  connected: boolean;
  signMessage?: (message: string) => Promise<`0x${string}`>;
  writeContract?: (request: WriteRegistryArgs) => Promise<`0x${string}`>;
  waitForTransactionReceipt?: (hash: `0x${string}`) => Promise<unknown>;
  openConnect?: () => void;
  openAccount?: () => void;
};

declare global {
  interface Window {
    ritualWallet?: RitualWalletBridge;
  }
}

export function mountRainbowKit() {
  if (mounted) {
    window.dispatchEvent(new Event("ritual-rainbow-slot"));
    return;
  }

  const config = getWagmiConfig();
  const rootElement = document.createElement("div");
  rootElement.id = "ritual-rainbow-runtime";
  document.body.appendChild(rootElement);
  createRoot(rootElement).render(
    <React.StrictMode>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider
            initialChain={ritualChain}
            modalSize="compact"
            showRecentTransactions
            theme={darkTheme({
              accentColor: "#6246ff",
              accentColorForeground: "#ffffff",
              borderRadius: "medium",
              fontStack: "system",
              overlayBlur: "large"
            })}
          >
            <RainbowRuntime />
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </React.StrictMode>
  );
  mounted = true;
}

function getWagmiConfig() {
  wagmiConfig ??= createConfig({
    chains: [ritualChain],
    connectors: [injected({ shimDisconnect: true })],
    transports: {
      [ritualChain.id]: http(RITUAL_RPC_URL)
    }
  });
  return wagmiConfig;
}

export function getRainbowWallet() {
  return window.ritualWallet;
}

function RainbowRuntime() {
  const [, forceRender] = useState(0);
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();

  useEffect(() => {
    const rerender = () => forceRender((value) => value + 1);
    window.addEventListener("ritual-rainbow-slot", rerender);
    return () => window.removeEventListener("ritual-rainbow-slot", rerender);
  }, []);

  useEffect(() => {
    window.ritualWallet = {
      address,
      chainId,
      connected: Boolean(isConnected && address),
      signMessage: async (message: string) => {
        if (!walletClient?.account) throw new Error("Connect wallet with RainbowKit first.");
        if (chainId !== ritualChain.id) await switchChainAsync({ chainId: ritualChain.id });
        return walletClient.signMessage({ account: walletClient.account, message });
      },
      writeContract: async (request: WriteRegistryArgs) => {
        if (!walletClient?.account) throw new Error("Connect wallet with RainbowKit first.");
        if (chainId !== ritualChain.id) await switchChainAsync({ chainId: ritualChain.id });
        return walletClient.writeContract({
          address: request.address,
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
          account: walletClient.account,
          chain: ritualChain
        });
      },
      waitForTransactionReceipt: async (hash: `0x${string}`) => {
        if (!publicClient) return undefined;
        return publicClient.waitForTransactionReceipt({ hash });
      }
    };
    window.dispatchEvent(new CustomEvent("ritual-wallet-change", { detail: window.ritualWallet }));
  }, [address, chainId, isConnected, publicClient, switchChainAsync, walletClient]);

  const slot = document.querySelector("[data-rainbow-connect]");
  return slot ? createPortal(<RainbowConnectButton />, slot) : null;
}

function RainbowConnectButton() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        mounted: buttonMounted,
        openAccountModal,
        openChainModal,
        openConnectModal
      }) => {
        window.ritualWallet = {
          ...window.ritualWallet,
          connected: Boolean(window.ritualWallet?.connected),
          openConnect: openConnectModal,
          openAccount: openAccountModal
        };
        const ready = buttonMounted;
        const connected = ready && account && chain;
        if (!connected) {
          return (
            <button className="login-pill rainbow-connect-button" type="button" onClick={openConnectModal}>
              Connect
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button className="login-pill rainbow-connect-button is-warning" type="button" onClick={openChainModal}>
              Wrong network
            </button>
          );
        }
        return (
          <button className="login-pill rainbow-connect-button" type="button" onClick={openAccountModal}>
            {account.displayName}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
