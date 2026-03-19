import express from "express";
import { z } from "zod";
import { getBet, getBetsByUser, saveTonAddress } from "./db.js";
import db from "./db.js";

const router = express.Router();
const AddressSchema = z.object({
  telegram_id: z.number().int().positive(),
  address: z.string().regex(/^[UEk0]Q[A-Za-z0-9_-]{46,64}$/, "Invalid TON address"),
});

router.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

router.get("/bets", (req, res) => {
  const status = req.query.status || "pending";
  const bets = db.prepare(
    "SELECT * FROM bets WHERE status = ? ORDER BY created_at DESC LIMIT 20"
  ).all(status);
  res.json(bets);
});

router.get("/bets/user/:id", (req, res) => {
  res.json(getBetsByUser(parseInt(req.params.id)));
});

router.get("/bet/:id", (req, res) => {
  const bet = getBet(parseInt(req.params.id));
  if (!bet) return res.status(404).json({ error: "Not found" });
  res.json(bet);
});

router.post("/user/address", express.json(), (req, res) => {
  const result = AddressSchema.safeParse({
    ...req.body,
    telegram_id: Number(req.body.telegram_id),
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error.errors[0].message });
  }

  saveTonAddress(result.data.telegram_id, result.data.address);
  res.json({ ok: true });
});

export default router;
