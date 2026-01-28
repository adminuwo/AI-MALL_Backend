import jwt from "jsonwebtoken";
import { JWT_SECRET, TOKEN_EX, NODE_ENV } from "../config/env.js";

export default function generateTokenAndSetCookies(res, id, email, name, role) {
  const token = jwt.sign({ id, email, name, role }, JWT_SECRET, { expiresIn: TOKEN_EX });

  res.cookie("token", token, {
    httpOnly: true,
    secure: NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  return token;
}






