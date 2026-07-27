import { createLogger, format, transports } from "winston";
import { mkdirSync } from "node:fs";

mkdirSync("logs", { recursive: true });

export function redactWalletAddress(address) {
  const value = String(address || "");
  return value.length > 12 ? `<wallet:${value.slice(0, 4)}...${value.slice(-4)}>` : "<wallet:redacted>";
}

export const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`),
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: "logs/oracle.log" }),
  ],
});
