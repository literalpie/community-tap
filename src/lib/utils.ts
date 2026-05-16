import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function requireConvexServerSecret(): string {
  const secret = process.env.CONVEX_SERVER_SECRET;
  if (!secret) {
    throw new Error("CONVEX_SERVER_SECRET is not set");
  }
  return secret;
}
