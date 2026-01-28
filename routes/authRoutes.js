import express from "express";
import bcrypt from "bcryptjs";
import UserModel from "../models/User.js";
import generateTokenAndSetCookies from "../utils/generateTokenAndSetCookies.js";
import { generateOTP } from "../utils/verifiacitonCode.js";
import { sendVerificationEmail, sendResetPasswordEmail } from "../utils/Email.js";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import axios from "axios";

const router = express.Router();

// Test routes
router.get("/", (req, res) => {
  res.send("This is the auth");
});

router.get("/signup", (req, res) => {
  res.send("this is signup");
});

// ====================== SIGNUP =======================
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check user exists
    const existingUser = await UserModel.findOne({ email });

    if (existingUser) {
      return res.status(400).json({ error: "User Already Exists With This Email" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const verificationCode = generateOTP();

    // Create user
    const newUser = await UserModel.create({
      name,
      email,
      password: hashedPassword,
      verificationCode,
    });

    // Generate token cookie
    const token = generateTokenAndSetCookies(res, newUser._id, newUser.email, newUser.name, newUser.role);


    // Send OTP email
    await sendVerificationEmail(newUser.email, newUser.name, newUser.verificationCode);

    res.status(201).json({
      id: newUser._id,
      name: newUser.name,
      email: newUser.email,
      message: "Verification code sent successfully",
      token: token,
    });
  } catch (err) {
    console.error("Signup Error:", err);
    res.status(500).json({ error: "Server error during signup" });
  }
});

// ====================== LOGIN =======================
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await UserModel.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Compare hashed password
    const isCorrect = await bcrypt.compare(password, user.password);
    if (!isCorrect) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Generate token
    const token = generateTokenAndSetCookies(res, user._id, user.email, user.name, user.role);

    // Update lastLogin
    user.lastLogin = new Date();
    await user.save();

    res.status(201).json({
      id: user._id,
      name: user.name,
      email: user.email,
      message: "LogIn Successfully",
      token: token,
      role: user.role,
      avatar: user.avatar
    });

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Server error during login", details: err.message, stack: err.stack });
  }
});


// ====================== FORGOT PASSWORD =======================
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await UserModel.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: "User not found with this email" });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(20).toString("hex");

    // Hash token and set to resetPasswordToken field
    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    // Set expire time (1 hour)
    user.resetPasswordExpires = Date.now() + 3600000;

    await user.save();

    // Create reset URL
    // Assuming frontend runs on same domain or configure via env
    // For development, assuming localhost:5173 or similar.Ideally use env var for FRONTEND_URL
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

    try {
      await sendResetPasswordEmail(user.email, user.name, resetUrl);
      res.status(200).json({ message: "Email Sent Successfully" });
    } catch (err) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      return res.status(500).json({ error: "Email could not be sent" });
    }

  } catch (err) {
    console.error("Forgot Password Error:", err);
    res.status(500).json({ error: "Server error during forgot password" });
  }
});

// ====================== RESET PASSWORD =======================
router.post("/reset-password/:token", async (req, res) => {
  try {
    const { password, confirmPassword } = req.body;
    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const user = await UserModel.findOne({
      resetPasswordToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    // Check if passwords match (optional, can be done in frontend too but good to verify)
    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }


    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    // Clear reset token fields
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    res.status(200).json({ message: "Password Updated Successfully" });

  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).json({ error: "Server error during reset password" });
  }
});

// ====================== GET ADMIN CONTACT =======================
router.get("/admin-contact", async (req, res) => {
  try {
    // specific admin email logic: "dekho abhi mai admin hu but kalm ko koi or hogqa"
    // Find the first admin user
    const admin = await UserModel.findOne({ role: 'admin' }).select('email name');

    if (admin) {
      res.json({ email: admin.email, name: admin.name });
    } else {
      // Fallback
      res.json({ email: 'admin@aimall.com', name: 'Admin Team' });
    }
  } catch (err) {
    console.error("Fetch Admin Contact Error:", err);
    res.status(500).json({ error: "Failed to fetch admin contact" });
  }
});

// ====================== GOOGLE AUTH =======================

router.post("/google", async (req, res) => {
  try {
    const { token, access_token } = req.body;
    let email, name, picture;

    if (token) {
      // Handle ID Token
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      email = payload.email;
      name = payload.name;
      picture = payload.picture;
    } else if (access_token) {
      // Handle Access Token (for custom buttons using useGoogleLogin)
      const response = await axios.get(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${access_token}`);
      email = response.data.email;
      name = response.data.name;
      picture = response.data.picture;
    } else {
      return res.status(400).json({ error: "Missing token or access_token" });
    }

    let user = await UserModel.findOne({ email });

    if (!user) {
      user = await UserModel.create({
        name,
        email,
        avatar: picture,
        isVerified: true,
        password: "",
      });
    }

    const authToken = generateTokenAndSetCookies(res, user._id, user.email, user.name, user.role);

    // Update lastLogin
    user.lastLogin = new Date();
    await user.save();

    res.status(200).json({
      id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      message: "Google Login Successful",
      token: authToken,
      role: user.role
    });

  } catch (err) {
    console.error("Google Auth Error:", err);
    res.status(400).json({ error: "Google Authentication Failed" });
  }
});

export default router;

