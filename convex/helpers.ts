export function requireServerSecret(serverSecret: string): void {
  if (serverSecret !== process.env.CONVEX_SERVER_SECRET) {
    throw new Error("Invalid server secret");
  }
}
