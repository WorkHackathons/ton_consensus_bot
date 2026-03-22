export const API = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, "");
export const BOT = "ton_consensus_bot";
export const tg = window.Telegram?.WebApp;

tg?.ready();
tg?.expand();

export const userId = tg?.initDataUnsafe?.user?.id;
export const initData = tg?.initData || "";
