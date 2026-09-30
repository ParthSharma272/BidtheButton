import { config } from "../../config.ts";
import { mockProvider } from "./mock.ts";
import { razorpayProvider } from "./razorpay.ts";
import type { PaymentProvider } from "./types.ts";

export function getProvider(name: string = config.paymentProvider): PaymentProvider {
  if (name === "mock") return mockProvider;
  if (name === "razorpay") return razorpayProvider;
  throw new Error(`Unknown payment provider ${name}`);
}
