const channelName = "courtside-auth";
const source =
  typeof window !== "undefined" ? `${Date.now()}-${Math.random()}` : "server";
export function notifyAuthChanged() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined")
    return;
  const channel = new BroadcastChannel(channelName);
  channel.postMessage({ type: "changed", source });
  channel.close();
}
export function watchAuthChanges(onChange: () => void) {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = (event) => {
    if (event.data?.type === "changed" && event.data.source !== source)
      onChange();
  };
  return () => channel.close();
}
