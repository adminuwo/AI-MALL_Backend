import jwt from "jsonwebtoken";

export default function generateTokenAndSetCookies(res, id, email, name) {
  try {
    const sceret = process.env.JWT_SECRET || 'fallback_secret'
    const tokenEx = (process.env.TOKEN_EX || '7d').trim()
    console.log(`[JWT DEBUG] Signing token for ${email} with expiry ${tokenEx}`);
    const token = jwt.sign({ id, email, name }, sceret, { expiresIn: tokenEx })
    res.cookie("token", token, {
      httpOnly: true,
      secure: false, // Set to true in production
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    return token
  } catch (err) {
    console.error(`[JWT ERROR] Failed to sign token: ${err.message}`);
    throw err; // Re-throw to be caught by route handler
  }
}






